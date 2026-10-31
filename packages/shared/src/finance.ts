import {
  HISTORY_ACTIONS,
  MONEY_AMOUNT_MAX,
  MONEY_HOLDER_KINDS,
  MONEY_NOTE_MAX,
  MONEY_OP_KINDS,
  OP_REASON_MAX,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { FeePaymentForm, FeePaymentRequest } from './fees';
import { ReceiptForm, ReceiptRequest } from './money';

/*
 * Остаток контрагента и окно финансовой операции (задача 2.20; ТЗ «Виртуальные счета сотрудников» →
 * «Остаток после оплаты», «Финансовые операции по контрагентам» → «Окно оплаты», «Обратные записи»,
 * «Счёт организации»; «Сотрудники» → вкладка «Счёт»; прототип modules/contractors.js `moneyOpDlg`,
 * `restDlg`, modules/finance.js `xferDlg`, `corrDlg`, modules/fin-op.js `opWin`, `opDelDlg`,
 * modules/staff.js — вкладка `acc`, ui/status-scale.js `waDlg({r})`). Суммы — тыйыны.
 */

/** Сумма больше нуля и не больше предела. */
const Positive = Tyiyn.refine((v) => v > 0, 'Введите сумму больше нуля').refine(
  (v) => v <= MONEY_AMOUNT_MAX,
  'Сумма слишком большая',
);
const Note = z.string().max(MONEY_NOTE_MAX);
const Reason = z.string().trim().min(1, 'Укажите причину').max(OP_REASON_MAX);

export const OperationIdParam = z.object({ id: Uuid });

/** «Списать в бонус» и «Вернуть остаток» (прототип moneyOpDlg): сумма, дата, причина или комментарий. */
export const WriteOffRequest = z.strictObject({
  kind: z.enum(['bonus', 'refund']),
  amount: Positive,
  date: IsoDate,
  note: Note.default(''),
});
export type WriteOffRequest = z.input<typeof WriteOffRequest>;

/** Записанная операция: к ней загружаются файлы и открывается её окно. */
export const OperationSaved = z.object({ id: Uuid });
export type OperationSaved = z.infer<typeof OperationSaved>;

/** Окно «Перевод на счёт сотрудника» (прототип xferDlg): сколько можно и кому. */
export const TransferForm = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  /** Не больше денег контрагента на счёте организации и не больше денег на счетах. */
  max: Tyiyn,
  /** «Кому»: активные сотрудники, кроме владельца; ответственный — по умолчанию. */
  targets: z.array(z.object({ id: Uuid, name: z.string(), responsible: z.boolean() })),
  today: IsoDate,
});
export type TransferForm = z.infer<typeof TransferForm>;

export const TransferRequest = z.strictObject({
  to: Uuid,
  amount: Positive,
  date: IsoDate,
  note: Note.default(''),
});
export type TransferRequest = z.input<typeof TransferRequest>;

/** «Обратная запись к поступлению» (прототип corrDlg): уменьшить или увеличить, с причиной. */
export const CorrectionRequest = z.strictObject({
  sign: z.enum(['-', '+']),
  amount: Positive,
  date: IsoDate,
  reason: Reason,
});
export type CorrectionRequest = z.input<typeof CorrectionRequest>;

/** «Удалить», «Отменить списание», «Отменить возврат»: причина обязательна. */
export const OperationDeleteRequest = z.strictObject({ reason: Reason });
export type OperationDeleteRequest = z.infer<typeof OperationDeleteRequest>;

/** Почему «Изменить», «Обратная запись» или «Удалить» нельзя: код и текст словаря. */
const Lock = z.object({ code: z.string(), text: z.string() }).nullable();

/** Кто и когда. */
const Audit = z.object({ name: z.string().nullable(), at: z.string() });

