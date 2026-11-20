import {
  SUBSCRIPTION_ADMIN_PAYMENT_KINDS,
  SUBSCRIPTION_OWNER_PAYMENT_KINDS,
  SUBSCRIPTION_PAYMENT_KINDS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_REASON_MAX,
  SUBSCRIPTION_RECEIPT_MAX_BYTES,
  SUBSCRIPTION_RECEIPT_TYPES,
  SUBSCRIPTION_START_MODES,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { users } from './users';

/**
 * Подписки организаций (доработки 20.11.2026, блоки 1–6; пакет 2, блок 6; миграция 0165, этап 0) —
 * модель прототипа `core/subs.js`: виды (`ref.subKinds`), цены и реквизиты (`ref.subPrices`),
 * подписка организации (`org.sub`) и «История оплат» (`DB.subPays`). Подписку меняет только
 * администратор платформы — в контексте организации записи, как остальные правки Админки; заявку с
 * чеком отправляет владелец со своего экрана «Подписка». Админка читает подписки всех организаций
 * вне контекста организации. История изменений — общая `audit_log` (запись `subscription`).
 * Что занято и закрыт ли доступ — одна функция `app.org_usage` (миграция 0165).
 */

const currentUserId = sql`app.current_user_id()`;
const isPlatformAdmin = sql`app.is_platform_admin()`;
const oneOf = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
/** Админка вне контекста организации: список «Подписки» по всем организациям. */
const adminOutsideOrg = sql`${currentOrgId} is null and ${isPlatformAdmin}`;

/** «Виды подписок» (блок 6, пункт 5; прототип `subKinds`): различаются сроком и скидкой за срок. */
export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    /** Код вида, как в прототипе: m1, m3, m6, m9, m12; новый вид — свой код. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    months: integer('months').notNull(),
    /** Скидка за срок, % — на контрагентов и на память сверх (блок 2, пункт 4). */
    discountPct: integer('discount_pct').notNull().default(0),
    /** Что получает организация — строки под видом в окне оплаты (прототип `perks`). */
    perks: text('perks')
      .array()
      .notNull()
      .default(sql`'{}'`),
    sortOrder: integer('sort_order').notNull(),
    /** Выключенный вид в новых оплатах не предлагается; оплаченные сроки дорабатывают. */
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check('subscription_plans_id_check', sql`${t.id} ~ '^[a-z0-9_-]{1,40}$'`),
    check('subscription_plans_name_check', sql`char_length(${t.name}) between 1 and 100`),
    check(
      'subscription_plans_values_check',
      sql`${t.months} between 1 and 36 and ${t.discountPct} between 0 and 99 and cardinality(${t.perks}) <= 10`,
    ),
    pgPolicy('subscription_plans_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`true`,
    }),
    pgPolicy('subscription_plans_admin_insert', {
      as: 'permissive',
      for: 'insert',
      to: appRole,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('subscription_plans_admin_update', {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
    // Удалить можно только вид без подписок и оплат (внешние ключи RESTRICT), иначе — только выключить.
    pgPolicy('subscription_plans_admin_delete', {
      as: 'permissive',
      for: 'delete',
      to: appRole,
      using: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * «Цены и реквизиты» (блок 6, пункт 6; прототип `subPrices`) — одна строка платформы. Новые цены
 * действуют на новые оплаты: оплата хранит свою сумму и строки расчёта.
 */
export const subscriptionSettings = pgTable(
  'subscription_settings',
  {
    id: integer('id').primaryKey().default(1),
    /** Цена за контрагента пакета в месяц, тыйыны: 100 сом (прототип `cp`). */
    seatPrice: money('seat_price').notNull().default(10_000),
    /** Шаг пакета (прототип `step`). */
    seatStep: integer('seat_step').notNull().default(10),
    /** Цена 1 ГБ памяти сверх в месяц, тыйыны (прототип `gb`). */
    gbPrice: money('gb_price').notNull().default(10_000),
    /** Включённая память, МБ: на организацию и на место пакета (прототип `baseMb`, `cpMb`). */
    baseMb: integer('base_mb').notNull().default(2_000),
    seatMb: integer('seat_mb').notNull().default(200),
    /** Скидка первого оплаченного месяца, % (прототип `first`). */
    firstMonthPct: integer('first_month_pct').notNull().default(50),
    /** Дополнительная скидка — у пакета больше этого числа (прототип `extraOver`). */
    extraDiscountOver: integer('extra_discount_over').notNull().default(150),
    /** «Скоро истекает» и напоминания — за столько дней (прототип `remind`). */
    remindDays: integer('remind_days').notNull().default(7),
    /** Срок проверки чека, дней после дня прикрепления (прототип `check`). */
    checkDays: integer('check_days').notNull().default(3),
    /** Реквизиты для перевода (прототип `req`): получатель, ИНН, банк, БИК, счёт, назначение. */
    recipient: text('recipient'),
    recipientInn: text('recipient_inn'),
    bank: text('bank'),
    bik: text('bik'),
    account: text('account'),
    /** Назначение платежа с подстановками «{организация}» и «{ИНН}». */
    purpose: text('purpose'),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check('subscription_settings_single_check', sql`${t.id} = 1`),
    check(
      'subscription_settings_values_check',
      sql`${t.seatPrice} >= 0 and ${t.gbPrice} >= 0 and ${t.seatStep} between 1 and 1000 and ${t.baseMb} >= 0 and ${t.seatMb} >= 0 and ${t.firstMonthPct} between 0 and 100 and ${t.extraDiscountOver} >= 0 and ${t.remindDays} between 1 and 60 and ${t.checkDays} between 1 and 30`,
    ),
    check(
      'subscription_settings_text_check',
      sql`char_length(coalesce(${t.recipient}, '')) <= 200 and char_length(coalesce(${t.recipientInn}, '')) <= 20 and char_length(coalesce(${t.bank}, '')) <= 200 and char_length(coalesce(${t.bik}, '')) <= 20 and char_length(coalesce(${t.account}, '')) <= 40 and char_length(coalesce(${t.purpose}, '')) <= 300`,
    ),
    pgPolicy('subscription_settings_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: sql`true`,
    }),
    pgPolicy('subscription_settings_admin_update', {
      as: 'permissive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * Подписка организации (прототип `org.sub`) — одна строка; нет строки — «Нет подписки» (блок 4,
 * пункт 5). Пакет и память «Со следующего месяца» (блок 3, пункт 3) ждут в `next_*` до `next_from`.
 */
export const orgSubscriptions = pgTable(
  'org_subscriptions',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    /** Пакет — оплаченное число мест для активных контрагентов (прототип `pack`). */
    seats: integer('seats').notNull(),
    /** Память сверх включённой, ГБ (прототип `extraGb`). */
    extraGb: integer('extra_gb').notNull().default(0),
    /** «Оплачено до», включительно (прототип `paidTo`). */
    paidUntil: date('paid_until', { mode: 'string' }).notNull(),
    /** Дополнительная скидка, % — действует у пакета больше порога (прототип `addDisc`). */
    extraDiscountPct: integer('extra_discount_pct').notNull().default(0),
    /** Первый месяц уже оплачен — скидки первого месяца больше нет (прототип `firstPaid`). */
    firstPaid: boolean('first_paid').notNull().default(false),
    /** Бесплатный период (прототип `free`): «Бесплатный период до …» вместо названия вида. */
    free: boolean('free').notNull().default(false),
    /** Со следующего месяца подписки (прототип `next`): пакет, память и с какого дня. */
    nextSeats: integer('next_seats'),
    nextExtraGb: integer('next_extra_gb'),
    nextFrom: date('next_from', { mode: 'string' }),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    check(
      'org_subscriptions_values_check',
      sql`${t.seats} between 0 and 100000 and ${t.extraGb} between 0 and 100000 and ${t.extraDiscountPct} between 0 and 100`,
    ),
    check(
      'org_subscriptions_next_check',
      sql`(${t.nextFrom} is null) = (${t.nextSeats} is null and ${t.nextExtraGb} is null) and (${t.nextSeats} is null or ${t.nextSeats} between 0 and 100000) and (${t.nextExtraGb} is null or ${t.nextExtraGb} between 0 and 100000)`,
    ),
    index('org_subscriptions_paid_until_idx').on(t.paidUntil),
    orgIsolation('org_subscriptions_isolation', t.orgId),
    pgPolicy('org_subscriptions_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: adminOutsideOrg,
    }),
    // Сама организация подписку не меняет: только администратор платформы (запуск — функция миграции).
    pgPolicy('org_subscriptions_admin_insert', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: isPlatformAdmin,
    }),
    pgPolicy('org_subscriptions_admin_update', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: isPlatformAdmin,
      withCheck: isPlatformAdmin,
    }),
  ],
).enableRLS();

/**
 * «История оплат» (блок 5, пункт 2; прототип `DB.subPays`): заявка владельца с чеком или запись
 * администратора без чека (бесплатный период, «Изменено администратором»); запуск тарификации — запись
 * «free» без автора («Система»). Сумму и строки расчёта считает сервер (блок 1, пункт 8). `opens_access`
 * — чек открыл доступ до проверки; после отклонения новый чек доступ не открывает (блок 4, пункт 6).
 */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    /** Номер задаёт API до вставки: из него строится ключ чека в хранилище. */
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .default(currentOrgId)
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: SUBSCRIPTION_PAYMENT_KINDS }).notNull(),
    startMode: text('start_mode', { enum: SUBSCRIPTION_START_MODES }).notNull().default('now'),
    planId: text('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    /**
     * Месяцев оплачено; 0 — у бесплатного периода и записи администратора. Расширение пакета и память
     * оплачиваются до «Оплачено до» — до 120 месяцев, если администратор поставил срок дальше года
     * (прототип `subMonthsLeft`).
     */
    months: integer('months').notNull(),
    /** Пакет и память сверх после этой оплаты (прототип `pack`, `extraGb`). */
    seats: integer('seats').notNull(),
    extraGb: integer('extra_gb').notNull().default(0),
    /** К оплате, тыйыны; 0 — без оплаты. */
    amount: money('amount').notNull().default(0),
    /** Строки расчёта, как в окне оплаты (прототип `lines`): `[{ label, sum }]`, суммы в тыйынах. */
    lines: jsonb('lines')
      .notNull()
      .default(sql`'[]'::jsonb`),
    receiptKey: text('receipt_key').unique(),
    receiptName: text('receipt_name'),
    receiptType: text('receipt_type'),
    receiptBytes: bigint('receipt_bytes', { mode: 'number' }),
    status: text('status', { enum: SUBSCRIPTION_PAYMENT_STATUSES }).notNull().default('pending'),
    opensAccess: boolean('opens_access').notNull().default(true),
    /** Причина: у отклонённой оплаты, бесплатного периода и записи администратора — обязательна. */
    reason: text('reason'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** «Оплачено до» после подтверждения (прототип `paidTo`). */
    paidUntil: date('paid_until', { mode: 'string' }),
    /** Кто отправил; пусто — «Система» (запуск тарификации). */
    createdBy: uuid('created_by')
      .default(currentUserId)
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('subscription_payments_id_org_unique').on(t.id, t.orgId),
    check(
      'subscription_payments_kind_check',
      sql`${t.kind} in (${oneOf(SUBSCRIPTION_PAYMENT_KINDS)}) and ${t.startMode} in (${oneOf(SUBSCRIPTION_START_MODES)})`,
    ),
    check(
      'subscription_payments_values_check',
      sql`${t.months} between 0 and 120 and ${t.seats} between 0 and 100000 and ${t.extraGb} between 0 and 100000 and ${t.amount} >= 0 and case when jsonb_typeof(${t.lines}) = 'array' then jsonb_array_length(${t.lines}) <= 20 else false end`,
    ),
    // Чек есть у заявки владельца и только у неё; ключ — в папке оплат своей организации; тип и размер
    // чека — обязательно (пустое значение дало бы проверке null, и она бы строку пропустила).
    check(
      'subscription_payments_receipt_check',
      sql`(${t.kind} in (${oneOf(SUBSCRIPTION_OWNER_PAYMENT_KINDS)})) = (${t.receiptKey} is not null) and (${t.receiptKey} is null or (${t.receiptKey} = ('org/' || ${t.orgId}::text || '/subs/' || ${t.id}::text) and char_length(coalesce(${t.receiptName}, '')) between 1 and 255 and ${t.receiptType} is not null and ${t.receiptType} in (${oneOf(SUBSCRIPTION_RECEIPT_TYPES)}) and ${t.receiptBytes} is not null and ${t.receiptBytes} between 1 and ${sql.raw(String(SUBSCRIPTION_RECEIPT_MAX_BYTES))}))`,
    ),
    check(
      'subscription_payments_status_check',
      sql`${t.status} in (${oneOf(SUBSCRIPTION_PAYMENT_STATUSES)}) and (${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.status} <> 'confirmed' or ${t.paidUntil} is not null) and (${t.kind} in (${oneOf(SUBSCRIPTION_OWNER_PAYMENT_KINDS)}) or ${t.status} = 'confirmed')`,
    ),
    check(
      'subscription_payments_reason_check',
      sql`char_length(coalesce(${t.reason}, '')) <= ${sql.raw(String(SUBSCRIPTION_REASON_MAX))} and ((${t.status} <> 'rejected' and ${t.kind} in (${oneOf(SUBSCRIPTION_OWNER_PAYMENT_KINDS)})) or char_length(btrim(coalesce(${t.reason}, ''))) >= 1)`,
    ),
    // Одна непроверенная заявка за раз (блок 5, пункт 5).
    uniqueIndex('subscription_payments_one_pending')
      .on(t.orgId)
      .where(sql`${t.status} = 'pending'`),
    index('subscription_payments_org_idx').on(t.orgId, t.createdAt.desc()),
    index('subscription_payments_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    orgIsolation('subscription_payments_isolation', t.orgId),
    pgPolicy('subscription_payments_admin_read', {
      as: 'permissive',
      for: 'select',
      to: appRole,
      using: adminOutsideOrg,
    }),
    // Заявку с чеком отправляет сотрудник организации от своего имени (что это владелец — проверяет
    // API), сейчас (по `created_at` база ищет последнюю проверенную заявку — открывает ли новый чек
    // доступ), непроверенной и без полей решения; запись без чека — только администратор платформы,
    // сразу подтверждённой. Правил — только тот, кто вошёл.
    pgPolicy('subscription_payments_insert_guard', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.createdBy} = ${currentUserId} and (${t.updatedBy} is null or ${t.updatedBy} = ${currentUserId}) and ((${t.status} = 'pending' and ${t.kind} in (${oneOf(SUBSCRIPTION_OWNER_PAYMENT_KINDS)}) and ${t.decidedBy} is null and ${t.paidUntil} is null and ${t.reason} is null and ${t.createdAt} between now() - interval '1 minute' and now() + interval '1 minute' and not ${isPlatformAdmin}) or (${isPlatformAdmin} and ${t.kind} in (${oneOf(SUBSCRIPTION_ADMIN_PAYMENT_KINDS)}) and ${t.decidedBy} = ${currentUserId}))`,
    }),
    // Меняется только непроверенная заявка: владелец заменяет чек, решает администратор (какие столбцы
    // кто меняет — триггер `subscription_payments_guard`, миграция 0165); правил — тот, кто вошёл.
    pgPolicy('subscription_payments_update_guard', {
      as: 'restrictive',
      for: 'update',
      to: appRole,
      using: sql`${t.status} = 'pending'`,
      withCheck: sql`(${t.updatedBy} is null or ${t.updatedBy} = ${currentUserId}) and (${t.status} = 'pending' or (${isPlatformAdmin} and ${t.decidedBy} = ${currentUserId}))`,
    }),
  ],
).enableRLS();
