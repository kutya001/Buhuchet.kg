import { randomBytes } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminSubscriptionCard,
  adminSubscriptionReceipt,
  createSubscriptionPlan,
  decidePayment,
  deleteSubscriptionPlan,
  exportSubscriptions,
  foreignKeyViolation,
  insertFreePayment,
  listSubscriptionValues,
  listSubscriptionsPage,
  lockPendingPayment,
  lockSubscription,
  lockSubscriptionPlan,
  lockSubscriptionPlans,
  orgUsage,
  pendingPaymentOf,
  pendingSubscriptionPayments,
  planInputOf,
  saveSubscription,
  subscriptionConfigHistory,
  subscriptionPaymentOrg,
  subscriptionPlanRows,
  subscriptionPlanUsage,
  subscriptionPricesOf,
  subscriptionSettingsOf,
  subscriptionsSummary,
  subscriptionTerms,
  SubscriptionPaymentDecidedError,
  updateSubscriptionPlan,
  updateSubscriptionSettings,
  withOrgContext,
  withUserContext,
  writeSubscriptionHistory,
  type Tx,
} from '@buhuchet/db';
import {
  FILE_LINK_SECONDS,
  RecordChangedError,
  RecordNotFoundError,
  SUBSCRIPTION_PLAN_MESSAGES,
  SUBSCRIPTION_PRICE_FIELDS,
  SUBSCRIPTION_REQUISITE_FIELDS,
  SUBSCRIPTION_SETTINGS_MESSAGES,
  bishkekDate,
  subscriptionCalc,
  subscriptionConfirm,
  subscriptionEdit,
  subscriptionEditProblems,
  subscriptionMemLimitBytes,
  subscriptionMemLimitMb,
  subscriptionPayLate,
  subscriptionPerksOf,
  subscriptionPlanChanges,
  subscriptionPlanProblems,
  subscriptionSettingsProblems,
  type HistoryChange,
  type IsoDate,
  type SubscriptionSettingsInput,
} from '@buhuchet/domain';
import {
  AdminSubscriptionCard,
  AdminSubscriptionList,
  AdminSubscriptionPlans,
  AdminSubscriptionSettings,
  AdminSubscriptionsSummary,
  ApiError,
  FileLink,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  SubscriptionCalcLineSchema,
  SubscriptionConfirmRequest,
  SubscriptionEditRequest,
  SubscriptionPlanDelete,
  SubscriptionPlanRequest,
  SubscriptionPlanUpdate,
  SubscriptionRejectRequest,
  SubscriptionSettingsUpdate,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subscriptionScreenOf } from '../org/subscription';
import { flushEvents } from '../telegram/outbox';
import { notifySubOwners, subNoticeContext } from '../telegram/subs';
import { subscriptionEditFail } from './subscriptions';

/*
 * Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6, пункты 2–7; прототип
 * admin/subs-admin.js; этап 1, П3). Только администратору платформы. Список всех организаций — вне
 * контекста организации (`withUserContext`), окно, проверка чека и «Изменить подписку» — в контексте
 * организации записи с автором-администратором (RLS пускает только его), виды подписок и цены — общие
 * данные платформы. Суммы — тыйыны; «сегодня» — по Бишкеку от часов приложения.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

const todayOf = (deps: ApiDeps): IsoDate => bishkekDate(deps.clock.now());
const adminOf = (c: { get(key: 'session'): { userId: string } | undefined }) =>
  c.get('session')!.userId;

/* ── Список организаций (блок 6, пункт 2) ── */

export const subscriptionsListRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions',
  tags: ['admin'],
  summary: '«Подписки»: организации с подпиской, местами, памятью и чеком на проверке',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Все организации платформы; по умолчанию — чеки дольше срока проверки, затем по статусу и «Оплачено до»',
      content: json(AdminSubscriptionList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function subscriptionsListHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionsListRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, adminOf(c), (tx) =>
      listSubscriptionsPage(tx, query, todayOf(deps), t),
    );
    return c.json(
      {
        items: page.rows,
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const subscriptionsValuesRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions/values',
  tags: ['admin'],
  summary: 'Значения столбца «Подписок» для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function subscriptionsValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionsValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, adminOf(c), (tx) =>
      listSubscriptionValues(tx, col, todayOf(deps), t, q),
    );
    return c.json(values, 200);
  };
}

