import {
  HISTORY_ACTIONS,
  MONEY_AMOUNT_MAX,
  MONEY_HOLDER_KINDS,
  MONEY_NOTE_MAX,
  MONEY_OP_KINDS,
  OP_REASON_MAX,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Tyiyn, Uuid } from './common';

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
  kind: z.enum(MONEY_OP_KINDS),
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
  files: z.object({ kind: z.enum(['receipt', 'tax_payment']) }).nullable(),
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