/** Окно финансовой операции (прототип `opWin`): поля, как их вводили, и что с ней можно сделать. */
export const OperationWindow = z.object({
  id: Uuid,
  /** Версия записи: «Изменить» сохраняет её с ней (устаревшая — «запись изменена другим пользователем»). */
  version: RecordVersion,
  kind: z.enum(MONEY_OP_KINDS),
  /** Отметка «Изменена» (задача 2.22). */
  edited: z.boolean(),
  /** «Оплатил контрагент сам». */
  self: z.boolean(),
  date: IsoDate,
  /** Сумма; у обратной записи — со знаком; у поступления — вся сумма (тому, кто видит плату). */
  amount: Tyiyn,
  /** Поступление: на налоги, за обслуживание (0 — без права на плату), аванс. */
  receiptParts: z.object({ tax: Tyiyn, fee: Tyiyn, advance: Tyiyn }).nullable(),
  contractor: z.object({ id: Uuid, name: z.string(), archived: z.boolean() }),
  /** Отчёт оплаты и возврата по уточнённому. */
  report: z.object({ id: Uuid, label: z.string(), revision: z.number().int() }).nullable(),
  holder: z.object({ kind: z.enum(MONEY_HOLDER_KINDS), name: z.string().nullable() }),
  note: z.string(),
  allocations: z.array(z.object({ reportId: Uuid, label: z.string(), amount: Tyiyn })),
  feeAllocations: z.array(z.object({ month: z.string(), amount: Tyiyn })),
  /** Обратная запись — к какому поступлению. */
  receipt: z.object({ id: Uuid, date: IsoDate, total: Tyiyn }).nullable(),
  corrections: z.array(
    z.object({
      id: Uuid,
      date: IsoDate,
      note: z.string(),
      author: z.string().nullable(),
      amount: Tyiyn,
      deleted: z.boolean(),
    }),
  ),
  created: Audit,
  updated: Audit,
  deleted: z.object({ name: z.string().nullable(), at: z.string(), reason: z.string() }).nullable(),
  locks: z.object({ edit: Lock, del: Lock }),
  /** Удалить нельзя: деньги уже потрачены — и оплаты, которые сначала изменяют или удаляют. */
  deleteBlock: z
    .object({
      code: z.enum(['receipt_spent', 'correction_spent']),
      available: Tyiyn,
      amount: Tyiyn,
      payments: z.array(z.object({ id: Uuid, report: z.string(), date: IsoDate, amount: Tyiyn })),
    })
    .nullable(),
  /** Блок «Файлы»: источник файлов операции; null — у этого вида файлов нет или они выключены. */
  files: z.object({ kind: z.enum(['receipt', 'tax_payment', 'money_operation']) }).nullable(),
  history: z.array(
    z.object({
      id: z.number().int(),
      at: z.string(),
      actor: z.string().nullable(),
      action: z.enum(HISTORY_ACTIONS),
      changes: z.array(
        z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
      ),
      reason: z.string().nullable(),
    }),
  ),
});
export type OperationWindow = z.infer<typeof OperationWindow>;

/** Номер сотрудника в пути. */
export const AccountEmployeeParam = z.object({ id: Uuid });

/** Вкладка «Счёт» карточки сотрудника (прототип staff.js, `acc`). */
export const EmployeeAccount = z.object({
  balance: Tyiyn,
  received: Tyiyn,
  paid: Tyiyn,
  bonus: Tyiyn,
  rows: z.array(
    z.object({
      contractorId: Uuid,
      name: z.string(),
      received: Tyiyn,
      paid: Tyiyn,
      bonus: Tyiyn,
      rest: Tyiyn,
    }),
  ),
});
export type EmployeeAccount = z.infer<typeof EmployeeAccount>;

/** Остаток архивного контрагента (прототип restDlg): вернуть контрагенту или списать в бонус. */
export const ArchiveRestItem = z.object({
  id: Uuid,
  name: z.string(),
  paysTo: z.enum(['emp', 'org']),
  /** Где деньги: ответственный — у контрагента, который переводит деньги ему. */
  holder: z.string().nullable(),
  free: Tyiyn,
});
export type ArchiveRestItem = z.infer<typeof ArchiveRestItem>;

