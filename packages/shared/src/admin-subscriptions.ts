import {
  SUBSCRIPTION_CONFIRM_MONTHS_MAX,
  SUBSCRIPTION_PAYMENT_KINDS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_REASON_MAX,
  SUBSCRIPTION_START_MODES,
  SUBSCRIPTION_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Uuid } from './common';
import { listPageSchema } from './list';
import { OrgSubscriptionView, SubscriptionCalcLineSchema } from './org-subscription';

/**
 * Подписка от администратора платформы (доработки 20.11.2026, блок 6, пункт 4; прототип
 * admin/subs-admin.js, `subEditFields`): вид, пакет мест, память сверх, «Оплачено до» и
 * дополнительная скидка. Шаг пакета, порог скидки и действующий ли вид проверяет сервер
 * (`subscriptionEditProblems` из `@buhuchet/domain`): неверное поле — 400 с кодом и `details.field`.
 */
export const SubscriptionEditFields = z.object({
  planId: z.string().trim().min(1).max(32),
  seats: z.number().int().min(1).max(100000),
  extraGb: z.number().int().min(0).max(100000).default(0),
  paidUntil: IsoDate,
  extraDiscountPct: z.number().int().min(0).max(100).default(0),
});
export type SubscriptionEditFields = z.infer<typeof SubscriptionEditFields>;

/**
 * Блок «Подписка» окна «Новая организация» (прототип `subNewOrgHtml`): необязательный — без него у
 * организации «Нет подписки». «Бесплатный период» в окне отмечен по умолчанию.
 */
export const NewOrgSubscriptionRequest = SubscriptionEditFields.extend({
  free: z.boolean().default(true),
});
export type NewOrgSubscriptionRequest = z.infer<typeof NewOrgSubscriptionRequest>;

/* ── Админка → «Организации» → «Подписки» (блок 6, пункты 2–7; прототип admin/subs-admin.js) ── */

const SubStatus = z.enum(SUBSCRIPTION_STATUSES);
const PayKind = z.enum(SUBSCRIPTION_PAYMENT_KINDS);
const PayStatus = z.enum(SUBSCRIPTION_PAYMENT_STATUSES);
const Reason = z.string().trim().min(1).max(SUBSCRIPTION_REASON_MAX);

/** Строка списка «Организации» вкладки «Подписки» (прототип: сетка `adm-subs`). */
export const AdminSubscriptionRow = z.object({
  id: Uuid,
  name: z.string(),
  demo: z.boolean(),
  blocked: z.boolean(),
  owner: z.string().nullable(),
  planId: z.string().nullable(),
  planName: z.string().nullable(),
  free: z.boolean(),
  seatsUsed: z.number().int(),
  pack: z.number().int(),
  bytesUsed: z.number().int(),
  /** Предел памяти, байт; нет — предела нет (демо, без подписки). */
  bytesLimit: z.number().int().nullable(),
  paidUntil: IsoDate.nullable(),
  status: SubStatus,
  extraDiscountPct: z.number().int(),
  /** Чек на проверке: оплата и сумма в тыйынах. */
  pendingId: Uuid.nullable(),
  pendingAmount: z.number().int().nullable(),
  /** Чек ждёт проверки дольше «Срока проверки чека». */
  late: z.boolean(),
  firstPaid: IsoDate.nullable(),
  lastPaid: IsoDate.nullable(),
});
export type AdminSubscriptionRow = z.infer<typeof AdminSubscriptionRow>;

export const AdminSubscriptionList = listPageSchema(AdminSubscriptionRow);

/** Плашки над списком (прототип `subOrgsPart`): организаций по статусам, чеков дольше срока, ждут. */
export const AdminSubscriptionsSummary = z.object({
  byStatus: z.partialRecord(SubStatus, z.number().int()),
  late: z.number().int(),
  pending: z.number().int(),
});
export type AdminSubscriptionsSummary = z.infer<typeof AdminSubscriptionsSummary>;