export const subscriptionsExportRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions/export',
  tags: ['admin'],
  summary: '«Подписки» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function subscriptionsExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionsExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = adminOf(c);
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportSubscriptions(tx, query, keys, todayOf(deps), t),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.organizations')} · ${t('tab.orgs.subs')}`,
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const subscriptionsSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions/summary',
  tags: ['admin'],
  summary: '«Подписки»: плашки по статусам и число чеков на проверке',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description:
        'Организаций по статусам, чеков дольше срока проверки и всего на проверке (число у вкладки)',
      content: json(AdminSubscriptionsSummary),
    },
    ...denied,
  },
});

export function subscriptionsSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionsSummaryRoute, AppEnv> {
  return async (c) => {
    const body = await withUserContext(deps.db, adminOf(c), async (tx) => ({
      ...(await subscriptionsSummary(tx, todayOf(deps))),
      pending: await pendingSubscriptionPayments(tx),
    }));
    return c.json(body, 200);
  };
}

/* ── Окно «Подписка организации» (блок 6, пункты 2–4, 7) ── */

const orgParam = z.object({ orgId: Uuid });

export const subscriptionCardRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions/{orgId}',
  tags: ['admin'],
  summary: 'Окно «Подписка организации»: подписка, чеки, «История оплат» и «История изменений»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: orgParam },
  responses: {
    200: { description: 'Подписка организации', content: json(AdminSubscriptionCard) },
    ...denied,
    404: { description: 'Организации нет', content: error },
  },
});

/** Строки расчёта, которые сохранило окно оплаты владельца; непонятная строка не показывается. */
const linesOf = (v: unknown) =>
  Array.isArray(v)
    ? v.flatMap((l) => {
        const r = SubscriptionCalcLineSchema.safeParse(l);
        return r.success ? [r.data] : [];
      })
    : [];

