import {
  RecordChangedError,
  RecordNotFoundError,
  SUBSCRIPTION_MB_BYTES,
  SUBSCRIPTION_STATUS_ORDER,
  bishkekDate,
  type HistoryChange,
  type IsoDate,
  type ListQuery,
  type ListSort,
  type SubscriptionEditPlan,
  type SubscriptionPaymentKind,
  type SubscriptionPaymentStatus,
  type SubscriptionPendingPayment,
  type SubscriptionPlanInput,
  type SubscriptionPrices,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { subscriptionPlanNames, withPlanNames } from './admin-org-card';
import { writePlatformHistory } from './platform-history';
import {
  auditLog,
  employees,
  orgSubscriptions,
  organizations,
  platformAuditLog,
  subscriptionPayments,
  subscriptionPlans,
  subscriptionSettings,
} from './schema';

/*
 * Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6; прототип admin/subs-admin.js).
 * Подписку организации ставит и меняет только администратор платформы: в контексте организации записи
 * (`withOrgContext` с его учётной записью — политики `org_subscriptions` и `subscription_payments` пускают
 * только его), список всех организаций — вне контекста организации (`withUserContext`: политики
 * `…_admin_read`, `app.admin_organizations`, `app.org_usage`). Виды подписок и цены — общие данные
 * платформы, их история — `platform_audit_log`.
 */

/** Что нужно проверке подписки от администратора (`subscriptionEditProblems`): шаг, порог, виды. */
export interface SubscriptionTerms {
  prices: { seatStep: number; extraDiscountOver: number };
  plans: SubscriptionEditPlan[];
}

/**
 * Шаг пакета и порог дополнительной скидки из «Цен и реквизитов» (строки нет — как в прототипе:
 * 10 и 150) и все виды подписки по порядку. Только `tx` открытой транзакции.
 */
export async function subscriptionTerms(tx: Tx): Promise<SubscriptionTerms> {
  const [settings] = await tx
    .select({
      seatStep: subscriptionSettings.seatStep,
      extraDiscountOver: subscriptionSettings.extraDiscountOver,
    })
    .from(subscriptionSettings)
    .where(eq(subscriptionSettings.id, 1));
  const plans = await tx
    .select({
      id: subscriptionPlans.id,
      discountPct: subscriptionPlans.discountPct,
      active: subscriptionPlans.active,
    })
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.id));
  return { prices: settings ?? { seatStep: 10, extraDiscountOver: 150 }, plans };
}

/* ── «Организации»: список подписок (блок 6, пункт 2) ── */

const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_]/gi, '')}"`);

/**
 * Все организации платформы с подпиской, местами, памятью, статусом и чеком на проверке. Чек ждёт
 * дольше срока — дней после дня прикрепления (по Бишкеку) больше «Срока проверки чека» (прототип
 * `subPayLate`). Первая и последняя оплата — подтверждённые оплаты с суммой.
 */
