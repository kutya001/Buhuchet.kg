import {
  ACCOUNT_PURPOSES,
  BANK_KINDS,
  HOLDER_NAME_MAX_LENGTH,
  MONEY_AMOUNT_MAX,
  MONEY_NOTE_MAX,
  MONEY_OP_KINDS,
  RECEIPT_ROWS_MAX,
  REQUISITE_KINDS,
  REQUISITE_NO_MAX_LENGTH,
  VERDICT_STATES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Tyiyn, Uuid } from './common';

/*
 * Реквизиты для переводов (задача 2.18): справочник «Банковские провайдеры», счета организации и
 * реквизиты сотрудников. Банки — кодами справочника, телефон — «+996555123456».
 */

/** «Банковские провайдеры» по порядку справочника, с отключёнными: реквизит хранит прежний банк. */
export const Banks = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      kind: z.enum(BANK_KINDS),
      /** «Переводы по номеру телефона». */
      byPhone: z.boolean(),
      note: z.string(),
      active: z.boolean(),
    }),
  ),
});
export type Banks = z.infer<typeof Banks>;

const BankCode = z.string().min(1).max(32);
/** Номер счёта или кошелька — как ввели, с пробелами; цифры проверяет правило домена. */
const RequisiteNo = z.string().trim().max(REQUISITE_NO_MAX_LENGTH);
const Phone = z.string().regex(/^\+\d{6,15}$/);
const HolderName = z.string().trim().max(HOLDER_NAME_MAX_LENGTH);

/** Поля реквизита из формы: у счёта — банк и номер, у перевода по номеру — телефон и банки. */
const RequisiteBody = {
  kind: z.enum(REQUISITE_KINDS),
  bankCode: BankCode.nullable(),
  accountNo: RequisiteNo.nullable(),
  phone: Phone.nullable(),
  phoneBanks: z.array(BankCode).max(50),
  holderName: HolderName,
};

/** Счёт организации («Моя организация» → «Реквизиты для приёма денег от контрагентов»). */
export const OrgAccount = z.object({
  id: Uuid,
  ...RequisiteBody,
  bik: z.string().nullable(),
  purpose: z.enum(ACCOUNT_PURPOSES),
  mainTax: z.boolean(),
  mainFee: z.boolean(),
  version: RecordVersion,
});
export type OrgAccount = z.infer<typeof OrgAccount>;

export const OrgAccounts = z.object({ items: z.array(OrgAccount) });
export type OrgAccounts = z.infer<typeof OrgAccounts>;

/** «Добавить» и «Сохранить» в окне счёта; `version` — при изменении. */
export const OrgAccountSave = z.object({
  ...RequisiteBody,
  bik: z.string().trim().max(6).nullable(),
  purpose: z.enum(ACCOUNT_PURPOSES),
  mainTax: z.boolean(),
  mainFee: z.boolean(),
});
export type OrgAccountSave = z.infer<typeof OrgAccountSave>;

export const OrgAccountUpdate = OrgAccountSave.extend({ version: RecordVersion });
export type OrgAccountUpdate = z.infer<typeof OrgAccountUpdate>;

/** Реквизит сотрудника для переводов («Мой профиль», карточка сотрудника). */
export const Wallet = z.object({
  id: Uuid,
  ...RequisiteBody,
  isMain: z.boolean(),
  version: RecordVersion,
});
export type Wallet = z.infer<typeof Wallet>;

export const Wallets = z.object({ items: z.array(Wallet) });
export type Wallets = z.infer<typeof Wallets>;

export const WalletSave = z.object({ ...RequisiteBody, isMain: z.boolean() });
export type WalletSave = z.infer<typeof WalletSave>;

export const WalletUpdate = WalletSave.extend({ version: RecordVersion });
export type WalletUpdate = z.infer<typeof WalletUpdate>;

/** Номер записи в пути и версия, которую видел пользователь, — для «Удалить». */
export const RequisiteIdParam = z.object({ id: Uuid });
export const RequisiteDeleteQuery = z.object({
  version: z.coerce.number().int().nonnegative(),
});

/* ───────────── Деньги по отчётам: поступления и оплата налога (задача 2.19) ───────────── */