/** Окно «Напомнить в WhatsApp» о налоге по отчёту (прототип waDlg с `r`). */
export const TaxReminder = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  /** Номер контрагента; null — номера нет, отправить нельзя. */
  phone: z.string().nullable(),
  phoneText: z.string(),
  /** Текст по шаблону waTax без реквизитов: окно подставляет «{реквизиты}» по отметкам. */
  base: z.string(),
  /** Куда переводить: счета организации для налогов или реквизиты ответственного. */
  to: z.enum(['org', 'employee']),
  /** Ответственный — чьи реквизиты; null — у контрагента его нет. */
  holder: z.object({ id: Uuid, name: z.string(), self: z.boolean() }).nullable(),
  /**
   * Реквизиты ответственного скрыты: их видят только он сам, владелец и главный бухгалтер (решение
   * 27.10.2026, docs/deviations.md п. В-1 и В-25); `requisites` тогда пуст.
   */
  hidden: z.boolean(),
  requisites: z.array(
    z.object({
      id: Uuid,
      text: z.string(),
      bank: z.string(),
      number: z.string(),
      phone: z.boolean(),
      holder: z.string(),
      main: z.boolean(),
    }),
  ),
});
export type TaxReminder = z.infer<typeof TaxReminder>;

/* ───────────── Журнал «Финансовые операции по контрагентам» (задача 2.22) ───────────── */

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц — ГГГГ-ММ');
const Flag = z.enum(['0', '1']).optional();

/** Вкладки журнала (прототип FIN_TABS): «Проекты и услуги» заполнят разовые услуги. */
export const FIN_JOURNAL_TAB_IDS = ['all', 'tax', 'fee', 'proj', 'wo'] as const;

/** Вкладка журнала и «Показать удалённые». */
export const FinJournalParams = z.object({
  tab: z.enum(FIN_JOURNAL_TAB_IDS).default('all'),
  deleted: Flag,
});

/** «Журнал поступлений»: «Показать удалённые». */
export const ReceiptJournalParams = z.object({ deleted: Flag });

/** Строка журнала (прототип finRows): операция по счёту контрагента или оплата за обслуживание. */
export const FinJournalRow = z.object({
  key: z.string(),
  src: z.enum(['op', 'fee']),
  id: Uuid,
  kind: z.string(),
  self: z.boolean(),
  contractor: z.object({ id: Uuid, name: z.string() }),
  date: IsoDate,
  /** Сумма без знака; со знаком — `signed` (расход с минусом, у обратной записи — её знак). */
  amount: Tyiyn,
  signed: z.number().int(),
  what: z.string(),
  deleted: z.boolean(),
  edited: z.boolean(),
  acc: z.object({ kind: z.enum(MONEY_HOLDER_KINDS), name: z.string().nullable() }),
  by: z.string().nullable(),
  files: z.number().int().nonnegative(),
  rep: z.string().nullable(),
  per: z.string().nullable(),
  note: z.string(),
  /** Оплата за обслуживание — часть общего поступления. */
  receiptPart: z.boolean(),
  /** «Открыть источник»: отчёт оплаты налога, общее поступление оплаты за обслуживание. */
  reportId: Uuid.nullable(),
  receipt: z.object({ id: Uuid, total: Tyiyn, date: IsoDate }).nullable(),
  /** Меню строки: почему нельзя «Изменить» и «Удалить» (прототип `opLock`); null — можно. */
  locks: z.object({ edit: Lock, del: Lock }),
  audit: RecordAudit,
});
export type FinJournalRow = z.infer<typeof FinJournalRow>;