function subscriptionsSource(today: IsoDate): SQL {
  const order = sql.raw(
    `case r0.status ${Object.entries(SUBSCRIPTION_STATUS_ORDER)
      .map(([k, v]) => `when '${k}' then ${v}`)
      .join(' ')} else 9 end`,
  );
  return sql`(
    select r0.*,
      (case when r0.late then 0 else ${order} + 1 end) * 1000000
        + coalesce(r0.paid_until - date '2000-01-01', 999999) as sort_key
    from (
      select
        o.id as id,
        o.name as name,
        o.is_demo as demo,
        o.status as org_status,
        o.owner_login as owner,
        o.created_at as created_at,
        s.plan_id as plan_id,
        k.name as plan_name,
        coalesce(s.free, false) as free,
        u.seats_used as seats_used,
        coalesce(u.seats_limit, 0) as pack,
        coalesce(u.bytes_used, 0) as bytes_used,
        -- Без подписки — «из 2 ГБ», как в прототипе (subMem: пакет 0, предел — baseMb); у демо — без предела.
        case when o.is_demo then u.bytes_limit
          else coalesce(u.bytes_limit, st.base_mb::bigint * ${SUBSCRIPTION_MB_BYTES}) end as bytes_limit,
        round(coalesce(u.bytes_used, 0)::numeric / ${SUBSCRIPTION_MB_BYTES})::bigint as mem_mb,
        u.paid_until as paid_until,
        u.status as status,
        s.extra_discount_pct as add_disc,
        w.id as pending_id,
        w.amount as pending_amount,
        w.sent_day as sent_day,
        coalesce(${today}::date - w.sent_day > st.check_days, false) as late,
        f.first_day as first_day,
        f.last_day as last_day
      from app.admin_organizations o
      join app.org_usage(${today}::date, true) u on u.org_id = o.id
      left join public.org_subscriptions s on s.org_id = o.id
      left join public.subscription_plans k on k.id = s.plan_id
      left join lateral (
        select p.id, p.amount, (p.created_at at time zone 'Asia/Bishkek')::date as sent_day
        from public.subscription_payments p
        where p.org_id = o.id and p.status = 'pending'
        limit 1
      ) w on true
      left join lateral (
        select
          min((p.created_at at time zone 'Asia/Bishkek')::date) as first_day,
          max((p.created_at at time zone 'Asia/Bishkek')::date) as last_day
        from public.subscription_payments p
        where p.org_id = o.id and p.status = 'confirmed' and p.amount > 0
      ) f on true
      cross join (
        select
          coalesce((select x.check_days from public.subscription_settings x where x.id = 1), 3)
            as check_days,
          coalesce((select x.base_mb from public.subscription_settings x where x.id = 1), 2000)
            as base_mb
      ) st
    ) r0
  ) as r`;
}

/** ГБ одним знаком после запятой, как `subGb` прототипа: «9,4», «14». */
const gbSql = (bytes: SQL) =>
  sql`replace(regexp_replace(to_char(round(${bytes}::numeric / ${SUBSCRIPTION_MB_BYTES} / 1000, 1), 'FM999999990.0'), '\\.0$', ''), '.', ',')`;

const rowFields = {
  id: sql<string>`${field('id')}`,
  name: sql<string>`${field('name')}`,
  demo: sql<boolean>`${field('demo')}`,
  orgStatus: sql<string>`${field('org_status')}`,
  owner: sql<string | null>`${field('owner')}`,
  planId: sql<string | null>`${field('plan_id')}`,
  planName: sql<string | null>`${field('plan_name')}`,
  free: sql<boolean>`${field('free')}`,
  seatsUsed: sql<number>`${field('seats_used')}`,
  pack: sql<number>`${field('pack')}`,
  bytesUsed: sql<string>`${field('bytes_used')}`,
  bytesLimit: sql<string | null>`${field('bytes_limit')}`,
  paidUntil: sql<string | null>`${field('paid_until')}::text`,
  status: sql<SubscriptionStatus>`${field('status')}`,
  addDisc: sql<number | null>`${field('add_disc')}`,
  pendingId: sql<string | null>`${field('pending_id')}`,
  pendingAmount: sql<string | null>`${field('pending_amount')}`,
  late: sql<boolean>`${field('late')}`,
  firstDay: sql<string | null>`${field('first_day')}::text`,
  lastDay: sql<string | null>`${field('last_day')}::text`,
};

type Raw = {
  [K in keyof typeof rowFields]: (typeof rowFields)[K] extends SQL<infer T> ? T : never;
};

/** Строка списка «Подписки» Админки. */
export interface AdminSubscriptionRow {
  id: string;
  name: string;
  demo: boolean;
  blocked: boolean;
  owner: string | null;
  planId: string | null;
  planName: string | null;
  free: boolean;
  seatsUsed: number;
  pack: number;
  bytesUsed: number;
  bytesLimit: number | null;
  paidUntil: IsoDate | null;
  status: SubscriptionStatus;
  extraDiscountPct: number;
  pendingId: string | null;
  pendingAmount: number | null;
  late: boolean;
  firstPaid: IsoDate | null;
  lastPaid: IsoDate | null;
}