/** Оплата «Истории оплат» в окне Админки: кто отправил и кто проверил. */
export const AdminSubscriptionPayment = z.object({
  id: Uuid,
  kind: PayKind,
  startMode: z.enum(SUBSCRIPTION_START_MODES),
  planId: z.string(),
  planName: z.string(),
  months: z.number().int(),
  seats: z.number().int(),
  extraGb: z.number().int(),
  amount: z.number().int(),
  lines: z.array(SubscriptionCalcLineSchema),
  receipt: z.object({ name: z.string(), type: z.string(), bytes: z.number().int() }).nullable(),
  status: PayStatus,
  /** Доступ открыт до проверки чека (прошлый чек не отклонён). */
  opensAccess: z.boolean(),
  /** Чек ждёт проверки дольше срока. */
  late: z.boolean(),
  reason: z.string().nullable(),
  paidUntil: IsoDate.nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.object({ name: z.string().nullable(), admin: z.boolean(), system: z.boolean() }),
  decidedAt: z.iso.datetime().nullable(),
  decidedBy: z.object({ name: z.string().nullable(), admin: z.boolean() }).nullable(),
  version: z.number().int(),
});
export type AdminSubscriptionPayment = z.infer<typeof AdminSubscriptionPayment>;

/** Запись «Истории изменений» подписки: вид — названием. */
export const AdminSubscriptionHistoryEntry = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  actor: z.string().nullable(),
  actorAdmin: z.boolean(),
  action: z.string(),
  changes: z.array(
    z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
  ),
  reason: z.string().nullable(),
});

/** Вид подписки для окна «Изменить подписку» и списка «Виды подписок». */
export const AdminSubscriptionPlan = z.object({
  id: z.string(),
  name: z.string(),
  months: z.number().int(),
  discountPct: z.number().int(),
  perks: z.array(z.string()),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Подписок этого вида и оплат по нему: с ними вид не удалить, только выключить. */
  subs: z.number().int(),
  pays: z.number().int(),
  version: z.number().int(),
});
export type AdminSubscriptionPlan = z.infer<typeof AdminSubscriptionPlan>;

/** Вид подписки в окне «Изменить подписку»: выключенный виден, только если уже стоит у организации. */
export const AdminSubscriptionPlanOption = z.object({
  id: z.string(),
  name: z.string(),
  months: z.number().int(),
  discountPct: z.number().int(),
  active: z.boolean(),
});

/**
 * Окно «Подписка организации» (прототип `subOrgBody`): статус, вид, срок, пакет и память, скидки,
 * «Со следующего месяца», продление на тот же срок, чеки на проверке, «История оплат» и «История
 * изменений»; для «Изменить подписку» — виды и шаг пакета; экран «Подписка» владельца — `screen`.
 */
export const AdminSubscriptionCard = z.object({
  today: IsoDate,
  org: z.object({
    id: Uuid,
    name: z.string(),
    inn: z.string().nullable(),
    demo: z.boolean(),
    blocked: z.boolean(),
  }),
  status: SubStatus,
  late: z.boolean(),
  seatsUsed: z.number().int(),
  pack: z.number().int(),
  bytesUsed: z.number().int(),
  bytesLimit: z.number().int().nullable(),
  /** Входит в цену, МБ (2 ГБ и 200 МБ за место пакета). */
  memIncludedMb: z.number().int(),
  sub: z
    .object({
      planId: z.string(),
      planName: z.string(),
      planDiscountPct: z.number().int(),
      free: z.boolean(),
      seats: z.number().int(),
      extraGb: z.number().int(),
      paidUntil: IsoDate,
      /** Дополнительная скидка, как стоит, и действует ли она при нынешнем пакете. */
      extraDiscountPct: z.number().int(),
      extraDiscountOn: z.boolean(),
      firstPaid: z.boolean(),
      next: z
        .object({ seats: z.number().int(), extraGb: z.number().int(), from: IsoDate })
        .nullable(),
      version: z.number().int(),
    })
    .nullable(),
  /** «Продление на тот же срок»: сумма, вид и пакет. */
  renew: z
    .object({ total: z.number().int(), planName: z.string(), seats: z.number().int() })
    .nullable(),
  firstMonthPct: z.number().int(),
  checkDays: z.number().int(),
  payments: z.array(AdminSubscriptionPayment),
  history: z.array(AdminSubscriptionHistoryEntry),
  plans: z.array(AdminSubscriptionPlanOption),
  prices: z.object({ seatStep: z.number().int(), extraDiscountOver: z.number().int() }),
  /**
   * Экран «Подписка» организации, как его видит владелец (`GET /api/org/subscription`): в окне — без
   * кнопок оплаты, как `subScreenHtml(orgId, {admin: true})` прототипа.
   */
  screen: OrgSubscriptionView,
});
export type AdminSubscriptionCard = z.infer<typeof AdminSubscriptionCard>;

