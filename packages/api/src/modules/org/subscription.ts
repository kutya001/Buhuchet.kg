import { randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { orgFileKey } from '@buhuchet/adapters';
import {
  insertSubscriptionPayment,
  listSubscriptionPayments,
  listSubscriptionPlans,
  lockSubscriptionPayment,
  orgUsage,
  pendingSubscriptionPaymentId,
  readOrgSubscription,
  readSubscriptionSettings,
  releaseRateLimit,
  schema,
  setSubscriptionReceipt,
  subscriptionReceiptOf,
  takeRateLimit,
  uniqueViolation,
  withOrgContext,
  writeHistory,
  type OrgContext,
  type OrgUsage,
  type RateLimit,
  type SubscriptionSettingsRow,
  type Tx,
} from '@buhuchet/db';
import {
  FILE_LINK_SECONDS,
  FILE_UPLOAD_LINK_SECONDS,
  RecordChangedError,
  SUBSCRIPTION_MESSAGES,
  SUBSCRIPTION_RECEIPT_SNIFF_BYTES,
  subscriptionAgainId,
  subscriptionCalc,
  subscriptionLastRejected,
  subscriptionMonthsLeft,
  subscriptionPayProblem,
  subscriptionReceiptName,
  subscriptionReceiptProblem,
  subscriptionReceiptSniff,
  subscriptionReceiptUploadType,
  type IsoDate,
  type SubscriptionCalc,
  type SubscriptionMessageCode,
  type SubscriptionNow,
  type SubscriptionPrices,
  type SubscriptionReceiptType,
} from '@buhuchet/domain';
import {
  FileLink,
  OrgSubscriptionView,
  SubscriptionPayComplete,
  SubscriptionPayDone,
  SubscriptionPaymentParam,
  SubscriptionPayStart,
  SubscriptionReceiptComplete,
  SubscriptionReceiptQuery,
  SubscriptionReceiptStart,
  SubscriptionUploadTicket,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError, apiFail } from '../../errors';
import { orgContextOf } from '../../middleware/access';
import { error } from './profile';

/*
 * Экран «Подписка» владельца (доработки 20.11.2026, блок 5; блок 4, пункты 3–6; прототип v154
 * `modules/org-sub.js`: `subScreenHtml`, `subPayDlg`, `subFileDlg`, `subPayView`; пакет 2, этап 1,
 * П7, поток И). Видит и платит только владелец организации; организация и автор — из сеанса, чек и
 * подписка чужой организации не видны (RLS). Сумму считает сервер — из окна приходят только вид,
 * пакет, память и «Когда» (`subscriptionCalc` домена, тот же расчёт, что у окна); подписку меняет
 * только администратор платформы, владелец — только отправляет заявку с чеком и до проверки
 * заменяет файл чека.
 *
 * Чек (блок 5, пункт 3; защита — пакет 2, блок 6): один файл до 20 МБ, тип — по содержимому (PDF,
 * JPG, PNG), браузер кладёт его по подписанной ссылке на 2 минуты под ключ загрузки (`….up`,
 * `….rep-<номер>`); «закончить» проверяет копию (размер, тип, первые байты) и только её кладёт под
 * ключ чека `org/<организация>/subs/<оплата>` — загрузку по ещё живой ссылке можно перезаписать, копию
 * нет. Заявка ложится в базу только с проверенным чеком: доступ, открытый чеком, держится на ней.
 * Попытки — не больше 10 в час на организацию; «закончить» — по одному у организации (аренда), чтобы
 * два одновременных запроса не положили и не удалили чек друг друга.
 */

const { organizations } = schema;

/** Начатые загрузки чека (новая заявка и замена файла) — на организацию в час. */
export const SUB_RECEIPT_RATE_LIMIT: RateLimit = {
  kind: 'sub_receipt',
  max: 10,
  windowSeconds: 3600,
};
/** «Закончить» — по одному у организации; аренда снимается сама через 5 минут после сбоя процесса. */
export const SUB_RECEIPT_COMPLETE_ONCE: RateLimit = {
  kind: 'sub_receipt_done',
  max: 30,
  windowSeconds: 3600,
  leaseSeconds: 300,
};
/** Открытий чека владельцем — в час (ссылка живёт 15 минут). */
export const SUB_RECEIPT_OPEN_RATE_LIMIT: RateLimit = {
  kind: 'sub_receipt_open',
  max: 120,
  windowSeconds: 3600,
};

const fail = (
  status: 400 | 403 | 404 | 409 | 429,
  code: SubscriptionMessageCode,
  details?: Record<string, number | string>,
): never => {
  let text: string = SUBSCRIPTION_MESSAGES[code];
  for (const [k, v] of Object.entries(details ?? {})) text = text.replaceAll(`{${k}}`, String(v));
  return apiFail(status, code, text, details);
};

/** Только владелец организации (блок 5, пункт 1): остальные сотрудники вкладку не видят. */
const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const access = c.get('access');
  if (!access?.subject.isOwner) {
    return c.json(apiError('sub_owner_only', SUBSCRIPTION_MESSAGES.sub_owner_only), 403);
  }
  return next();
});