const toRow = (r: Raw): AdminSubscriptionRow => ({
  id: r.id,
  name: r.name,
  demo: r.demo,
  blocked: r.orgStatus !== 'active',
  owner: r.owner,
  planId: r.planId,
  planName: r.planName,
  free: r.free,
  seatsUsed: Number(r.seatsUsed),
  pack: Number(r.pack),
  bytesUsed: Number(r.bytesUsed),
  bytesLimit: r.bytesLimit === null ? null : Number(r.bytesLimit),
  paidUntil: r.paidUntil,
  status: r.status,
  extraDiscountPct: Number(r.addDisc ?? 0),
  pendingId: r.pendingId,
  pendingAmount: r.pendingAmount === null ? null : Number(r.pendingAmount),
  late: r.late === true,
  firstPaid: r.firstDay,
  lastPaid: r.lastDay,
});

/**
 * Столбцы (прототип: сетка `adm-subs`): организация, вид, пакет «занято из пакета», память «X из Y ГБ»
 * (сортировка — по доле занятого), «Оплачено до», статус (сортировка — `subSortKey`: чеки дольше срока,
 * затем по статусу и «Оплачено до»), сумма на проверке; скрытые — дополнительная скидка, первая и
 * последняя оплата, владелец.
 */
function subscriptionColumns(t: ListTexts): ListColumns {
  const status = field('status');
  const statusText = sql`case ${status} ${sql.join(
    Object.keys(SUBSCRIPTION_STATUS_ORDER).map(
      (k) => sql`when ${sql.raw(`'${k}'`)} then ${t(`subs.st.${k}`)}`,
    ),
    sql` `,
  )} end`;
  const kind = sql`case when ${field('demo')} or ${field('plan_id')} is null then '' when ${field('free')} then 'free' else ${field('plan_id')} end`;
  return {
    name: { type: 'text', label: 'subs.col.name', value: field('name') },
    kind: {
      type: 'enum',
      label: 'subs.col.kind',
      value: kind,
      display: sql`case when ${field('demo')} or ${field('plan_id')} is null then '—' when ${field('free')} then ${t('subs.kind.free')} else ${field('plan_name')} end`,
    },
    pack: {
      type: 'int',
      label: 'subs.col.pack',
      value: field('pack'),
      total: true,
      display: sql`${field('seats_used')}::text || ${` ${t('subs.of')} `} || ${field('pack')}::text`,
    },
    mem: {
      type: 'int',
      label: 'subs.col.mem',
      value: field('mem_mb'),
      sort: {
        value: sql`case when coalesce(${field('bytes_limit')}, 0) > 0 then ${field('bytes_used')}::numeric / ${field('bytes_limit')} else 0 end`,
        text: false,
      },
      display: sql`${gbSql(field('bytes_used'))} || ${` ${t('subs.of')} `} || case when ${field('bytes_limit')} is null then '∞' else ${gbSql(field('bytes_limit'))} end || ${` ${t('subs.gb')}`}`,
    },
    paidTo: { type: 'date', label: 'subs.col.paid_to', value: field('paid_until') },
    st: {
      type: 'enum',
      label: 'subs.col.st',
      value: status,
      display: statusText,
      sort: { value: field('sort_key'), text: false },
    },
    chk: { type: 'money', label: 'subs.col.chk', value: field('pending_amount'), total: true },
    add: { type: 'int', label: 'subs.col.add', value: sql`coalesce(${field('add_disc')}, 0)` },
    first: { type: 'date', label: 'subs.col.first', value: field('first_day') },
    last: { type: 'date', label: 'subs.col.last', value: field('last_day') },
    owner: { type: 'text', label: 'subs.col.owner', value: field('owner') },
  };
}