/** Окно «Подписка организации» — в контексте организации записи от имени администратора. */
async function cardOf(tx: Tx, orgId: string, today: IsoDate): Promise<AdminSubscriptionCard> {
  const card = await adminSubscriptionCard(tx, orgId);
  const usage = await orgUsage(tx, today);
  if (!usage) throw new RecordNotFoundError('organization', orgId);
  const settings = await subscriptionSettingsOf(tx);
  const prices = subscriptionPricesOf(settings);
  const plans = await subscriptionPlanRows(tx);
  const planOf = (id: string) => plans.find((k) => k.id === id);
  const s = card.sub;
  // «Со следующего месяца», который уже наступил, — пакет и память подписки (как `app.org_usage`).
  const arrived = !!s?.nextFrom && s.nextFrom <= today;
  const seats = s ? (arrived ? (s.nextSeats ?? s.seats) : s.seats) : 0;
  const extraGb = s ? (arrived ? (s.nextExtraGb ?? s.extraGb) : s.extraGb) : 0;
  const plan = s ? planOf(s.planId) : undefined;
  const renew =
    s?.paidUntil && plan
      ? subscriptionCalc({
          kind: 'renew',
          prices,
          plan: { id: plan.id, months: plan.months, discountPct: plan.discountPct },
          sub: {
            planId: s.planId,
            seats,
            extraGb,
            paidUntil: s.paidUntil,
            extraDiscountPct: s.extraDiscountPct,
            firstPaid: s.firstPaid,
          },
          seats,
          extraGb,
          startMode: 'now',
          today,
        })
      : null;
  const pending = card.payments.find((p) => p.status === 'pending');
  const late = (p: { status: string; createdAt: Date }) =>
    p.status === 'pending' &&
    subscriptionPayLate(bishkekDate(p.createdAt), today, settings.checkDays);
  return {
    today,
    org: {
      id: card.org.id,
      name: card.org.name,
      inn: card.org.inn,
      demo: card.org.demo,
      blocked: card.org.status !== 'active',
    },
    status: usage.status,
    late: pending ? late(pending) : false,
    seatsUsed: usage.seatsUsed,
    pack: usage.seatsLimit ?? 0,
    bytesUsed: usage.bytesUsed ?? 0,
    // Без подписки — «из 2 ГБ», как в прототипе (`subMem`: пакет 0); у демо — без предела.
    bytesLimit:
      usage.bytesLimit ?? (card.org.demo ? null : subscriptionMemLimitBytes(prices, 0, 0)),
    memIncludedMb: subscriptionMemLimitMb(prices, usage.seatsLimit ?? seats, 0),
    sub:
      s && s.paidUntil
        ? {
            planId: s.planId,
            planName: plan?.name ?? s.planId,
            planDiscountPct: plan?.discountPct ?? 0,
            free: s.free,
            seats,
            extraGb,
            paidUntil: s.paidUntil,
            extraDiscountPct: s.extraDiscountPct,
            extraDiscountOn: s.extraDiscountPct > 0 && seats > prices.extraDiscountOver,
            firstPaid: s.firstPaid,
            next:
              s.nextFrom && !arrived
                ? {
                    seats: s.nextSeats ?? s.seats,
                    extraGb: s.nextExtraGb ?? s.extraGb,
                    from: s.nextFrom,
                  }
                : null,
            version: s.version,
          }
        : null,
    renew: renew && plan ? { total: renew.total, planName: plan.name, seats } : null,
    firstMonthPct: prices.firstMonthPct,
    checkDays: settings.checkDays,
    payments: card.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      startMode: p.startMode,
      planId: p.planId,
      planName: planOf(p.planId)?.name ?? p.planId,
      months: p.months,
      seats: p.seats,
      extraGb: p.extraGb,
      amount: p.amount,
      lines: linesOf(p.lines),
      receipt:
        p.receiptName && p.receiptType && p.receiptBytes !== null
          ? { name: p.receiptName, type: p.receiptType, bytes: p.receiptBytes }
          : null,
      status: p.status,
      opensAccess: p.opensAccess,
      late: late(p),
      reason: p.reason,
      paidUntil: p.paidUntil,
      createdAt: p.createdAt.toISOString(),
      createdBy: p.createdBy,
      decidedAt: p.decidedAt ? p.decidedAt.toISOString() : null,
      decidedBy: p.decidedBy,
      version: p.version,
    })),
    history: card.history.map((h) => ({ ...h, at: h.at.toISOString() })),
    // Выбрать можно действующий вид или тот, что уже стоит у организации (прототип subEditFields).
    plans: plans
      .filter((k) => k.active || k.id === s?.planId)
      .map((k) => ({
        id: k.id,
        name: k.name,
        months: k.months,
        discountPct: k.discountPct,
        active: k.active,
      })),
    prices: { seatStep: prices.seatStep, extraDiscountOver: prices.extraDiscountOver },
    // Экран «Подписка» владельца — та же функция, что у него (прототип `subScreenHtml(orgId, {admin})`).
    screen: await subscriptionScreenOf(tx, orgId, today),
  };
}

export function subscriptionCardHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionCardRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { orgId } = c.req.valid('param');
    const body = await withOrgContext(deps.db, { orgId, userId: adminOf(c) }, (tx) =>
      cardOf(tx, orgId, todayOf(deps)),
    );
    return c.json(body, 200);
  };
}

/* ── Чек: просмотр, «Подтвердить оплату», «Отклонить» (блок 6, пункт 3) ── */

const payParam = z.object({ id: Uuid });

export const subscriptionReceiptRoute = createRoute({
  method: 'get',
  path: '/admin/subscriptions/payments/{id}/receipt',
  tags: ['admin'],
  summary: 'Чек оплаты подписки: ссылка на просмотр на 15 минут',
  middleware: [requirePlatformAdmin] as const,
  request: { params: payParam },
  responses: {
    200: { description: 'Ссылка на просмотр чека', content: json(FileLink) },
    ...denied,
    404: { description: 'Нет оплаты или у неё нет чека', content: error },
  },
});