/** Ключ чека оплаты: только в папке своей организации (ограничение базы требует того же). */
const receiptKeyOf = (orgId: string, payId: string) => orgFileKey(orgId, 'subs', payId);

const pricesOf = (s: SubscriptionSettingsRow): SubscriptionPrices => ({
  seatPrice: s.seatPrice,
  gbPrice: s.gbPrice,
  seatStep: s.seatStep,
  baseMb: s.baseMb,
  seatMb: s.seatMb,
  firstMonthPct: s.firstMonthPct,
  extraDiscountOver: s.extraDiscountOver,
});

/** Подписка сейчас для расчёта: пакет и память — как их видит `app.org_usage`. */
function subNowOf(
  sub: Awaited<ReturnType<typeof readOrgSubscription>>,
  usage: OrgUsage,
): SubscriptionNow | null {
  if (!sub) return null;
  return {
    planId: sub.planId,
    seats: usage.seatsLimit ?? sub.seats,
    extraGb: usage.extraGb ?? sub.extraGb,
    paidUntil: sub.paidUntil,
    extraDiscountPct: sub.extraDiscountPct,
    firstPaid: sub.firstPaid,
  };
}

type PayChoice = z.infer<typeof SubscriptionPayStart>['pay'];

/** Что уйдёт в заявку: посчитано сервером. */
interface PayPlan {
  kind: PayChoice['kind'];
  planId: string;
  startMode: 'now' | 'next';
  months: number;
  seats: number;
  extraGb: number;
  calc: SubscriptionCalc;
}

/**
 * Проверить выбор окна оплаты и посчитать сумму (прототип `subPayDlg`: `errs`, `calc`) — в транзакции
 * организации: демо, непроверенный чек, расширение без действующей подписки, вид, пакет, память,
 * «Со следующего месяца», нулевая сумма — отказ.
 */
async function payPlanOf(tx: Tx, choice: PayChoice, today: IsoDate): Promise<PayPlan> {
  const usage = await orgUsage(tx, today);
  if (!usage) return apiFail(404, 'not_found', 'Организация не найдена');
  if (usage.demo) fail(409, 'sub_demo');
  if (await pendingSubscriptionPaymentId(tx)) fail(409, 'sub_pending');
  const sub = await readOrgSubscription(tx);
  if (choice.kind !== 'renew' && (!sub || usage.closed)) fail(409, 'sub_renew_first');
  const settings = await readSubscriptionSettings(tx);
  if (!settings) return apiFail(404, 'not_found', 'Цены подписки не заданы');
  const plans = await listSubscriptionPlans(tx);
  const planId = choice.kind === 'renew' ? (choice.planId ?? '') : sub!.planId;
  const plan = plans.find((p) => p.id === planId);
  const prices = pricesOf(settings);
  const now = subNowOf(sub, usage);
  const nowSeats = now?.seats ?? 0;
  const nowExtraGb = now?.extraGb ?? 0;
  const seats = choice.kind === 'mem' ? nowSeats : choice.seats;
  const extraGb = choice.kind === 'grow' ? nowExtraGb : choice.extraGb;
  const problem = subscriptionPayProblem({
    kind: choice.kind,
    prices,
    planOk: choice.kind !== 'renew' || !!plan?.active,
    nowSeats,
    nowExtraGb,
    active: usage.seatsUsed,
    usedBytes: usage.bytesUsed ?? 0,
    seats,
    extraGb,
  });
  if (problem) {
    const { field, code, ...rest } = problem;
    const details: Record<string, number | string> = { field };
    for (const [k, v] of Object.entries(rest)) details[k] = Math.round(Number(v) * 10) / 10;
    fail(400, code, details);
  }
  const startMode = choice.kind === 'renew' ? 'now' : choice.startMode;
  if (startMode === 'next' && subscriptionMonthsLeft(sub!.paidUntil, today) <= 1) {
    fail(400, 'sub_next_unavailable', { field: 'startMode' });
  }
  const calc = subscriptionCalc({
    kind: choice.kind,
    prices,
    plan: plan!,
    sub: now,
    seats,
    extraGb,
    startMode,
    today,
  });
  if (calc.total <= 0) fail(400, 'sub_nothing_to_pay');
  return { kind: choice.kind, planId, startMode, months: calc.months, seats, extraGb, calc };
}