/** По умолчанию — по статусу (прототип `sort: {key: 'st', dir: 1}`). */
const SORT: ListSort = { key: 'st', dir: 'asc' };
const NATURAL = [field('sort_key'), field('name'), field('id')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

export async function listSubscriptionsPage(
  tx: Tx,
  query: ListQuery,
  today: IsoDate,
  t: ListTexts,
) {
  const source = subscriptionsSource(today);
  const page = await selectListPage({
    query,
    columns: subscriptionColumns(t),
    natural: NATURAL,
    defaultSort: SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...rowFields, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r)) };
}

export function listSubscriptionValues(
  tx: Tx,
  key: string,
  today: IsoDate,
  t: ListTexts,
  q?: string,
) {
  return selectListValues({
    columns: subscriptionColumns(t),
    key,
    scope: undefined,
    from: fromOf(tx, subscriptionsSource(today)),
    q,
  });
}

export function exportSubscriptions(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  today: IsoDate,
  t: ListTexts,
) {
  return selectListExport({
    query,
    columns: subscriptionColumns(t),
    keys,
    natural: NATURAL,
    defaultSort: SORT,
    scope: undefined,
    from: fromOf(tx, subscriptionsSource(today)),
  });
}

/** Плашки «Ждут подтверждения», «Просрочены», «Скоро истекают», «Активны» и чеки дольше срока. */
export async function subscriptionsSummary(
  tx: Tx,
  today: IsoDate,
): Promise<{ byStatus: Partial<Record<SubscriptionStatus, number>>; late: number }> {
  const rows = await tx
    .select({
      status: sql<SubscriptionStatus>`${field('status')}`,
      n: sql<number>`count(*)::integer`,
      late: sql<number>`count(*) filter (where ${field('late')})::integer`,
    })
    .from(subscriptionsSource(today))
    .groupBy(field('status'));
  const byStatus: Partial<Record<SubscriptionStatus, number>> = {};
  let late = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.n);
    late += Number(r.late);
  }
  return { byStatus, late };
}