/**
 * «Чек» в окне Админки (прототип `subFileBtn`): чек — PDF или картинка (тип проверен при загрузке и
 * ограничением базы), открывается в браузере, а не скачивается.
 */
export function subscriptionReceiptHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionReceiptRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id } = c.req.valid('param');
    const receipt = await withUserContext(deps.db, adminOf(c), (tx) =>
      adminSubscriptionReceipt(tx, id),
    );
    if (!receipt) apiFail(404, 'not_found', 'Файл не найден');
    const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
    const url = await deps.storage.signedDownloadUrl(receipt.key, {
      expiresInSeconds: FILE_LINK_SECONDS,
      fileName: receipt.name,
      inline: { contentType: receipt.type },
    });
    return c.json({ url, expiresAt: expiresAt.toISOString() }, 200);
  };
}

const decided = {
  description:
    'Оплату уже проверили (`sub_pay_decided`) или заявка изменена другим пользователем (`record_changed`)',
  content: error,
};

/** Организация оплаты — вне контекста организации; нет оплаты — 404. */
async function paymentOrgOf(deps: ApiDeps, userId: string, id: string): Promise<string> {
  const orgId = await withUserContext(deps.db, userId, (tx) => subscriptionPaymentOrg(tx, id));
  if (!orgId) throw new RecordNotFoundError('subscription_payment', id);
  return orgId;
}

/** Отказ «Оплату уже проверили» — 409 с кодом словаря. */
function decidedFail(err: unknown): never {
  if (err instanceof SubscriptionPaymentDecidedError) {
    apiFail(409, err.code, 'Оплату уже проверили', { status: err.status });
  }
  throw err;
}

export const subscriptionConfirmRoute = createRoute({
  method: 'post',
  path: '/admin/subscriptions/payments/{id}/confirm',
  tags: ['admin'],
  summary: '«Подтвердить оплату»: подписка начинает действовать сразу',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: payParam,
    body: { required: true, content: json(SubscriptionConfirmRequest) },
  },
  responses: {
    200: { description: 'Подтверждено: окно подписки', content: json(AdminSubscriptionCard) },
    400: { description: 'Число месяцев продления — не от 1 до 36', content: error },
    ...denied,
    404: { description: 'Оплаты нет', content: error },
    409: decided,
  },
});

/**
 * «Подтвердить оплату» (прототип `subPayOk`): продление ставит вид, пакет, память и «Оплачено до» из
 * заявки (месяцы и дату администратор может поправить), расширение и память — сразу или со
 * следующего месяца; подтверждённую назад не вернуть. История подписки — «Оплата подтверждена» с тем,
 * что оплачено, суммой и прежним статусом.
 */
export function subscriptionConfirmHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionConfirmRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const userId = adminOf(c);
    const today = todayOf(deps);
    const orgId = await paymentOrgOf(deps, userId, id);
    // Тексты и время сообщения владельцам — до транзакции (внутри неё — только `tx`, п. О-46).
    const nc = await subNoticeContext(deps, deps.config.APP_BASE_URL);
    const { card, queued } = await withOrgContext(deps.db, { orgId, userId }, async (tx) => {
      const p = await lockPendingPayment(tx, id, body.version).catch(decidedFail);
      const pay = pendingPaymentOf(p);
      if (pay.kind === 'renew' && body.months < 1) {
        apiFail(400, 'sub_confirm_months', 'От 1 до 36 месяцев', { field: 'months' });
      }
      const cur = await lockSubscription(tx, orgId);
      const was = (await orgUsage(tx, today, { bytes: false }))?.status ?? 'none';
      const r = subscriptionConfirm(
        cur,
        pay,
        {
          months: pay.kind === 'renew' ? body.months : p.months,
          paidUntil: body.paidUntil as IsoDate,
        },
        today,
      );
      await saveSubscription(tx, orgId, cur, r.sub);
      await decidePayment(tx, p, {
        status: 'confirmed',
        months: r.months,
        paidUntil: r.paidUntil,
      });
      await writeSubscriptionHistory(tx, orgId, 'sub_paid', [
        { field: 'kind', to: p.kind },
        { field: 'amount', to: Number(p.amount) },
        ...(p.kind === 'renew' ? [{ field: 'months', to: r.months }] : []),
        { field: 'paidUntil', from: cur?.paidUntil ?? null, to: r.paidUntil },
        { field: 'status', from: was },
      ]);
      const view = await cardOf(tx, orgId, today);
      // Владельцам — «Оплата подтверждена» в Telegram и колокольчик (поток Т, `notifySubOwners`; один
      // раз на оплату), сообщения уходят сразу после транзакции.
      const sent = await notifySubOwners(
        tx,
        nc,
        orgId,
        { event: 'paid', org: view.org.name, paidUntil: r.paidUntil },
        `sub_paid:${id}`,
      );
      return { card: view, queued: sent.queued };
    });
    await flushEvents(deps, orgId, queued);
    return c.json(card, 200);
  };
}