/** Удалить объекты хранилища, не роняя метод: в журнал (лишний объект найдёт «Проверка хранилища»). */
async function dropObjects(deps: ApiDeps, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deps.storage.delete(key);
    } catch (err) {
      deps.logger.error({ err }, 'подписка: объект чека не удалён из хранилища');
    }
  }
}

/**
 * Проверочная копия загрузки и её тип по содержимому: не дошёл, не тот размер или тип загрузки,
 * не PDF, JPG или PNG — отказ (копия удаляется вызывающим).
 */
async function checkedReceipt(
  deps: ApiDeps,
  uploadKey: string,
  checkKey: string,
  file: { name: string; size: number },
): Promise<SubscriptionReceiptType> {
  if (!(await deps.storage.copy(uploadKey, checkKey))) fail(409, 'sub_receipt_missing');
  const stored = await deps.storage.stat(checkKey);
  if (!stored) return fail(409, 'sub_receipt_missing');
  if (
    stored.size !== file.size ||
    stored.contentType !== subscriptionReceiptUploadType(file.name)
  ) {
    fail(409, 'sub_receipt_missing');
  }
  const head = await deps.storage.getRange(checkKey, 0, SUBSCRIPTION_RECEIPT_SNIFF_BYTES);
  const type = head && subscriptionReceiptSniff(head);
  if (!type) return fail(400, 'sub_receipt_type');
  return type;
}

function checkFile(file: { name: string; size: number }): string {
  const problem = subscriptionReceiptProblem(file);
  if (problem) fail(400, problem);
  return subscriptionReceiptName(file.name);
}

/** Аренда «закончить» организации; занято — «Чек уже отправляется». */
async function withCompleteLease<T>(deps: ApiDeps, orgId: string, fn: () => Promise<T>) {
  const lease = await takeRateLimit(deps.db, SUB_RECEIPT_COMPLETE_ONCE, orgId);
  if (!lease.ok) {
    if (lease.reason === 'busy') fail(409, 'sub_receipt_busy');
    fail(429, 'sub_receipt_limit');
  }
  try {
    return await fn();
  } finally {
    const ticket = lease.ok ? lease.ticket : 0;
    await releaseRateLimit(deps.db, SUB_RECEIPT_COMPLETE_ONCE, orgId, ticket).catch(
      (err: unknown) => deps.logger.error({ err }, 'подписка: аренда чека не снята'),
    );
  }
}

async function takeReceiptSlot(deps: ApiDeps, orgId: string): Promise<void> {
  const slot = await takeRateLimit(deps.db, SUB_RECEIPT_RATE_LIMIT, orgId);
  if (!slot.ok) fail(429, 'sub_receipt_limit');
}

async function uploadTicket(deps: ApiDeps, id: string, key: string, name: string, size: number) {
  // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда.
  const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000).toISOString();
  const upload = await deps.storage.signedUploadUrl(key, {
    expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
    contentType: subscriptionReceiptUploadType(name),
    size,
  });
  return {
    id,
    upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt },
  };
}

/* ── Экран «Подписка» ── */

export const orgSubscriptionRoute = createRoute({
  method: 'get',
  path: '/org/subscription',
  tags: ['org'],
  summary: 'Экран «Подписка» владельца: подписка, места, память, скидки, история оплат, цены',
  middleware: [requireOwner] as const,
  responses: {
    200: {
      description: 'Экран «Подписка»',
      content: { 'application/json': { schema: OrgSubscriptionView } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не владелец организации', content: error },
  },
});

/** Название и ИНН организации — для назначения платежа. */
async function orgNameOf(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ name: organizations.name, inn: organizations.inn })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return row ?? { name: '', inn: null };
}