/** Чеков на проверке по всем организациям — число у вкладки «Подписки» (прототип `subWaitN`). */
export async function pendingSubscriptionPayments(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::integer` })
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.status, 'pending'));
  return Number(row?.n ?? 0);
}

/* ── Окно «Подписка организации» (блок 6, пункты 2–4, 7) ── */

const creator = alias(employees, 'creator');
const decider = alias(employees, 'decider');
const actor = alias(employees, 'actor');

/** Строка «Истории оплат» для Админки: кто отправил и кто проверил (без сотрудника — администратор). */
export interface AdminSubscriptionPayment {
  id: string;
  kind: SubscriptionPaymentKind;
  startMode: 'now' | 'next';
  planId: string;
  months: number;
  seats: number;
  extraGb: number;
  amount: number;
  lines: unknown;
  receiptName: string | null;
  receiptType: string | null;
  receiptBytes: number | null;
  status: SubscriptionPaymentStatus;
  opensAccess: boolean;
  reason: string | null;
  paidUntil: IsoDate | null;
  createdAt: Date;
  createdBy: { name: string | null; admin: boolean; system: boolean };
  decidedAt: Date | null;
  decidedBy: { name: string | null; admin: boolean } | null;
  version: number;
}

/** Запись «Истории изменений» подписки. */
export interface AdminSubscriptionHistoryEntry {
  id: string;
  at: Date;
  actor: string | null;
  actorAdmin: boolean;
  action: string;
  changes: HistoryChange[];
  reason: string | null;
}

/** Подписка организации — строкой домена (нет — null). */
async function subscriptionStateOf(
  tx: Tx,
  orgId: string,
  lock = false,
): Promise<(SubscriptionState & { version: number }) | null> {
  const q = tx
    .select({
      planId: orgSubscriptions.planId,
      seats: orgSubscriptions.seats,
      extraGb: orgSubscriptions.extraGb,
      paidUntil: orgSubscriptions.paidUntil,
      extraDiscountPct: orgSubscriptions.extraDiscountPct,
      firstPaid: orgSubscriptions.firstPaid,
      free: orgSubscriptions.free,
      nextSeats: orgSubscriptions.nextSeats,
      nextExtraGb: orgSubscriptions.nextExtraGb,
      nextFrom: orgSubscriptions.nextFrom,
      version: orgSubscriptions.version,
    })
    .from(orgSubscriptions)
    .where(eq(orgSubscriptions.orgId, orgId));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

/** «Цены и реквизиты» строкой (нет строки — значения по умолчанию таблицы). */
export async function subscriptionSettingsOf(tx: Tx) {
  const [row] = await tx.select().from(subscriptionSettings).where(eq(subscriptionSettings.id, 1));
  if (!row) throw new RecordNotFoundError('subscription_settings', '1');
  return row;
}

/** Цены для расчёта суммы (`subscriptionCalc`). */
export const subscriptionPricesOf = (
  s: Awaited<ReturnType<typeof subscriptionSettingsOf>>,
): SubscriptionPrices => ({
  seatPrice: Number(s.seatPrice),
  gbPrice: Number(s.gbPrice),
  seatStep: s.seatStep,
  baseMb: s.baseMb,
  seatMb: s.seatMb,
  firstMonthPct: s.firstMonthPct,
  extraDiscountOver: s.extraDiscountOver,
});

/** Виды подписок по порядку — со всеми полями. */
export function subscriptionPlanRows(tx: Tx) {
  return tx
    .select()
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.id));
}

/**
 * Данные окна «Подписка организации» (в `withOrgContext` организации от имени администратора): сама
 * организация, подписка, оплаты с авторами и история подписки (новые сверху, до 200 записей).
 */
export async function adminSubscriptionCard(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      inn: organizations.inn,
      demo: organizations.isDemo,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new RecordNotFoundError('organization', orgId);
  const sub = await subscriptionStateOf(tx, orgId);
  const pays = await tx
    .select({
      p: subscriptionPayments,
      creatorName: creator.shortName,
      creatorEmp: creator.id,
      deciderName: decider.shortName,
      deciderEmp: decider.id,
    })
    .from(subscriptionPayments)
    .leftJoin(creator, eq(creator.userId, subscriptionPayments.createdBy))
    .leftJoin(decider, eq(decider.userId, subscriptionPayments.decidedBy))
    .where(eq(subscriptionPayments.orgId, orgId))
    .orderBy(desc(subscriptionPayments.createdAt), desc(subscriptionPayments.id));
  const payments: AdminSubscriptionPayment[] = pays.map(({ p, ...w }) => ({
    id: p.id,
    kind: p.kind,
    startMode: p.startMode,
    planId: p.planId,
    months: p.months,
    seats: p.seats,
    extraGb: p.extraGb,
    amount: Number(p.amount),
    lines: p.lines,
    receiptName: p.receiptName,
    receiptType: p.receiptType,
    receiptBytes: p.receiptBytes,
    status: p.status,
    opensAccess: p.opensAccess,
    reason: p.reason,
    paidUntil: p.paidUntil,
    createdAt: p.createdAt,
    createdBy: {
      name: w.creatorName,
      admin: p.createdBy !== null && w.creatorEmp === null,
      system: p.createdBy === null,
    },
    decidedAt: p.decidedAt,
    decidedBy: p.decidedBy ? { name: w.deciderName, admin: w.deciderEmp === null } : null,
    version: p.version,
  }));
  const history = await tx
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actor: actor.shortName,
      actorAdmin: sql<boolean>`${auditLog.actorUserId} is not null and ${actor.id} is null`,
      action: auditLog.action,
      changes: auditLog.changes,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
    .where(and(eq(auditLog.entity, 'subscription'), eq(auditLog.entityId, orgId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(200);
  const plans = await subscriptionPlanNames(tx);
  return {
    org,
    sub,
    payments,
    history: history.map((h): AdminSubscriptionHistoryEntry => ({
      id: String(h.id),
      at: h.at,
      actor: h.actor,
      actorAdmin: h.actorAdmin === true,
      action: h.action,
      changes: withPlanNames(h.changes, plans),
      reason: h.reason,
    })),
  };
}

/** Оплата организации контекста. */
async function paymentOf(tx: Tx, paymentId: string) {
  const [row] = await tx
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, paymentId));
  if (!row) throw new RecordNotFoundError('subscription_payment', paymentId);
  return row;
}

/** Организация оплаты — вне контекста организации, администратору. */
export async function subscriptionPaymentOrg(tx: Tx, paymentId: string): Promise<string | null> {
  const [row] = await tx
    .select({ orgId: subscriptionPayments.orgId })
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, paymentId));
  return row?.orgId ?? null;
}

/** Оплату уже проверили (прототип: «Оплату уже проверили»). */
export class SubscriptionPaymentDecidedError extends Error {
  readonly code = 'sub_pay_decided';
  constructor(readonly status: SubscriptionPaymentStatus) {
    super('subscription payment already decided');
  }
}

/** Заявка с чеком — для правила подтверждения домена. */
export const pendingPaymentOf = (
  p: typeof subscriptionPayments.$inferSelect,
): SubscriptionPendingPayment => {
  if (p.kind !== 'renew' && p.kind !== 'grow' && p.kind !== 'mem') {
    throw new SubscriptionPaymentDecidedError(p.status);
  }
  return {
    kind: p.kind,
    startMode: p.startMode,
    planId: p.planId,
    months: p.months,
    seats: p.seats,
    extraGb: p.extraGb,
    sentDay: bishkekDate(p.createdAt),
  };
};

/**
 * Заявка на проверке: блокировка строки, версия, статус. Проверенную заявку политика правки под
 * блокировку не отдаёт (меняется только непроверенная), поэтому статус читается и без блокировки: её
 * успели проверить раньше или в соседнем окне — «Оплату уже проверили».
 */
export async function lockPendingPayment(tx: Tx, paymentId: string, version: number) {
  const seen = await paymentOf(tx, paymentId);
  if (seen.status !== 'pending') throw new SubscriptionPaymentDecidedError(seen.status);
  const [p] = await tx
    .select()
    .from(subscriptionPayments)
    .where(eq(subscriptionPayments.id, paymentId))
    .for('update');
  if (!p || p.status !== 'pending') {
    throw new SubscriptionPaymentDecidedError((await paymentOf(tx, paymentId)).status);
  }
  if (p.version !== version) {
    throw new RecordChangedError('subscription_payment', paymentId, p.version);
  }
  return p;
}

/** Подписка организации под блокировкой — для подтверждения чека и «Изменить подписку». */
export const lockSubscription = (tx: Tx, orgId: string) => subscriptionStateOf(tx, orgId, true);

/**
 * Записать подписку организации контекста (новую или изменённую) от имени администратора. Версия —
 * +1 к прежней; строки нет — новая (политика пускает только администратора платформы).
 */
export async function saveSubscription(
  tx: Tx,
  orgId: string,
  was: { version: number } | null,
  s: SubscriptionState,
): Promise<number> {
  const values = {
    planId: s.planId,
    seats: s.seats,
    extraGb: s.extraGb,
    paidUntil: s.paidUntil!,
    extraDiscountPct: s.extraDiscountPct,
    firstPaid: s.firstPaid,
    free: s.free,
    nextSeats: s.nextSeats,
    nextExtraGb: s.nextExtraGb,
    nextFrom: s.nextFrom,
    updatedBy: sql`app.current_user_id()`,
  };
  if (!was) {
    // Два первых сохранения разом: второе — «запись изменена другим пользователем», не 500.
    const added = await tx
      .insert(orgSubscriptions)
      .values({ orgId, ...values })
      .onConflictDoNothing({ target: orgSubscriptions.orgId })
      .returning({ orgId: orgSubscriptions.orgId });
    if (added.length === 0) throw new RecordChangedError('subscription', orgId, 1);
    return 1;
  }
  await tx
    .update(orgSubscriptions)
    .set({ ...values, version: was.version + 1, updatedAt: sql`now()` })
    .where(eq(orgSubscriptions.orgId, orgId));
  return was.version + 1;
}

/** Решение по заявке: подтверждена (с «Оплачено до» и месяцами) или отклонена (с причиной). */
export async function decidePayment(
  tx: Tx,
  p: { id: string; version: number },
  d:
    | { status: 'confirmed'; months: number; paidUntil: IsoDate }
    | { status: 'rejected'; reason: string },
): Promise<void> {
  await tx
    .update(subscriptionPayments)
    .set({
      status: d.status,
      decidedBy: sql`app.current_user_id()`,
      decidedAt: sql`now()`,
      ...(d.status === 'confirmed'
        ? { months: d.months, paidUntil: d.paidUntil }
        : { reason: d.reason }),
      updatedBy: sql`app.current_user_id()`,
      updatedAt: sql`now()`,
      version: p.version + 1,
    })
    .where(eq(subscriptionPayments.id, p.id));
}

/**
 * Строка «Бесплатный период до …» в «Истории оплат» (прототип `subSet` с `free`): без суммы и чека,
 * подтверждённая сразу, от имени администратора.
 */
export async function insertFreePayment(
  tx: Tx,
  orgId: string,
  s: SubscriptionState,
  reason: string,
): Promise<void> {
  await tx.insert(subscriptionPayments).values({
    id: sql`gen_random_uuid()` as unknown as string,
    orgId,
    kind: 'free',
    planId: s.planId,
    months: 0,
    seats: s.seats,
    extraGb: s.extraGb,
    status: 'confirmed',
    reason,
    decidedBy: sql`app.current_user_id()` as unknown as string,
    decidedAt: sql`now()` as unknown as Date,
    paidUntil: s.paidUntil!,
    createdBy: sql`app.current_user_id()` as unknown as string,
  });
}

/** Запись «Истории изменений» подписки (и, как `log('porg')` прототипа, — истории организации). */
export function writeSubscriptionHistory(
  tx: Tx,
  orgId: string,
  action: 'create' | 'update' | 'sub_paid' | 'sub_rejected',
  changes: HistoryChange[],
  reason?: string | null,
) {
  return writeHistory(tx, { entity: 'subscription', entityId: orgId, action, changes, reason });
}

/* ── «Виды подписок» (блок 6, пункт 5) ── */

/** Сколько подписок по виду и есть ли оплаты — «Подписок» и «Удалить» (вне контекста организации). */
export async function subscriptionPlanUsage(
  tx: Tx,
): Promise<Map<string, { subs: number; pays: number }>> {
  const rows = await tx.execute<{ id: string; subs: number; pays: number }>(sql`
    select k.id,
      (select count(*)::integer from public.org_subscriptions s where s.plan_id = k.id) as subs,
      (select count(*)::integer from public.subscription_payments p where p.plan_id = k.id) as pays
    from public.subscription_plans k`);
  return new Map([...rows].map((r) => [r.id, { subs: Number(r.subs), pays: Number(r.pays) }]));
}

export const planInputOf = (k: typeof subscriptionPlans.$inferSelect): SubscriptionPlanInput => ({
  name: k.name,
  months: k.months,
  discountPct: k.discountPct,
  perks: k.perks,
  sortOrder: k.sortOrder,
  active: k.active,
});

/** Новый вид (`withUserContext` администратора): код — как в прототипе, «k» и время. */
export async function createSubscriptionPlan(tx: Tx, x: SubscriptionPlanInput, id: string) {
  await tx.insert(subscriptionPlans).values({
    id,
    ...x,
    createdBy: sql`app.current_user_id()` as unknown as string,
    updatedBy: sql`app.current_user_id()` as unknown as string,
  });
  await writePlatformHistory(tx, {
    entity: 'subscription_plan',
    entityId: id,
    action: 'create',
    changes: [
      { field: 'name', to: x.name },
      { field: 'months', to: x.months },
      { field: 'discountPct', to: x.discountPct },
    ],
  });
}

/**
 * Правки видов подписок — по одной (названия сверяются под этой блокировкой: два окна не заведут
 * одинаковые; строк может не быть, поэтому блокировка — по имени таблицы, а не по строкам).
 */
export async function lockSubscriptionPlans(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('subscription_plans'))`);
}