export const subscriptionRejectRoute = createRoute({
  method: 'post',
  path: '/admin/subscriptions/payments/{id}/reject',
  tags: ['admin'],
  summary: '«Отклонить» чек: причина обязательна, её видит организация',
  middleware: [requirePlatformAdmin] as const,
  request: { params: payParam, body: { required: true, content: json(SubscriptionRejectRequest) } },
  responses: {
    200: { description: 'Отклонено: окно подписки', content: json(AdminSubscriptionCard) },
    400: { description: 'Нет причины', content: error },
    ...denied,
    404: { description: 'Оплаты нет', content: error },
    409: decided,
  },
});

/**
 * «Отклонить» (прототип `subPayRej`): доступ, открытый по чеку, закрывается, если «Оплачено до»
 * прошло (это считает `app.org_usage`), новый чек доступ заранее не откроет.
 */
export function subscriptionRejectHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionRejectRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const userId = adminOf(c);
    const today = todayOf(deps);
    const orgId = await paymentOrgOf(deps, userId, id);
    const nc = await subNoticeContext(deps, deps.config.APP_BASE_URL);
    const { card, queued } = await withOrgContext(deps.db, { orgId, userId }, async (tx) => {
      const p = await lockPendingPayment(tx, id, body.version).catch(decidedFail);
      await decidePayment(tx, p, { status: 'rejected', reason: body.reason });
      await writeSubscriptionHistory(
        tx,
        orgId,
        'sub_rejected',
        [
          { field: 'kind', to: p.kind },
          { field: 'amount', to: Number(p.amount) },
        ],
        body.reason,
      );
      const view = await cardOf(tx, orgId, today);
      // Владельцам — «Чек отклонён» с причиной (поток Т, `notifySubOwners`; один раз на оплату).
      const sent = await notifySubOwners(
        tx,
        nc,
        orgId,
        { event: 'rejected', org: view.org.name, reason: body.reason },
        `sub_rejected:${id}`,
      );
      return { card: view, queued: sent.queued };
    });
    await flushEvents(deps, orgId, queued);
    return c.json(card, 200);
  };
}

/* ── «Изменить подписку» (блок 6, пункт 4) ── */

export const subscriptionEditRoute = createRoute({
  method: 'put',
  path: '/admin/subscriptions/{orgId}',
  tags: ['admin'],
  summary: '«Изменить подписку» или «Поставить подписку» с причиной',
  middleware: [requirePlatformAdmin] as const,
  request: { params: orgParam, body: { required: true, content: json(SubscriptionEditRequest) } },
  responses: {
    200: { description: 'Сохранено: окно подписки', content: json(AdminSubscriptionCard) },
    400: {
      description: 'Неверное поле (`details.field`) или нет причины',
      content: error,
    },
    ...denied,
    404: { description: 'Организации нет', content: error },
    409: {
      description:
        'Изменений нет (`sub_no_change`), вид выключили (`sub_plan`) или подписку изменил другой (`record_changed`)',
      content: error,
    },
  },
});

/** Вид, которого нет в изменениях истории, — названием не подменяется: в истории — коды. */
const asHistory = (changes: readonly { field: string; from?: unknown; to: unknown }[]) =>
  changes.map((c): HistoryChange => ({ ...c }) as HistoryChange);