/**
 * Экран «Подписка» организации — одна функция для владельца и для Админки (окно «Подписка
 * организации», вкладка карточки организации): звать в `withOrgContext` этой организации — подписку,
 * оплаты и чек другой организации RLS не покажет.
 */
export async function subscriptionScreenOf(
  tx: Tx,
  orgId: string,
  today: IsoDate,
): Promise<z.infer<typeof OrgSubscriptionView>> {
  const usage = await orgUsage(tx, today);
  if (!usage) return apiFail(404, 'not_found', 'Организация не найдена');
  const org = await orgNameOf(tx, orgId);
  const sub = await readOrgSubscription(tx);
  const settings = await readSubscriptionSettings(tx);
  if (!settings) return apiFail(404, 'not_found', 'Цены подписки не заданы');
  const allPlans = await listSubscriptionPlans(tx);
  const pays = await listSubscriptionPayments(tx);
  const prices = pricesOf(settings);
  const now = subNowOf(sub, usage);
  const plan = sub ? allPlans.find((p) => p.id === sub.planId) : undefined;
  const renewTotal =
    sub && plan && now
      ? subscriptionCalc({
          kind: 'renew',
          prices,
          plan,
          sub: now,
          seats: sub.seats,
          extraGb: sub.extraGb,
          startMode: 'now',
          today,
        }).total
      : null;
  const facts = pays.map((p) => ({ id: p.id, kind: p.kind, status: p.status }));
  const againId = subscriptionAgainId(facts);
  const purpose =
    settings.purpose?.replaceAll('{организация}', org.name).replaceAll('{ИНН}', org.inn ?? '') ??
    null;
  return {
    today,
    org,
    status: usage.status,
    closed: usage.closed,
    sub: sub && {
      planId: sub.planId,
      planName: sub.planName,
      seats: sub.seats,
      extraGb: sub.extraGb,
      paidUntil: sub.paidUntil,
      free: sub.free,
      firstPaid: sub.firstPaid,
      extraDiscountPct: sub.extraDiscountPct,
      next: sub.next,
    },
    usage: {
      seatsUsed: usage.seatsUsed,
      seats: usage.seatsLimit ?? 0,
      extraGb: usage.extraGb ?? 0,
      bytesUsed: usage.bytesUsed ?? 0,
      bytesLimit: usage.bytesLimit,
    },
    prices: { ...prices, remindDays: settings.remindDays, checkDays: settings.checkDays },
    requisites: {
      recipient: settings.recipient,
      recipientInn: settings.recipientInn,
      bank: settings.bank,
      bik: settings.bik,
      account: settings.account,
      purpose,
    },
    plans: allPlans
      .filter((p) => p.active || p.id === sub?.planId)
      .map((p) => ({ ...p, perks: p.perks ?? [] })),
    monthsLeft: subscriptionMonthsLeft(sub?.paidUntil ?? null, today),
    renewTotal,
    lastRejected: subscriptionLastRejected(facts),
    payments: pays.map((p) => ({
      id: p.id,
      at: p.createdAt.toISOString(),
      kind: p.kind,
      startMode: p.startMode,
      planId: p.planId,
      planName: p.planName,
      months: p.months,
      seats: p.seats,
      extraGb: p.extraGb,
      amount: p.amount,
      lines: p.lines,
      receipt: p.receiptName
        ? { name: p.receiptName, type: p.receiptType, bytes: p.receiptBytes }
        : null,
      status: p.status,
      opensAccess: p.opensAccess,
      reason: p.reason,
      decidedAt: p.decidedAt?.toISOString() ?? null,
      paidUntil: p.paidUntil,
      by: p.byName,
      again: p.id === againId,
      version: p.version,
    })),
  };
}

export function orgSubscriptionHandler(
  deps: ApiDeps,
): RouteHandler<typeof orgSubscriptionRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const today = deps.clock.today();
    const view = await withOrgContext(deps.db, ctx, (tx) =>
      subscriptionScreenOf(tx, ctx.orgId, today),
    );
    return c.json(view, 200);
  };
}

/* ── «Отправить на проверку»: заявка с чеком ── */

