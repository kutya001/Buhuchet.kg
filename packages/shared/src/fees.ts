import { MONEY_AMOUNT_MAX, MONEY_NOTE_MAX, TARIFF_PERIODS } from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Tyiyn, Uuid } from './common';

/*
 * Плата за обслуживание (задача 2.21; ТЗ «Контрагенты» → «Плата за обслуживание»; прототип
 * modules/contractor-card.js — вкладка «Обслуживание», `tariffDlg`, `feePayDlg`; ui/status-scale.js —
 * `waDlg` с `fee`). Суммы — тыйыны, месяцы — `ГГГГ-ММ`.
 */

/** Месяц `ГГГГ-ММ`. */
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц — ГГГГ-ММ');
/** Сумма больше нуля и не больше предела. */
const Positive = Tyiyn.refine((v) => v > 0, 'Введите сумму больше нуля').refine(
  (v) => v <= MONEY_AMOUNT_MAX,
  'Сумма слишком большая',
);
/** Строка распределения или ставка: 0 — пусто. */
const Amount = Tyiyn.refine((v) => v >= 0 && v <= MONEY_AMOUNT_MAX, 'Неверная сумма');
/** Строк распределения по месяцам — не больше (месяцы с 2000 года). */
const ALLOCATION_ROWS_MAX = 400;

export const FeeContractorParam = z.object({ id: Uuid });

const FeeMonthItem = z.object({
  month: Month,
  charge: Tyiyn,
  /** Оплачено распределением оплат. */
  paid: Tyiyn,
  /** Засчитано из аванса. */
  fromAdvance: Tyiyn,
  /** Всего получено: оплаты и аванс. */
  got: Tyiyn,
  due: IsoDate,
  status: z.enum(['unpaid', 'partial', 'paid']),
  /** Срок оплаты прошёл, а оплачено не всё. */
  overdue: z.boolean(),
});

const AllocationItem = z.object({ month: Month, amount: Tyiyn });

/** Окно «Новая ставка обслуживания»: что подставить и с какого месяца можно. */
export const TariffForm = z.object({
  /** Действующая ставка; null — ставки нет, поле пустое. */
  amount: Tyiyn.nullable(),
  period: z.enum(TARIFF_PERIODS),
  from: Month,
  minFrom: Month,
  note: z.string(),
  /** Ставка уже есть: новая — только со следующего месяца. */
  hasTariff: z.boolean(),
});
export type TariffForm = z.infer<typeof TariffForm>;

/** Вкладка «Обслуживание» карточки контрагента. */
export const ContractorFees = z.object({
  contractor: z.object({
    id: Uuid,
    name: z.string(),
    archived: z.boolean(),
    oneOff: z.boolean(),
    /** День месяца, до которого платят за обслуживание. */
    feeDay: z.number().int(),
    /** Начало обслуживания и день, когда завели: «с 22-го» у первого неполного месяца. */
    startDate: IsoDate,
    version: RecordVersion,
  }),
  /** Действующая ставка; null — ставки нет. */
  current: z.object({ amount: Tyiyn, period: z.enum(TARIFF_PERIODS), from: Month }).nullable(),
  /** Начисления по месяцам от старых к новым. */
  months: z.array(FeeMonthItem),
  debt: Tyiyn,
  advance: Tyiyn,
  /** Оплаты — последние 24, от новых к старым. */
  payments: z.array(
    z.object({
      id: Uuid,
      date: IsoDate,
      amount: Tyiyn,
      allocation: z.array(AllocationItem),
      /** Часть за обслуживание из общего поступления от контрагента. */
      fromReceipt: z.boolean(),
      author: z.string().nullable(),
    }),
  ),
  /** Сколько оплат всего (больше 24 — подсказка «Показаны последние 24…»). */
  paymentsTotal: z.number().int().nonnegative(),
  /** Журнал тарифов от новых записей к старым. */
  tariffs: z.array(
    z.object({
      id: Uuid,
      amount: Tyiyn,
      period: z.enum(TARIFF_PERIODS),
      from: Month,
      note: z.string(),
      author: z.string().nullable(),
      at: IsoDate,
    }),
  ),
  /** «Принять оплату за обслуживание»: права «Видеть плату» и «Менять журнал тарифов», есть начисления. */
  canAccept: z.boolean(),
  /** «Новая ставка»: право «Менять журнал тарифов», контрагент не разовый и не в архиве. */
  canTariff: z.boolean(),
  /** «Напомнить в WhatsApp»: есть долг. */
  canRemind: z.boolean(),
  /** Что подставить в окне «Новая ставка»; null — ставку вносить нельзя. */
  tariffForm: TariffForm.nullable(),
});
export type ContractorFees = z.infer<typeof ContractorFees>;