/** Сумма больше нуля и не больше предела (`MONEY_AMOUNT_MAX`). */
const Positive = Tyiyn.refine((v) => v > 0, 'Введите сумму больше нуля').refine(
  (v) => v <= MONEY_AMOUNT_MAX,
  'Сумма слишком большая',
);
/** Строка детализации: 0 — строка не заполнена. */
const RowAmount = Tyiyn.refine((v) => v >= 0 && v <= MONEY_AMOUNT_MAX, 'Неверная сумма');

/** Месяц `YYYY-MM`. */
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц — ГГГГ-ММ');

/** Сверка по отчёту (столбец «Деньги (сверка)»): «Оплачено», «Достаточно», «Недостача N». */
export const ReportFunds = z.discriminatedUnion('state', [
  z.object({ state: z.literal('paid') }),
  z.object({ state: z.literal('enough'), need: Tyiyn }),
  z.object({ state: z.literal('short'), need: Tyiyn, short: Tyiyn }),
]);
export type ReportFunds = z.infer<typeof ReportFunds>;

/** Номер контрагента в пути. */
export const MoneyContractorParam = z.object({ id: Uuid });

/** Вкладка «Деньги»: месяц сверки (по умолчанию — текущий). */
export const ContractorMoneyQuery = z.object({ month: Month.optional() });

/** Отчёт в сверке за месяц: «НДС · 09.2026», срок оплаты, сколько осталось или отложено. */
const MoneyTabReport = z.object({
  reportId: Uuid,
  label: z.string(),
  payDue: IsoDate,
  amount: Tyiyn,
});

/** Операция вкладки «Деньги»: дата, вид, основание (отчёты), кто внёс, сумма. */
export const MoneyOperationItem = z.object({
  id: Uuid,
  kind: z.enum(MONEY_OP_KINDS),
  self: z.boolean(),
  date: IsoDate,
  amount: Tyiyn,
  total: Tyiyn.nullable(),
  reports: z.array(z.string()),
  author: z.string().nullable(),
  /** Причина списания, комментарий возврата и перевода, причина обратной записи (задача 2.20). */
  note: z.string(),
  /** Перевод — на чей счёт. */
  holder: z.string().nullable(),
  /** Обратная запись — дата поступления, к которому она. */
  receiptDate: IsoDate.nullable(),
  /** Возврат по уточнённому — номер версии отчёта. */
  revision: z.number().int().nullable(),
});
export type MoneyOperationItem = z.infer<typeof MoneyOperationItem>;

/**
 * Вкладка «Деньги» карточки контрагента (прототип contractor-card.js, вкладка `money`) и «Баланс по
 * контрагенту» на «Основном»: сверка по сроку оплаты до конца месяца, что нужно оплатить, операции.
 */
export const ContractorMoney = z.object({
  contractor: z.object({
    id: Uuid,
    name: z.string(),
    paysTo: z.enum(['emp', 'org']),
    /** Ответственный — чей кошелёк, если деньги переводятся ему. */
    holder: z.string().nullable(),
    archived: z.boolean(),
    needReceiptFile: z.boolean(),
    version: RecordVersion,
  }),
  month: Month,
  /** Месяцы выбора: два прошлых, текущий и следующий. */
  months: z.array(Month),
  balance: z.object({
    received: Tyiyn,
    paid: Tyiyn,
    selfPaid: Tyiyn,
    bonus: Tyiyn,
    available: Tyiyn,
  }),
  /** Свободный остаток после всех неоплаченных отчётов. */
  free: Tyiyn,
  need: z.array(MoneyTabReport),
  needSum: Tyiyn,
  later: z.array(MoneyTabReport),
  laterSum: Tyiyn,
  verdict: z.object({ state: z.enum(VERDICT_STATES), amount: Tyiyn }),
  operations: z.array(MoneyOperationItem),
  /** «Поступление»: право «Учёт денег», контрагент не в архиве. */
  canReceive: z.boolean(),
  /**
   * Кнопки остатка (задача 2.20; прототип contractor-card.js): «Списать в бонус», «Вернуть остаток»,
   * «Перевод». Неактивные «Списать» и «Вернуть» объясняют причину — её окно считает по `free`.
   */
  actions: z.object({ bonus: z.boolean(), refund: z.boolean(), xfer: z.boolean() }),
});
export type ContractorMoney = z.infer<typeof ContractorMoney>;