/**
 * «Изменить подписку» (прототип `subEditDlg` → `subSet`): проверки — `subscriptionEditProblems`
 * (вид — действующий или уже стоящий), дополнительная скидка — только при пакете больше порога,
 * «Бесплатный период» — ещё и строка «Истории оплат» без суммы. Статус ставит система по дате и чекам.
 */
export function subscriptionEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionEditRoute, AppEnv> {
  return async (c) => {
    const { orgId } = c.req.valid('param');
    const body = c.req.valid('json');
    const userId = adminOf(c);
    const today = todayOf(deps);
    const card = await withOrgContext(deps.db, { orgId, userId }, async (tx) => {
      if (!(await orgUsage(tx, today, { bytes: false }))) {
        throw new RecordNotFoundError('organization', orgId);
      }
      const cur = await lockSubscription(tx, orgId);
      if (cur ? body.version !== cur.version : body.version !== undefined) {
        throw new RecordChangedError('subscription', orgId, cur?.version ?? 0);
      }
      const terms = await subscriptionTerms(tx);
      const [problem] = subscriptionEditProblems(
        body,
        terms.prices,
        terms.plans,
        cur?.planId ?? null,
      );
      if (problem) subscriptionEditFail(problem);
      const r = subscriptionEdit(cur, body, terms.prices.extraDiscountOver);
      if (!r) apiFail(409, 'sub_no_change', 'Изменений нет');
      await saveSubscription(tx, orgId, cur, r.sub);
      if (body.free) await insertFreePayment(tx, orgId, r.sub, body.reason);
      await writeSubscriptionHistory(
        tx,
        orgId,
        cur ? 'update' : 'create',
        asHistory(r.changes),
        body.reason,
      );
      return cardOf(tx, orgId, today);
    });
    return c.json(card, 200);
  };
}

/* ── «Виды подписок» (блок 6, пункт 5) ── */

export const subscriptionPlansRoute = createRoute({
  method: 'get',
  path: '/admin/subscription-plans',
  tags: ['admin'],
  summary: '«Виды подписок» и «История изменений» видов и цен',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Виды по порядку и последние 50 изменений',
      content: json(AdminSubscriptionPlans),
    },
    ...denied,
  },
});

async function plansOf(tx: Tx): Promise<AdminSubscriptionPlans> {
  const plans = await subscriptionPlanRows(tx);
  const usage = await subscriptionPlanUsage(tx);
  const history = await subscriptionConfigHistory(tx);
  return {
    plans: plans.map((k) => ({
      id: k.id,
      name: k.name,
      months: k.months,
      discountPct: k.discountPct,
      perks: k.perks,
      sortOrder: k.sortOrder,
      active: k.active,
      subs: usage.get(k.id)?.subs ?? 0,
      pays: usage.get(k.id)?.pays ?? 0,
      version: k.version,
    })),
    history: history.map((h) => ({
      id: h.id,
      at: h.at.toISOString(),
      entity: h.entity as 'subscription_plan' | 'subscription_settings',
      entityId: h.entityId,
      action: h.action,
      plan: h.plan,
      changes: h.changes,
    })),
  };
}

export function subscriptionPlansHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionPlansRoute, AppEnv> {
  return async (c) => {
    const body = await withUserContext(deps.db, adminOf(c), plansOf);
    return c.json(body, 200);
  };
}

const planFail = (problem: { field: string; code: keyof typeof SUBSCRIPTION_PLAN_MESSAGES }) =>
  apiFail(400, problem.code, SUBSCRIPTION_PLAN_MESSAGES[problem.code], { field: problem.field });

/** Вид из окна: преимущества — строки без пустых; проверки — `subscriptionPlanProblems`. */
function planInput(
  body: SubscriptionPlanRequest,
  others: readonly string[],
): ReturnType<typeof planInputOf> {
  const x = {
    name: body.name.trim(),
    months: body.months,
    discountPct: body.discountPct,
    perks: subscriptionPerksOf(body.perks),
    sortOrder: body.sortOrder,
    active: body.active,
  };
  const [problem] = subscriptionPlanProblems(x, others);
  if (problem) planFail(problem);
  return x;
}