/** «Новая ставка обслуживания»: сумма, «в месяц» или «в год», с какого месяца, примечание. */
export const TariffRequest = z.strictObject({
  amount: Amount,
  period: z.enum(TARIFF_PERIODS),
  from: Month,
  note: z.string().max(MONEY_NOTE_MAX).default(''),
});
export type TariffRequest = z.input<typeof TariffRequest>;

export const TariffSaved = z.object({ id: Uuid });
export type TariffSaved = z.infer<typeof TariffSaved>;

/** Окно «Принять оплату за обслуживание». */
export const FeePaymentForm = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  debt: Tyiyn,
  advance: Tyiyn,
  /** Неоплаченное по месяцам окна. */
  unpaid: Tyiyn,
  /** Сумма по умолчанию: долг, без долга — неоплаченное; null — пусто. */
  amount: Tyiyn.nullable(),
  /** Строки «За какие месяцы» от старых к новым. */
  months: z.array(
    z.object({
      month: Month,
      charge: Tyiyn,
      /** «Уже оплачено». */
      got: Tyiyn,
      /** Сколько ещё можно распределить на месяц. */
      left: Tyiyn,
      /** «просрочено». */
      overdue: z.boolean(),
    }),
  ),
  /** Порядок «От старых к новым». */
  order: z.array(Month),
  /** Распределение по умолчанию. */
  allocation: z.array(AllocationItem),
  /** «Куда поступили деньги»: основной счёт для обслуживания — первым. */
  to: z.array(z.object({ key: z.string(), label: z.string(), main: z.boolean() })),
});
export type FeePaymentForm = z.infer<typeof FeePaymentForm>;

/** Файлов, загружаемых к оплате, — не больше (как у поступления). */
export const FEE_FILES_MAX = 20;

/** «Принять оплату»: сумма, дата, куда, распределение по месяцам (остальное — аванс), примечание. */
export const FeePaymentRequest = z.strictObject({
  amount: Positive,
  date: IsoDate,
  to: z.string().max(60),
  allocation: z
    .array(z.strictObject({ month: Month, amount: Amount }))
    .max(ALLOCATION_ROWS_MAX)
    .default([]),
  note: z.string().max(MONEY_NOTE_MAX).default(''),
  /** Сколько файлов окно загрузит к оплате после сохранения (источник «Оплата за обслуживание»). */
  files: z.number().int().min(0).max(FEE_FILES_MAX).default(0),
});
export type FeePaymentRequest = z.input<typeof FeePaymentRequest>;

export const FeePaymentSaved = z.object({ id: Uuid });
export type FeePaymentSaved = z.infer<typeof FeePaymentSaved>;

/** Окно «Напомнить в WhatsApp» о долге за обслуживание. */
export const FeeReminder = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  /** Номер для WhatsApp (+996…); null — номера нет, отправить нельзя. */
  phone: z.string().nullable(),
  /** Номер, как на экране. */
  phoneText: z.string(),
  /** Текст по шаблону waFee справочника платформы. */
  text: z.string(),
  /** Основной счёт организации для обслуживания; null — счетов для обслуживания нет. */
  requisite: z
    .object({ bank: z.string(), number: z.string(), phone: z.boolean(), holder: z.string() })
    .nullable(),
});
export type FeeReminder = z.infer<typeof FeeReminder>;