/** Строка «Журнала поступлений» (прототип renderJournal). */
export const ReceiptJournalRow = z.object({
  id: Uuid,
  contractor: z.object({ id: Uuid, name: z.string() }),
  date: IsoDate,
  total: Tyiyn,
  tax: Tyiyn,
  /** Часть за обслуживание; null — плата не видна. */
  fee: Tyiyn.nullable(),
  distributed: Tyiyn,
  advance: Tyiyn,
  lines: z.number().int().nonnegative(),
  alloc: z.string().nullable(),
  corrections: z.number().int().nullable(),
  /** На налоги уже потрачено (прототип `inMin`). */
  spent: Tyiyn,
  deleted: z.boolean(),
  edited: z.boolean(),
  files: z.number().int().nonnegative(),
  by: z.string().nullable(),
  note: z.string(),
  holder: z.object({ kind: z.enum(MONEY_HOLDER_KINDS), name: z.string().nullable() }),
  audit: RecordAudit,
  /** Замки «Изменить», «Обратная запись» и «Удалить» в меню строки (прототип opActs). */
  locks: z.object({ edit: Lock, del: Lock }),
});
export type ReceiptJournalRow = z.infer<typeof ReceiptJournalRow>;

/** Плашки модуля за текущий месяц (прототип renderFin); null — группа не видна. */
export const FinSummary = z.object({
  month: Month,
  tax: z.object({ received: Tyiyn, paid: Tyiyn }).nullable(),
  fee: Tyiyn.nullable(),
  wo: Tyiyn.nullable(),
});
export type FinSummary = z.infer<typeof FinSummary>;

/** Строка вкладки «Списания в бонус» (прототип staff.js, `bonus`). */
export const BonusRow = z.object({
  id: Uuid,
  date: IsoDate,
  contractor: z.object({ id: Uuid, name: z.string() }),
  holder: z.object({ kind: z.enum(MONEY_HOLDER_KINDS), name: z.string().nullable() }),
  amount: Tyiyn,
  note: z.string(),
  by: z.string().nullable(),
  /** Меню строки: почему нельзя «Изменить» и «Отменить списание»; null — можно. */
  locks: z.object({ edit: Lock, del: Lock }),
  audit: RecordAudit,
});
export type BonusRow = z.infer<typeof BonusRow>;

/** Закрытые месяцы и «Закрыть <прошлый месяц>» (прототип staff.js: `CLOSED`, `bg-close`). */
export const ClosedMonths = z.object({
  closed: z.array(Month),
  /** Прошлый месяц — его закрывают. */
  toClose: Month,
  /** Кнопка «Закрыть …»: право «Списывать остаток в бонус» и область «Все» финансовых операций. */
  canClose: z.boolean(),
  /** Списаний за прошлый месяц — для подтверждения. */
  bonuses: z.object({ count: z.number().int().nonnegative(), amount: Tyiyn }),
});
export type ClosedMonths = z.infer<typeof ClosedMonths>;

export const CloseMonthRequest = z.strictObject({ month: Month });
export type CloseMonthRequest = z.infer<typeof CloseMonthRequest>;

/** Счёт в окне изменения: `org` или сотрудник. */
const EditAccount = z.object({
  key: z.string(),
  name: z.string().nullable(),
  responsible: z.boolean(),
});

/** Окно «Изменить: …» (прототип opEditDlg). */
export const OperationEditForm = z.object({
  id: Uuid,
  version: RecordVersion,
  kind: z.enum(MONEY_OP_KINDS),
  self: z.boolean(),
  contractor: z.object({ id: Uuid, name: z.string() }),
  /** Обратная запись: «Уменьшить» или «Увеличить». */
  sign: z.enum(['-', '+']).nullable(),
  amount: Tyiyn,
  date: IsoDate,
  holder: z.string(),
  note: z.string(),
  /** «Счёт» или «Кому»; null — у этого вида счёта нет. */
  accounts: z.array(EditAccount).nullable(),
  /** «Не больше …» у суммы; null — без предела. */
  max: Tyiyn.nullable(),
  /** Обратная запись: уменьшить — не больше этого. */
  available: Tyiyn,
  /**
   * «Добавить файлы» (прототип opEditDlg): сколько файлов уже приложено; null — «Файлы в карточках»
   * выключены.
   */
  files: z.number().int().nonnegative().nullable(),
  today: IsoDate,
});
export type OperationEditForm = z.infer<typeof OperationEditForm>;

const EditReason = z.string().max(OP_REASON_MAX).default('');