/** Вид подписки под блокировкой с проверкой версии. */
export async function lockSubscriptionPlan(tx: Tx, id: string, version: number) {
  const [k] = await tx
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, id))
    .for('update');
  if (!k) throw new RecordNotFoundError('subscription_plan', id);
  if (k.version !== version) throw new RecordChangedError('subscription_plan', id, k.version);
  return k;
}

export async function updateSubscriptionPlan(
  tx: Tx,
  k: typeof subscriptionPlans.$inferSelect,
  x: SubscriptionPlanInput,
  changes: HistoryChange[],
) {
  await tx
    .update(subscriptionPlans)
    .set({
      ...x,
      updatedBy: sql`app.current_user_id()` as unknown as string,
      updatedAt: sql`now()` as unknown as Date,
      version: k.version + 1,
    })
    .where(eq(subscriptionPlans.id, k.id));
  await writePlatformHistory(tx, {
    entity: 'subscription_plan',
    entityId: k.id,
    action: 'update',
    changes,
  });
  return k.version + 1;
}

export async function deleteSubscriptionPlan(tx: Tx, k: typeof subscriptionPlans.$inferSelect) {
  await tx.delete(subscriptionPlans).where(eq(subscriptionPlans.id, k.id));
  await writePlatformHistory(tx, {
    entity: 'subscription_plan',
    entityId: k.id,
    action: 'delete',
    changes: [{ field: 'name', from: k.name, to: null }],
  });
}