const startResponses = {
  400: { description: 'Неверный выбор или файл чека', content: error },
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не владелец организации', content: error },
  409: { description: 'Чек на проверке, демо или нужна действующая подписка', content: error },
  429: { description: 'Больше 10 попыток в час', content: error },
} as const;

export const subPayStartRoute = createRoute({
  method: 'post',
  path: '/org/subscription/payments/start',
  tags: ['org'],
  summary: 'Оплата подписки: проверить выбор и получить ссылку на загрузку чека',
  middleware: [requireOwner] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: SubscriptionPayStart } } },
  },
  responses: {
    201: {
      description: 'Ссылка на загрузку чека (2 минуты)',
      content: { 'application/json': { schema: SubscriptionUploadTicket } },
    },
    ...startResponses,
  },
});

export function subPayStartHandler(deps: ApiDeps): RouteHandler<typeof subPayStartRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const name = checkFile(body.file);
    const today = deps.clock.today();
    // Выбор проверяется до загрузки: с неверным выбором файл не кладётся вовсе.
    await withOrgContext(deps.db, ctx, (tx) => payPlanOf(tx, body.pay, today));
    await takeReceiptSlot(deps, ctx.orgId);
    const id = randomUUID();
    const key = `${receiptKeyOf(ctx.orgId, id)}.up`;
    return c.json(await uploadTicket(deps, id, key, name, body.file.size), 201);
  };
}

export const subPayCompleteRoute = createRoute({
  method: 'post',
  path: '/org/subscription/payments/complete',
  tags: ['org'],
  summary: 'Оплата подписки: чек проверен — заявка «Ждёт подтверждения»',
  middleware: [requireOwner] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: SubscriptionPayComplete } } },
  },
  responses: {
    201: {
      description: 'Заявка отправлена на проверку',
      content: { 'application/json': { schema: SubscriptionPayDone } },
    },
    ...startResponses,
    409: {
      description: 'Чек не дошёл, уже отправляется, или есть непроверенный чек',
      content: error,
    },
  },
});

export function subPayCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof subPayCompleteRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const name = checkFile(body.file);
    const today = deps.clock.today();
    const key = receiptKeyOf(ctx.orgId, body.id);
    const done = await withCompleteLease(deps, ctx.orgId, () =>
      finishPayment(deps, ctx, { body, name, key, today }),
    );
    return c.json(done, 201);
  };
}

async function finishPayment(
  deps: ApiDeps,
  ctx: OrgContext,
  o: {
    body: z.infer<typeof SubscriptionPayComplete>;
    name: string;
    key: string;
    today: IsoDate;
  },
) {
  const { body, name, key, today } = o;
  const uploadKey = `${key}.up`;
  const checkKey = `${key}.chk-${randomUUID()}`;
  let placed = false;
  try {
    const type = await checkedReceipt(deps, uploadKey, checkKey, body.file);
    if (!(await deps.storage.copy(checkKey, key))) fail(409, 'sub_receipt_missing');
    placed = true;
    const done = await withOrgContext(deps.db, ctx, async (tx) => {
      const plan = await payPlanOf(tx, body.pay, today);
      let row: { opensAccess: boolean };
      try {
        row = await insertSubscriptionPayment(tx, {
          id: body.id,
          kind: plan.kind,
          startMode: plan.startMode,
          planId: plan.planId,
          months: plan.months,
          seats: plan.seats,
          extraGb: plan.extraGb,
          amount: plan.calc.total,
          lines: plan.calc.lines,
          receiptKey: key,
          receiptName: name,
          receiptType: type,
          receiptBytes: body.file.size,
        });
      } catch (err) {
        if (uniqueViolation(err)) fail(409, 'sub_pending');
        throw err;
      }
      await writeHistory(tx, {
        entity: 'subscription',
        entityId: ctx.orgId,
        action: 'sub_pay_send',
        changes: [
          { field: 'payment', to: body.id },
          { field: 'kind', to: plan.kind },
          { field: 'planId', to: plan.planId },
          { field: 'months', to: plan.months },
          { field: 'seats', to: plan.seats },
          { field: 'extraGb', to: plan.extraGb },
          { field: 'startMode', to: plan.startMode },
          { field: 'amount', to: plan.calc.total },
          { field: 'receipt', to: name },
        ],
      });
      // Стык с потоком Т: «Новый чек на проверку» администраторам платформы — notifySubCheckNew(tx,
      // ctx, …) здесь, тексты (subNoticeContext) — до транзакции; подключает общая сборка этапа 1.
      return { id: body.id, amount: plan.calc.total, opensAccess: row.opensAccess };
    });
    placed = false;
    return done;
  } finally {
    // Чек под ключом оплаты остаётся, только если заявка записана (её мог записать и прежний запрос).
    const keep =
      !placed ||
      (await withOrgContext(deps.db, ctx, (tx) => subscriptionReceiptOf(tx, body.id)).catch(
        () => null,
      ));
    await dropObjects(deps, [uploadKey, checkKey, ...(keep ? [] : [key])]);
  }
}