export const OperationEditRequest = z.strictObject({
  version: RecordVersion,
  amount: Positive,
  sign: z.enum(['-', '+']).optional(),
  date: IsoDate,
  holder: z.string().max(40).optional(),
  note: Note.default(''),
  reason: EditReason,
});
export type OperationEditRequest = z.input<typeof OperationEditRequest>;

/** Сохранено: `changed` — false, если ничего не менялось («Без изменений»). */
export const OperationEdited = z.object({ changed: z.boolean() });
export type OperationEdited = z.infer<typeof OperationEdited>;

/** Окно «Изменить поступление» (прототип inDlg с `edit`): форма поступления и то, что было введено. */
export const ReceiptEditForm = ReceiptForm.extend({
  edit: z.object({
    id: Uuid,
    version: RecordVersion,
    /** Общая сумма: с платой — тому, кто её видит. */
    total: Tyiyn,
    date: IsoDate,
    rows: z.array(z.object({ reportId: Uuid, amount: Tyiyn })),
    /** Части за обслуживание; null — плата не видна. */
    fee: z.array(z.object({ month: Month, amount: Tyiyn })).nullable(),
    holder: z.string(),
    accounts: z.array(EditAccount),
    /** Уже потрачено на налоги и оплаты, которые мешают уменьшить сильнее (прототип `inEditNote`). */
    spent: z
      .object({
        min: Tyiyn,
        payments: z.array(z.object({ id: Uuid, report: z.string(), date: IsoDate, amount: Tyiyn })),
      })
      .nullable(),
    files: z.number().int().nonnegative(),
  }),
});
export type ReceiptEditForm = z.infer<typeof ReceiptEditForm>;

/** Новые файлы окно изменения загружает к поступлению отдельно, после сохранения. */
export const ReceiptEditRequest = ReceiptRequest.omit({ files: true }).extend({
  version: RecordVersion,
  holder: z.string().max(40),
  reason: EditReason,
});
export type ReceiptEditRequest = z.input<typeof ReceiptEditRequest>;

/** Окно оплаты за обслуживание (прототип opWin с `src:'fee'`). */
export const FeePaymentWindow = z.object({
  id: Uuid,
  version: RecordVersion,
  contractor: z.object({ id: Uuid, name: z.string(), archived: z.boolean() }),
  date: IsoDate,
  amount: Tyiyn,
  allocation: z.array(z.object({ month: Month, amount: Tyiyn })),
  /** «Куда поступили»: подпись и вид (владельцу — значок человека, как в прототипе). */
  to: z.string(),
  toOwner: z.boolean(),
  note: z.string(),
  edited: z.boolean(),
  /** Часть общего поступления. */
  receipt: z.object({ id: Uuid, date: IsoDate, total: Tyiyn }).nullable(),
  created: Audit,
  updated: Audit,
  deleted: z.object({ name: z.string().nullable(), at: z.string(), reason: z.string() }).nullable(),
  locks: z.object({ edit: Lock, del: Lock }),
  /** «Изменить» у части поступления открывает окно поступления. */
  editReceipt: z.boolean(),
  files: z.boolean(),
  history: OperationWindow.shape.history,
});
export type FeePaymentWindow = z.infer<typeof FeePaymentWindow>;

export const FeePaymentIdParam = z.object({ id: Uuid });

/** Окно «Изменить оплату за обслуживание» (прототип feePayDlg с `edit`). */
export const FeePaymentEditForm = FeePaymentForm.extend({
  edit: z.object({
    id: Uuid,
    version: RecordVersion,
    date: IsoDate,
    to: z.string(),
    note: z.string(),
    files: z.number().int().nonnegative(),
  }),
});
export type FeePaymentEditForm = z.infer<typeof FeePaymentEditForm>;

/** Новые файлы окно изменения загружает к оплате отдельно, после сохранения. */
export const FeePaymentEditRequest = FeePaymentRequest.omit({ files: true }).extend({
  version: RecordVersion,
  reason: EditReason,
});
export type FeePaymentEditRequest = z.input<typeof FeePaymentEditRequest>;
