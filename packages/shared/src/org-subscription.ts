import {
  SUBSCRIPTION_OWNER_PAYMENT_KINDS,
  SUBSCRIPTION_PAYMENT_KINDS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_RECEIPT_MAX_BYTES,
  SUBSCRIPTION_RECEIPT_TYPES,
  SUBSCRIPTION_START_MODES,
  SUBSCRIPTION_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
// Строка расчёта суммы — одна схема с окном оплаты Админки (как `SubscriptionCalcLine` домена).
import { SubscriptionCalcLineSchema } from './admin-subscriptions';
import { IsoDate, RecordVersion, Uuid } from './common';
import { FileUploadTicket } from './files';

/*
 * Экран «Подписка» владельца организации (доработки 20.11.2026, блок 5; прототип v154
 * `modules/org-sub.js`; пакет 2, этап 1, П7, поток И): подписка, места, память, скидки, «История
 * оплат», окно оплаты с чеком. Деньги — тыйыны; сумму к оплате считает сервер, из окна приходят
 * только вид, пакет, память и «Когда». Ключей хранилища в ответах нет: чек открывается своей ссылкой.
 */

const Moment = z.iso.datetime();
const Tyiyn = z.number().int();

/** Оплата «Истории оплат» (прототип `DB.subPays`). */
export const SubscriptionPayment = z.object({
  id: Uuid,
  at: Moment,
  kind: z.enum(SUBSCRIPTION_PAYMENT_KINDS),
  startMode: z.enum(SUBSCRIPTION_START_MODES),
  planId: z.string(),
  planName: z.string(),
  months: z.number().int(),
  seats: z.number().int(),
  extraGb: z.number().int(),
  amount: Tyiyn,
  lines: z.array(SubscriptionCalcLineSchema),
  receipt: z
    .object({ name: z.string(), type: z.string().nullable(), bytes: z.number().int().nullable() })
    .nullable(),
  status: z.enum(SUBSCRIPTION_PAYMENT_STATUSES),
  /** Чек открыл доступ до проверки (после отклонения новый — нет). */
  opensAccess: z.boolean(),
  /** Причина отклонения, бесплатного периода или правки администратора. */
  reason: z.string().nullable(),
  decidedAt: Moment.nullable(),
  /** «Оплачено до» после подтверждения. */
  paidUntil: IsoDate.nullable(),
  /** Кто отправил: краткое ФИО; null — «Система» или администратор платформы. */
  by: z.string().nullable(),
  /** «Прикрепить другой чек» (у самой новой отклонённой оплаты без нового чека). */
  again: z.boolean(),
  version: RecordVersion,
});
export type SubscriptionPayment = z.infer<typeof SubscriptionPayment>;

/** Вид подписки (справочник «Виды подписок»). */
export const SubscriptionPlan = z.object({
  id: z.string(),
  name: z.string(),
  months: z.number().int(),
  discountPct: z.number().int(),
  perks: z.array(z.string()),
  active: z.boolean(),
});
export type SubscriptionPlan = z.infer<typeof SubscriptionPlan>;

/** Экран «Подписка»: всё, что нужно экрану и окну оплаты, одним ответом. */
export const OrgSubscriptionView = z.object({
  /** Сегодня по Бишкеку (часы сервера): сроки и «месяцев срока» считаются от него. */
  today: IsoDate,
  org: z.object({ name: z.string(), inn: z.string().nullable() }),
  status: z.enum(SUBSCRIPTION_STATUSES),
  /** Доступ закрыт по подписке: срок прошёл или подписки нет, и нет чека, открывшего доступ. */
  closed: z.boolean(),
  sub: z
    .object({
      planId: z.string(),
      planName: z.string(),
      seats: z.number().int(),
      extraGb: z.number().int(),
      paidUntil: IsoDate,
      free: z.boolean(),
      firstPaid: z.boolean(),
      extraDiscountPct: z.number().int(),
      next: z
        .object({
          seats: z.number().int().nullable(),
          extraGb: z.number().int().nullable(),
          from: IsoDate,
        })
        .nullable(),
    })
    .nullable(),
  /** Занято и пакет сейчас (`app.org_usage`: с «Со следующего месяца» и чеком на проверке). */
  usage: z.object({
    seatsUsed: z.number().int(),
    seats: z.number().int(),
    extraGb: z.number().int(),
    bytesUsed: z.number().int(),
    /** Предел памяти, байт; null — предела нет (без подписки). */
    bytesLimit: z.number().int().nullable(),
  }),
  prices: z.object({
    seatPrice: Tyiyn,
    gbPrice: Tyiyn,
    seatStep: z.number().int(),
    baseMb: z.number().int(),
    seatMb: z.number().int(),
    firstMonthPct: z.number().int(),
    extraDiscountOver: z.number().int(),
    remindDays: z.number().int(),
    checkDays: z.number().int(),
  }),
  /** Реквизиты платформы; назначение — уже с названием и ИНН организации. */
  requisites: z.object({
    recipient: z.string().nullable(),
    recipientInn: z.string().nullable(),
    bank: z.string().nullable(),
    bik: z.string().nullable(),
    account: z.string().nullable(),
    purpose: z.string().nullable(),
  }),
  plans: z.array(SubscriptionPlan),
  /** Месяцев срока, считая текущий (расширение и память доплачиваются за них). */
  monthsLeft: z.number().int(),
  /** «Продление на тот же срок и пакет — …»; без подписки — null. */
  renewTotal: Tyiyn.nullable(),
  /** Последняя проверенная заявка отклонена: новый чек доступ до проверки не откроет. */
  lastRejected: z.boolean(),
  payments: z.array(SubscriptionPayment),
});
export type OrgSubscriptionView = z.infer<typeof OrgSubscriptionView>;

/** Файл чека: один, PDF или фото, до 20 МБ (тип ещё проверит содержимое). */
const ReceiptFile = z.strictObject({
  name: z.string().min(1).max(400),
  size: z.number().int().positive().max(SUBSCRIPTION_RECEIPT_MAX_BYTES),
});

/** Что оплачивается — из окна оплаты: сумму сервер считает сам. */
export const SubscriptionPayChoice = z.strictObject({
  kind: z.enum(SUBSCRIPTION_OWNER_PAYMENT_KINDS),
  /** Вид подписки — только у продления. */
  planId: z.string().max(40).nullable(),
  seats: z.number().int().min(0).max(100_000),
  extraGb: z.number().int().min(0).max(100_000),
  startMode: z.enum(SUBSCRIPTION_START_MODES),
});
export type SubscriptionPayChoice = z.infer<typeof SubscriptionPayChoice>;

/** «Отправить на проверку»: начать — ссылка на загрузку чека. */
export const SubscriptionPayStart = z.strictObject({
  pay: SubscriptionPayChoice,
  file: ReceiptFile,
});

/** Закончить: тот же выбор и файл — сервер сверит загрузку и посчитает сумму заново. */
export const SubscriptionPayComplete = z.strictObject({
  id: Uuid,
  pay: SubscriptionPayChoice,
  file: ReceiptFile,
});

/** Заявка принята: открыл ли чек доступ до проверки. */
export const SubscriptionPayDone = z.object({
  id: Uuid,
  amount: Tyiyn,
  opensAccess: z.boolean(),
});
export type SubscriptionPayDone = z.infer<typeof SubscriptionPayDone>;

/** «Заменить файл чека»: начать. */
export const SubscriptionReceiptStart = z.strictObject({
  file: ReceiptFile,
  version: RecordVersion,
});

/** «Заменить файл чека»: закончить — номер загрузки из ответа «начать». */
export const SubscriptionReceiptComplete = z.strictObject({
  uploadId: Uuid,
  file: ReceiptFile,
  version: RecordVersion,
});

export const SubscriptionPaymentParam = z.object({ id: Uuid });

/** Ссылка на загрузку чека (как у файлов): `id` — номер заявки или загрузки замены. */
export const SubscriptionUploadTicket = FileUploadTicket;
export type SubscriptionUploadTicket = z.infer<typeof SubscriptionUploadTicket>;

/** Чек на просмотр: только PDF и картинки, тип — по содержимому. */
export const SubscriptionReceiptQuery = z.object({ download: z.enum(['1']).optional() });

export const SUBSCRIPTION_RECEIPT_CONTENT_TYPES = SUBSCRIPTION_RECEIPT_TYPES;