/** Код нового вида — как в прототипе («k» и время) и ещё случайная часть: два окна не совпадут. */
const newPlanId = (now: Date) => `k${now.getTime().toString(36)}${randomBytes(3).toString('hex')}`;

const planSaveResponses = {
  200: { description: 'Сохранено: виды и история', content: json(AdminSubscriptionPlans) },
  400: { description: 'Неверное поле (`details.field`)', content: error },
  ...denied,
} as const;

export const subscriptionPlanCreateRoute = createRoute({
  method: 'post',
  path: '/admin/subscription-plans',
  tags: ['admin'],
  summary: 'Новый вид подписки',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(SubscriptionPlanRequest) } },
  responses: planSaveResponses,
});

export function subscriptionPlanCreateHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionPlanCreateRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const result = await withUserContext(deps.db, adminOf(c), async (tx) => {
      await lockSubscriptionPlans(tx);
      const others = (await subscriptionPlanRows(tx)).map((k) => k.name);
      await createSubscriptionPlan(tx, planInput(body, others), newPlanId(deps.clock.now()));
      return plansOf(tx);
    });
    return c.json(result, 200);
  };
}

const planParam = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/) });

export const subscriptionPlanUpdateRoute = createRoute({
  method: 'put',
  path: '/admin/subscription-plans/{id}',
  tags: ['admin'],
  summary: 'Изменить, выключить или включить вид подписки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: planParam, body: { required: true, content: json(SubscriptionPlanUpdate) } },
  responses: {
    200: { description: 'Сохранено: виды и история', content: json(AdminSubscriptionPlans) },
    400: { description: 'Неверное поле (`details.field`)', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/** Изменения нет — ответ тот же, без записи истории (прототип: «Изменений нет»). */
export function subscriptionPlanUpdateHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionPlanUpdateRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await withUserContext(deps.db, adminOf(c), async (tx) => {
      await lockSubscriptionPlans(tx);
      const k = await lockSubscriptionPlan(tx, id, body.version);
      const others = (await subscriptionPlanRows(tx)).filter((x) => x.id !== id).map((x) => x.name);
      const x = planInput(body, others);
      const changes = subscriptionPlanChanges(planInputOf(k), x);
      if (changes.length) await updateSubscriptionPlan(tx, k, x, changes);
      return plansOf(tx);
    });
    return c.json(result, 200);
  };
}

export const subscriptionPlanDeleteRoute = createRoute({
  method: 'delete',
  path: '/admin/subscription-plans/{id}',
  tags: ['admin'],
  summary: 'Удалить вид подписки без подписок и оплат',
  middleware: [requirePlatformAdmin] as const,
  request: { params: planParam, query: SubscriptionPlanDelete },
  responses: {
    200: { description: 'Удалён: виды и история', content: json(AdminSubscriptionPlans) },
    ...denied,
    404: versionedSaveResponses[404],
    409: {
      description:
        'По виду есть подписки или оплаты (`sub_kind_used`) или вид изменил другой (`record_changed`)',
      content: error,
    },
  },
});

const PLAN_USED = 'По этому виду есть подписки или оплаты — его можно только выключить';

export function subscriptionPlanDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionPlanDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const result = await withUserContext(deps.db, adminOf(c), async (tx) => {
      const k = await lockSubscriptionPlan(tx, id, version);
      const used = (await subscriptionPlanUsage(tx)).get(id);
      if (used && (used.subs || used.pays)) apiFail(409, 'sub_kind_used', PLAN_USED);
      try {
        await tx.transaction(async (sp) => deleteSubscriptionPlan(sp, k));
      } catch (err) {
        // Подписку или оплату по виду успели завести: внешний ключ не даёт удалить.
        if (foreignKeyViolation(err)) apiFail(409, 'sub_kind_used', PLAN_USED);
        throw err;
      }
      return plansOf(tx);
    });
    return c.json(result, 200);
  };
}

/* ── «Цены и реквизиты» (блок 6, пункт 6) ── */

type Settings = Awaited<ReturnType<typeof subscriptionSettingsOf>>;