/** Окно «Поступление от контрагента»: неоплаченные отчёты для детализации (прототип inDlg). */
export const ReceiptForm = z.object({
  contractor: z.object({
    id: Uuid,
    name: z.string(),
    paysTo: z.enum(['emp', 'org']),
    holder: z.string().nullable(),
    needReceiptFile: z.boolean(),
    /** «Платит одной суммой»: деление на налоги и обслуживание подставляется само (задача 2.21). */
    oneSum: z.boolean(),
  }),
  rows: z.array(
    z.object({
      reportId: Uuid,
      typeShort: z.string(),
      periodLabel: z.string(),
      payDue: IsoDate,
      sum: Tyiyn,
      already: Tyiyn,
      left: Tyiyn,
    }),
  ),
  /** Неоплаченных отчётов, деньги на которые уже получены (подсказка «станет авансом»). */
  unpaid: z.number().int().nonnegative(),
  /**
   * Часть за обслуживание (задача 2.21; прототип inDlg, `fms`): месяцы с недоплатой; null — части нет
   * (плата не видна, контрагент разовый или переводит деньги ответственному).
   */
  fee: z
    .object({
      months: z.array(
        z.object({ month: Month, charge: Tyiyn, got: Tyiyn, left: Tyiyn, due: IsoDate }),
      ),
    })
    .nullable(),
  /** Сегодня по Бишкеку: «Платит одной суммой» делит по срокам до конца этого месяца. */
  today: IsoDate,
});
export type ReceiptForm = z.infer<typeof ReceiptForm>;

/** Файлов, загружаемых в окне поступления или оплаты, — не больше. */
export const MONEY_FILES_MAX = 20;

/**
 * «Записать поступление»: общая сумма, дата, детализация по отчётам и сколько файлов окно загрузит к
 * поступлению после сохранения.
 */
export const ReceiptRequest = z.strictObject({
  total: Positive,
  date: IsoDate,
  rows: z
    .array(z.strictObject({ reportId: Uuid, amount: RowAmount }))
    .max(RECEIPT_ROWS_MAX)
    .default([]),
  /** Часть за обслуживание по месяцам (задача 2.21): только когда она есть в окне. */
  fee: z
    .array(z.strictObject({ month: Month, amount: RowAmount }))
    .max(RECEIPT_ROWS_MAX)
    .default([]),
  files: z.number().int().min(0).max(MONEY_FILES_MAX).default(0),
});
export type ReceiptRequest = z.input<typeof ReceiptRequest>;

export const ReceiptSaved = z.object({ id: Uuid });
export type ReceiptSaved = z.infer<typeof ReceiptSaved>;

/** «Отметить оплаченным»: сумма (может быть больше к уплате — пеня), дата, «Оплатил контрагент сам». */
export const PaymentRequest = z.strictObject({
  version: RecordVersion,
  amount: Positive,
  date: IsoDate,
  self: z.boolean().default(false),
});
export type PaymentRequest = z.input<typeof PaymentRequest>;

/** Оплата записана: новая версия отчёта и операция — к ней загружается платёжное поручение. */
export const PaymentSaved = z.object({ id: Uuid, version: RecordVersion, operationId: Uuid });
export type PaymentSaved = z.infer<typeof PaymentSaved>;

/** Откат шкалы оплаты: отмена последней оплаты с причиной. */
export const PaymentRollbackRequest = z.strictObject({
  version: RecordVersion,
  reason: z.string().trim().min(1, 'Укажите причину').max(MONEY_NOTE_MAX),
});
export type PaymentRollbackRequest = z.infer<typeof PaymentRollbackRequest>;

/**
 * «Файл при поступлении», «Деньги на налоги переводит» и «Платит одной суммой» на «Основном» карточки
 * контрагента.
 */
export const MoneySettingsRequest = z
  .strictObject({
    version: RecordVersion,
    needReceiptFile: z.boolean().optional(),
    paysTo: z.enum(['emp', 'org']).optional(),
    /** «Платит одной суммой» (задача 2.21): только тому, кто видит плату за обслуживание. */
    oneSum: z.boolean().optional(),
  })
  .refine(
    (b) => b.needReceiptFile !== undefined || b.paysTo !== undefined || b.oneSum !== undefined,
    'Нечего менять',
  );
export type MoneySettingsRequest = z.infer<typeof MoneySettingsRequest>;

export const MoneySettingsSaved = z.object({ id: Uuid, version: RecordVersion });