/* ── «Цены и реквизиты» (блок 6, пункт 6) ── */

export async function updateSubscriptionSettings(
  tx: Tx,
  version: number,
  patch: Partial<typeof subscriptionSettings.$inferInsert>,
  changes: HistoryChange[],
): Promise<number> {
  const [row] = await tx
    .select({ version: subscriptionSettings.version })
    .from(subscriptionSettings)
    .where(eq(subscriptionSettings.id, 1))
    .for('update');
  if (!row) throw new RecordNotFoundError('subscription_settings', '1');
  if (row.version !== version) {
    throw new RecordChangedError('subscription_settings', '1', row.version);
  }
  await tx
    .update(subscriptionSettings)
    .set({
      ...patch,
      updatedBy: sql`app.current_user_id()` as unknown as string,
      updatedAt: sql`now()` as unknown as Date,
      version: version + 1,
    })
    .where(eq(subscriptionSettings.id, 1));
  await writePlatformHistory(tx, {
    entity: 'subscription_settings',
    entityId: '1',
    action: 'update',
    changes,
  });
  return version + 1;
}

/**
 * «История изменений» видов подписок и цен (прототип `subCfgHist`: последние 50, новые сверху) —
 * только администратору платформы. Название вида — из записи (у удалённого) или нынешнее.
 */
export async function subscriptionConfigHistory(tx: Tx) {
  const rows = await tx
    .select({
      id: platformAuditLog.id,
      at: platformAuditLog.at,
      entity: platformAuditLog.entity,
      entityId: platformAuditLog.entityId,
      action: platformAuditLog.action,
      changes: platformAuditLog.changes,
      plan: subscriptionPlans.name,
    })
    .from(platformAuditLog)
    .leftJoin(
      subscriptionPlans,
      and(
        eq(platformAuditLog.entity, 'subscription_plan'),
        eq(subscriptionPlans.id, platformAuditLog.entityId),
      ),
    )
    .where(inArray(platformAuditLog.entity, ['subscription_plan', 'subscription_settings']))
    .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
    .limit(50);
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}