/* ── «Заменить файл чека» до проверки (блок 5, пункт 5) ── */

export const subReceiptStartRoute = createRoute({
  method: 'post',
  path: '/org/subscription/payments/{id}/receipt',
  tags: ['org'],
  summary: '«Заменить файл чека»: ссылка на загрузку нового файла (заявка ещё не проверена)',
  middleware: [requireOwner] as const,
  request: {
    params: SubscriptionPaymentParam,
    body: { required: true, content: { 'application/json': { schema: SubscriptionReceiptStart } } },
  },
  responses: {
    201: {
      description: 'Ссылка на загрузку (2 минуты); `id` — номер загрузки',
      content: { 'application/json': { schema: SubscriptionUploadTicket } },
    },
    ...startResponses,
    404: { description: 'Оплаты нет', content: error },
    409: { description: 'Чек уже проверен или запись изменена', content: error },
  },
});

/** Заявка, у которой можно заменить файл: своя (RLS), с чеком, не проверена, версия совпадает. */
async function replaceable(tx: Tx, id: string, version: number) {
  const pay = await lockSubscriptionPayment(tx, id);
  if (!pay?.receiptKey) return apiFail(404, 'not_found', 'Оплата не найдена');
  if (pay.status !== 'pending') fail(409, 'sub_pay_decided');
  if (pay.version !== version)
    throw new RecordChangedError('subscription_payment', id, pay.version);
  return pay;
}

export function subReceiptStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof subReceiptStartRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const name = checkFile(body.file);
    await withOrgContext(deps.db, ctx, (tx) => replaceable(tx, id, body.version));
    await takeReceiptSlot(deps, ctx.orgId);
    const uploadId = randomUUID();
    const key = `${receiptKeyOf(ctx.orgId, id)}.rep-${uploadId}`;
    return c.json(await uploadTicket(deps, uploadId, key, name, body.file.size), 201);
  };
}

export const subReceiptCompleteRoute = createRoute({
  method: 'post',
  path: '/org/subscription/payments/{id}/receipt/complete',
  tags: ['org'],
  summary: '«Заменить файл чека»: новый файл проверен и стоит вместо прежнего',
  middleware: [requireOwner] as const,
  request: {
    params: SubscriptionPaymentParam,
    body: {
      required: true,
      content: { 'application/json': { schema: SubscriptionReceiptComplete } },
    },
  },
  responses: {
    200: {
      description: 'Файл чека заменён: новая версия оплаты',
      content: { 'application/json': { schema: z.object({ version: z.number().int() }) } },
    },
    ...startResponses,
    404: { description: 'Оплаты нет', content: error },
    409: { description: 'Чек уже проверен, не дошёл или запись изменена', content: error },
  },
});

export function subReceiptCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof subReceiptCompleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const ctx = orgContextOf(c);
    const name = checkFile(body.file);
    const out = await withCompleteLease(deps, ctx.orgId, () =>
      finishReplace(deps, ctx, { id, body, name }),
    );
    return c.json(out, 200);
  };
}

/**
 * Замена под арендой организации: проверенная копия ложится под ключ чека, прежний файл до записи в
 * базу лежит копией; база не приняла (чек проверили, версия устарела) — прежний файл возвращается.
 */