/** «Подтвердить оплату» (прототип `subPayOkDlg`): число месяцев и «Оплачено до» можно поправить. */
export const SubscriptionConfirmRequest = z.object({
  /** Продление — 1–36; расширение и память — число из заявки (до конца срока), не меняется. */
  months: z.number().int().min(0).max(SUBSCRIPTION_CONFIRM_MONTHS_MAX),
  paidUntil: IsoDate,
  version: z.number().int().min(1),
});
export type SubscriptionConfirmRequest = z.infer<typeof SubscriptionConfirmRequest>;

/** «Отклонить чек» (прототип `subPayRejDlg`): причина обязательна. */
export const SubscriptionRejectRequest = z.object({
  reason: Reason,
  version: z.number().int().min(1),
});
export type SubscriptionRejectRequest = z.infer<typeof SubscriptionRejectRequest>;

/**
 * «Изменить подписку» (прототип `subEditDlg` → `subSet`): поля, бесплатный период и причина; `version` —
 * версия подписки (нет подписки — без неё).
 */
export const SubscriptionEditRequest = SubscriptionEditFields.extend({
  free: z.boolean().default(false),
  reason: Reason,
  version: z.number().int().min(1).optional(),
});
export type SubscriptionEditRequest = z.infer<typeof SubscriptionEditRequest>;

/** Вид подписки (прототип `subKindDlg`): проверки — `subscriptionPlanProblems` домена. */
export const SubscriptionPlanRequest = z.object({
  name: z.string().max(200),
  months: z.number().int(),
  discountPct: z.number().int(),
  /** Что входит: строка на пункт. */
  perks: z.string().max(5000).default(''),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type SubscriptionPlanRequest = z.infer<typeof SubscriptionPlanRequest>;

export const SubscriptionPlanUpdate = SubscriptionPlanRequest.extend({
  version: z.number().int().min(1),
});
export type SubscriptionPlanUpdate = z.infer<typeof SubscriptionPlanUpdate>;

export const SubscriptionPlanDelete = z.object({ version: z.coerce.number().int().min(1) });

/** «Виды подписок» с «Историей изменений» видов и цен (прототип `subKindsPart`, `subCfgHist`). */
export const SubscriptionConfigHistoryEntry = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  entity: z.enum(['subscription_plan', 'subscription_settings']),
  entityId: z.string(),
  action: z.string(),
  /** Нынешнее название вида (удалённого — нет: оно в изменениях). */
  plan: z.string().nullable(),
  changes: z.array(
    z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
  ),
});

export const AdminSubscriptionPlans = z.object({
  plans: z.array(AdminSubscriptionPlan),
  history: z.array(SubscriptionConfigHistoryEntry),
});
export type AdminSubscriptionPlans = z.infer<typeof AdminSubscriptionPlans>;

/**
 * «Цены и реквизиты» (прототип `subPricesPart`): цены — тыйыны, «Включённая память» — ГБ; реквизиты
 * видит владелец в окне оплаты. Проверки — `subscriptionSettingsProblems` домена.
 */
export const SubscriptionSettingsFields = z.object({
  seatPrice: z.number().int(),
  seatStep: z.number().int(),
  gbPrice: z.number().int(),
  baseGb: z.number().int(),
  seatMb: z.number().int(),
  firstMonthPct: z.number().int(),
  extraDiscountOver: z.number().int(),
  remindDays: z.number().int(),
  checkDays: z.number().int(),
  recipient: z.string().max(1000),
  recipientInn: z.string().max(100),
  bank: z.string().max(1000),
  bik: z.string().max(100),
  account: z.string().max(100),
  purpose: z.string().max(1000),
});
export type SubscriptionSettingsFields = z.infer<typeof SubscriptionSettingsFields>;

export const AdminSubscriptionSettings = SubscriptionSettingsFields.extend({
  version: z.number().int(),
  history: z.array(SubscriptionConfigHistoryEntry),
});
export type AdminSubscriptionSettings = z.infer<typeof AdminSubscriptionSettings>;

export const SubscriptionSettingsUpdate = SubscriptionSettingsFields.extend({
  version: z.number().int().min(1),
});
export type SubscriptionSettingsUpdate = z.infer<typeof SubscriptionSettingsUpdate>;

/** Ответ «Изменить подписку»: подписка как в окне. */
export const SubscriptionEditResult = z.object({ version: z.number().int() });