/** Строка «Цен и реквизитов» полями окна: включённая память — ГБ, реквизиты — строками. */
const settingsFields = (s: Settings): SubscriptionSettingsInput => ({
  seatPrice: Number(s.seatPrice),
  seatStep: s.seatStep,
  gbPrice: Number(s.gbPrice),
  baseGb: Math.round(s.baseMb / 1000),
  seatMb: s.seatMb,
  firstMonthPct: s.firstMonthPct,
  extraDiscountOver: s.extraDiscountOver,
  remindDays: s.remindDays,
  checkDays: s.checkDays,
  recipient: s.recipient ?? '',
  recipientInn: s.recipientInn ?? '',
  bank: s.bank ?? '',
  bik: s.bik ?? '',
  account: s.account ?? '',
  purpose: s.purpose ?? '',
});

async function settingsOf(tx: Tx): Promise<AdminSubscriptionSettings> {
  const s = await subscriptionSettingsOf(tx);
  const { history } = await plansOf(tx);
  return { ...settingsFields(s), version: s.version, history };
}

export const subscriptionSettingsRoute = createRoute({
  method: 'get',
  path: '/admin/subscription-settings',
  tags: ['admin'],
  summary: '«Цены и реквизиты» подписок',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Цены, сроки и реквизиты платформы с историей',
      content: json(AdminSubscriptionSettings),
    },
    ...denied,
  },
});

export function subscriptionSettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionSettingsRoute, AppEnv> {
  return async (c) => {
    const body = await withUserContext(deps.db, adminOf(c), settingsOf);
    return c.json(body, 200);
  };
}

export const subscriptionSettingsUpdateRoute = createRoute({
  method: 'put',
  path: '/admin/subscription-settings',
  tags: ['admin'],
  summary: 'Сохранить «Цены и реквизиты»: новые цены — для новых оплат',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(SubscriptionSettingsUpdate) } },
  responses: {
    200: { description: 'Сохранено', content: json(AdminSubscriptionSettings) },
    400: { description: 'Неверное поле (`details.field`)', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Сохранить» (прототип `subPricesPart`): проверки — `subscriptionSettingsProblems`, изменения —
 * «было → стало» по каждому полю; без изменений — 409 `sub_no_change` («Изменений нет»).
 */
export function subscriptionSettingsUpdateHandler(
  deps: ApiDeps,
): RouteHandler<typeof subscriptionSettingsUpdateRoute, AppEnv> {
  return async (c) => {
    const { version, ...body } = c.req.valid('json');
    const x: SubscriptionSettingsInput = {
      ...body,
      recipient: body.recipient.trim(),
      recipientInn: body.recipientInn.trim(),
      bank: body.bank.trim(),
      bik: body.bik.trim(),
      account: body.account.trim(),
      purpose: body.purpose.trim(),
    };
    const [problem] = subscriptionSettingsProblems(x);
    if (problem) {
      const params = problem.params ?? {};
      const message = SUBSCRIPTION_SETTINGS_MESSAGES[problem.code].replace(
        /\{(\w+)\}/g,
        (all, key: string) => (key in params ? String(params[key]) : all),
      );
      apiFail(400, problem.code, message, { field: problem.field, ...params });
    }
    const result = await withUserContext(deps.db, adminOf(c), async (tx) => {
      const was = settingsFields(await subscriptionSettingsOf(tx));
      const keys = [
        ...SUBSCRIPTION_PRICE_FIELDS.map((f) => f.key),
        ...SUBSCRIPTION_REQUISITE_FIELDS.map((f) => f.key),
      ];
      const changes = keys
        .filter((k) => was[k] !== x[k])
        .map((k) => ({ field: k, from: was[k], to: x[k] }));
      if (!changes.length) apiFail(409, 'sub_no_change', 'Изменений нет');
      const { baseGb, ...rest } = x;
      await updateSubscriptionSettings(
        tx,
        version,
        {
          ...rest,
          baseMb: baseGb * 1000,
          recipientInn: x.recipientInn || null,
        },
        changes,
      );
      return settingsOf(tx);
    });
    return c.json(result, 200);
  };
}