async function finishReplace(
  deps: ApiDeps,
  ctx: OrgContext,
  o: { id: string; body: z.infer<typeof SubscriptionReceiptComplete>; name: string },
) {
  const { id, body, name } = o;
  const key = receiptKeyOf(ctx.orgId, id);
  const uploadKey = `${key}.rep-${body.uploadId}`;
  const checkKey = `${key}.chk-${randomUUID()}`;
  const backupKey = `${key}.bak-${randomUUID()}`;
  let backedUp = false;
  let placed = false;
  try {
    const type = await checkedReceipt(deps, uploadKey, checkKey, body.file);
    // Заявка ещё ждёт и версия та же — до того, как трогать файл.
    await withOrgContext(deps.db, ctx, (tx) => replaceable(tx, id, body.version));
    backedUp = await deps.storage.copy(key, backupKey);
    if (!(await deps.storage.copy(checkKey, key))) fail(409, 'sub_receipt_missing');
    placed = true;
    const version = await withOrgContext(deps.db, ctx, async (tx) => {
      const pay = await replaceable(tx, id, body.version);
      const next = await setSubscriptionReceipt(tx, id, { name, type, bytes: body.file.size });
      if (next === null) fail(409, 'sub_pay_decided');
      await writeHistory(tx, {
        entity: 'subscription',
        entityId: ctx.orgId,
        action: 'sub_receipt_replace',
        changes: [
          { field: 'payment', to: id },
          { field: 'receipt', from: pay.receiptName, to: name },
        ],
      });
      return next!;
    });
    placed = false;
    return { version };
  } finally {
    if (placed && backedUp && !(await deps.storage.copy(backupKey, key).catch(() => false))) {
      deps.logger.error({ payment: id }, 'подписка: прежний файл чека не возвращён после отказа');
    }
    await dropObjects(deps, [uploadKey, checkKey, ...(backedUp ? [backupKey] : [])]);
  }
}

/* ── Чек в окне просмотра и «Скачать» ── */

export const subReceiptLinkRoute = createRoute({
  method: 'get',
  path: '/org/subscription/payments/{id}/receipt/link',
  tags: ['org'],
  summary: 'Чек оплаты подписки: ссылка на 15 минут (просмотр — PDF и фото, `download=1` — файлом)',
  middleware: [requireOwner] as const,
  request: { params: SubscriptionPaymentParam, query: SubscriptionReceiptQuery },
  responses: {
    200: {
      description: 'Подписанная ссылка',
      content: { 'application/json': { schema: FileLink } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не владелец организации', content: error },
    404: { description: 'Чека нет', content: error },
    429: { description: 'Слишком много открытий', content: error },
  },
});

async function receiptLink(deps: ApiDeps, c: Context<AppEnv>, id: string, download: boolean) {
  c.header('Cache-Control', 'no-store');
  const ctx = orgContextOf(c);
  const slot = await takeRateLimit(deps.db, SUB_RECEIPT_OPEN_RATE_LIMIT, ctx.userId ?? ctx.orgId);
  if (!slot.ok)
    apiFail(429, 'file_open_limit', 'Слишком много открытых файлов. Попробуйте через час');
  const receipt = await withOrgContext(deps.db, ctx, (tx) => subscriptionReceiptOf(tx, id));
  if (!receipt) return apiFail(404, 'not_found', 'Чек не найден');
  // Тип — тот, что дала проверка содержимого: PDF или картинка, другой ссылкой не открывается.
  const contentType = receipt.type ?? 'application/octet-stream';
  const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
  const url = await deps.storage.signedDownloadUrl(receipt.key, {
    expiresInSeconds: FILE_LINK_SECONDS,
    fileName: receipt.name,
    ...(download ? {} : { inline: { contentType } }),
  });
  return { url, expiresAt: expiresAt.toISOString() };
}

export function subReceiptLinkHandler(
  deps: ApiDeps,
): RouteHandler<typeof subReceiptLinkRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const download = c.req.valid('query').download === '1';
    return c.json(await receiptLink(deps, c, id, download), 200);
  };
}

export const subReceiptDownloadRoute = createRoute({
  method: 'get',
  path: '/org/subscription/payments/{id}/receipt/download',
  tags: ['org'],
  summary: '«Скачать» чек: переход на подписанную ссылку-вложение (кнопка окна просмотра)',
  middleware: [requireOwner] as const,
  request: { params: SubscriptionPaymentParam },
  responses: {
    302: { description: 'Переход на ссылку-вложение' },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не владелец организации', content: error },
    404: { description: 'Чека нет', content: error },
    429: { description: 'Слишком много открытий', content: error },
  },
});

export function subReceiptDownloadHandler(
  deps: ApiDeps,
): RouteHandler<typeof subReceiptDownloadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const link = await receiptLink(deps, c, id, true);
    return c.redirect(link.url, 302);
  };
}
