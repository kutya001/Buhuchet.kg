import {
  closesWithMonth,
  contractorFees,
  feePaymentErrorCode,
  feePaymentForm,
  feePaymentProblem,
  formatSomWithUnit,
  MONEY_NOTE_MAX,
  monthLabel,
  needsReason,
  opAmountLimit,
  receiptMinimum,
  RecordChangedError,
  RecordNotFoundError,
  savedAllocation,
  type Allocation,
  type ContractorFees,
  type FeePaymentForm,
  type IsoDate,
  type MoneyHolderKind,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  feeSubject,
  feeToOptions,
  FeeRefusedError,
  insertReceiptFeePayments,
  receiptFeeLeft,
  receiptFeeParts,
  receiptFeeRows,
  type FeeSubject,
  type FeeToOption,
  type ReceiptFeeMonth,
} from './fees';
import {
  contractorFunds,
  operationDeleteBlock,
  transferTargets,
  type LockedOperation,
} from './finance';
import { monthClosed } from './finance-journal';
import { writeHistory, type HistoryEntry } from './history';
import {
  availableOf,
  MoneyRefusedError,
  receiptFormRows,
  reportLabel,
  syncPaymentState,
  type MoneyContractor,
} from './money-tax';
import { lockReport } from './reports';
import {
  auditLog,
  contractors,
  employees,
  feeAllocations,
  feePayments,
  moneyAllocations,
  moneyOperations,
  orgSettings,
  reports,
} from './schema';

/*
 * «Изменить» операции и окно оплаты за обслуживание (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам» → «Окно оплаты»: «Изменить» и «Удалить» с причиной, было → стало; «Поступление от
 * контрагента»: уменьшить поступление можно только на деньги, которые ещё не потрачены на налоги;
 * прототип modules/fin-op.js `opEditDlg`, `opMax`, `inBlock`, `opDelDlg`; modules/contractors.js `inDlg`
 * с `edit`; modules/contractor-card.js `feePayDlg` с `edit`). Контрагент и операция уже заблокированы
 * (`lockOperation`); права, архив и закрытый месяц операции (`opLock`) проверяет вызывающий — здесь
 * правила самого изменения: суммы, даты, счёта и причины.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MoneyOperationRecord = typeof moneyOperations.$inferSelect;

/** Счёт в окне изменения (прототип `accs`): `org` или сотрудник. */
export interface EditAccount {
  key: string;
  /** null — счёт организации. */
  name: string | null;
  responsible: boolean;
}

/** Ключ счёта операции: `org`, `client` или номер сотрудника. */
export const holderKeyOf = (op: Pick<MoneyOperationRecord, 'holderKind' | 'holderEmployeeId'>) =>
  op.holderKind === 'employee' ? op.holderEmployeeId! : op.holderKind;

/**
 * Счета окна изменения (прототип opEditDlg, `accs`; inDlg с `edit`, «Счёт»): счёт организации (у
 * перевода — нет) и активные сотрудники кроме владельца, а также сотрудник, на чьём счету операция
 * сейчас.
 */
export async function editAccounts(
  tx: Tx,
  c: Pick<MoneyContractor, 'responsibleEmployeeId'>,
  current: string | null,
  withOrg: boolean,
): Promise<EditAccount[]> {
  const list = await transferTargets(tx);
  const out: EditAccount[] = withOrg ? [{ key: 'org', name: null, responsible: false }] : [];
  const ids = new Set(list.map((e) => e.id));
  if (current && current !== 'org' && current !== 'client' && !ids.has(current)) {
    const [e] = await tx
      .select({ id: employees.id, fullName: employees.fullName, shortName: employees.shortName })
      .from(employees)
      .where(eq(employees.id, current));
    if (e) list.push(e);
  }
  for (const e of list) {
    out.push({ key: e.id, name: e.shortName, responsible: e.id === c.responsibleEmployeeId });
  }
  return out;
}

/** Название счёта для истории (прототип `accName`): null — счёт организации, иначе имя сотрудника. */
async function holderName(tx: Tx, key: string): Promise<string | null> {
  if (key === 'org' || key === 'client') return null;
  const [e] = await tx
    .select({ name: employees.shortName })
    .from(employees)
    .where(eq(employees.id, key));
  return e?.name ?? null;
}

const holderFields = (
  key: string,
): { holderKind: MoneyHolderKind; holderEmployeeId: string | null } =>
  key === 'org'
    ? { holderKind: 'org', holderEmployeeId: null }
    : { holderKind: 'employee', holderEmployeeId: key };

/** Виды, у которых в окне изменения есть «Счёт» или «Кому» (прототип `hasAcc`). */
const HAS_ACCOUNT = new Set(['pay', 'bonus', 'refund', 'corr', 'xfer']);
export const editHasAccount = (op: Pick<MoneyOperationRecord, 'kind' | 'self'>) =>
  HAS_ACCOUNT.has(op.kind) && !op.self;

/* ───────────── Оплата, списание, возврат, перевод, обратная запись ───────────── */

/** Окно «Изменить: …» (прототип opEditDlg). */
export interface OperationEditForm {
  op: MoneyOperationRecord;
  /** «Не больше …» у суммы (прототип `opMax`); null — без предела. */
  max: Tyiyn | null;
  /** Обратная запись: насколько можно уменьшить (прототип: `c.avail`). */
  available: Tyiyn;
  accounts: EditAccount[] | null;
}

export async function operationEditForm(
  tx: Tx,
  { op, c }: LockedOperation,
): Promise<OperationEditForm> {
  const funds = await contractorFunds(tx, c.id);
  const amount = Math.abs(Number(op.amount));
  const limit = opAmountLimit(op.kind, amount, { ...funds, self: op.self });
  const accounts = editHasAccount(op)
    ? await editAccounts(tx, c, holderKeyOf(op), op.kind !== 'xfer')
    : null;
  return { op, max: limit?.max ?? null, available: funds.available, accounts };
}

/** Ввод окна «Изменить: …». */
export interface OperationEditInput {
  version: number;
  /** Сумма больше 0; у обратной записи знак — в `sign`. */
  amount: Tyiyn;
  sign?: '-' | '+';
  date: IsoDate;
  /** Счёт (`org` или сотрудник) — у видов со «Счётом». */
  holder?: string;
  note: string;
  reason: string;
}

/**
 * «Сохранить» в окне «Изменить: …» (прототип opEditDlg): сумма больше 0 и не больше предела вида
 * (`opAmountLimit`), у обратной записи уменьшение — не больше денег контрагента на счетах; дата не позже
 * сегодня и не в закрытом месяце (у оплаты, списания и возврата); причина обязательна, если меняются
 * сумма, дата или счёт. Оплата налога меняет «Оплачено в бюджет» отчёта на разницу, статус оплаты
 * пересчитывается. В истории операции — было → стало с причиной; операция получает «Изменена».
 */
export async function editOperation(
  tx: Tx,
  { op, c }: LockedOperation,
  input: OperationEditInput,
  ctx: { today: IsoDate; t: Translate },
): Promise<{ changed: boolean }> {
  if (op.cancelledAt) throw new MoneyRefusedError('op_deleted');
  if (op.kind === 'back') throw new MoneyRefusedError('op_system');
  if (op.kind === 'in') throw new RecordNotFoundError('money_operation', op.id);
  if (op.version !== input.version)
    throw new RecordChangedError('money_operation', op.id, op.version);
  const a0 = Math.abs(Number(op.amount));
  const s0 = Number(op.amount);
  const sign0 = op.kind === 'corr' ? (s0 < 0 ? '-' : '+') : null;
  const sign = op.kind === 'corr' ? (input.sign ?? sign0!) : null;
  const s1 = sign === '-' ? -input.amount : input.amount;
  if (!(input.amount > 0)) throw new MoneyRefusedError('op_amount_required', 400, 'amount');
  const funds = await contractorFunds(tx, c.id);
  const limit = opAmountLimit(op.kind, a0, { ...funds, self: op.self });
  if (limit && input.amount > limit.max) {
    throw new MoneyRefusedError(limit.code, 400, 'amount', limit.params);
  }
  if (op.kind === 'corr' && s1 < s0 && s0 - s1 > funds.available) {
    throw new MoneyRefusedError('op_corr_over', 400, 'amount', {
      amount: formatSomWithUnit(Math.max(0, funds.available)),
    });
  }
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  if (closesWithMonth(op.kind) && input.date !== op.opDate && (await monthClosed(tx, input.date))) {
    throw new MoneyRefusedError('op_date_closed', 400, 'date');
  }
  const hasAcc = editHasAccount(op);
  const holder0 = holderKeyOf(op);
  const holder = hasAcc && input.holder ? input.holder : holder0;
  if (holder !== holder0) {
    const accounts = await editAccounts(tx, c, holder0, op.kind !== 'xfer');
    if (!accounts.some((x) => x.key === holder)) {
      throw new MoneyRefusedError('op_holder_invalid', 400, 'holder');
    }
  }
  const note = input.note.trim().slice(0, MONEY_NOTE_MAX);
  const changes: HistoryEntry['changes'] & object = [];
  if (s1 !== s0) changes.push({ field: 'amount', from: s0, to: s1 });
  if (input.date !== op.opDate) changes.push({ field: 'opDate', from: op.opDate, to: input.date });
  if (holder !== holder0) {
    changes.push({
      field: 'holder',
      from: { kind: op.holderKind, name: await holderName(tx, holder0) },
      to: { kind: holderFields(holder).holderKind, name: await holderName(tx, holder) },
    });
  }
  if (note !== op.note) changes.push({ field: 'note', from: op.note, to: note });
  const reason = input.reason.trim();
  if (needsReason(changes.map((x) => x.field)) && !reason) {
    throw new MoneyRefusedError('op_reason_required', 400, 'reason');
  }
  if (!changes.length) return { changed: false };
  const entries: HistoryEntry[] = [];
  // Оплата налога: «Оплачено в бюджет» отчёта — на разницу (прототип: `r.paid - a0 + n`).
  if (op.kind === 'pay' && op.reportId && s1 !== s0) {
    const r = await lockReport(tx, op.reportId, undefined);
    // ОТКЛОНЕНИЕ: docs/deviations.md#В-20 — у прежней версии оплату не меняют, как не удаляют.
    if (r.superseded) throw new MoneyRefusedError('payment_superseded');
    const paid = Number(r.paid);
    const next = Math.max(0, paid - a0 + input.amount);
    await tx
      .update(reports)
      .set({
        paid: next,
        version: sql`${reports.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(reports.id, r.id));
    await syncPaymentState(tx, r.id);
    entries.push({
      entity: 'report',
      entityId: r.id,
      action: 'update',
      changes: [{ field: 'paid', from: paid, to: next }],
      reason,
      contractorId: c.id,
    });
  }
  await tx
    .update(moneyOperations)
    .set({
      amount: s1,
      opDate: input.date,
      ...(holder !== holder0 ? holderFields(holder) : {}),
      note,
      edited: true,
      version: sql`${moneyOperations.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(moneyOperations.id, op.id));
  entries.unshift({
    entity: 'money_operation',
    entityId: op.id,
    action: 'update',
    changes: [{ field: 'kind', from: op.kind, to: op.kind }, ...changes],
    reason: reason || null,
    contractorId: c.id,
  });
  await writeHistory(tx, ...entries);
  return { changed: true };
}

/* ───────────── Поступление ───────────── */

/**
 * Сколько из поступления уже потрачено на налоги и какие оплаты мешают уменьшить его сильнее (прототип
 * `inEditNote`, `inBlock(o, 0)`): null — потраченного нет.
 */
export async function receiptSpent(tx: Tx, op: MoneyOperationRecord, t: Translate) {
  const available = await availableOf(tx, op.contractorId);
  const min = receiptMinimum(Number(op.amount), available);
  if (min <= 0) return null;
  const block = await operationDeleteBlock(tx, op, t);
  return { min, payments: block?.payments ?? [] };
}

/** Окно «Изменить поступление»: что было введено и что можно ввести. */
export interface ReceiptEditForm {
  op: MoneyOperationRecord;
  rows: Awaited<ReturnType<typeof receiptFormRows>>;
  /** Детализация: отчёт и сумма. */
  allocations: { reportId: string; amount: Tyiyn }[];
  /** Части за обслуживание (тому, кто видит плату). */
  fee: { months: ReceiptFeeMonth[]; parts: Allocation } | null;
  accounts: EditAccount[];
  spent: Awaited<ReturnType<typeof receiptSpent>>;
}

export async function receiptEditForm(
  tx: Tx,
  { op, c }: LockedOperation,
  ctx: { today: IsoDate; fee: boolean; t: Translate },
): Promise<ReceiptEditForm> {
  const [rows, allocs, parts, accounts, spent] = await Promise.all([
    receiptFormRows(tx, c.id, op.id),
    tx
      .select({ reportId: moneyAllocations.reportId, amount: moneyAllocations.amount })
      .from(moneyAllocations)
      .where(eq(moneyAllocations.operationId, op.id)),
    receiptFeeParts(tx, op.id),
    editAccounts(tx, c, holderKeyOf(op), true),
    receiptSpent(tx, op, ctx.t),
  ]);
  return {
    op,
    rows,
    allocations: allocs.map((a) => ({ reportId: a.reportId, amount: Number(a.amount) })),
    fee: ctx.fee
      ? {
          months: await receiptFeeRows(tx, c.id, ctx.today, op.id),
          parts: parts.map((p) => ({ month: p.month, amount: p.amount })),
        }
      : null,
    accounts,
    spent,
  };
}

/** Ввод «Изменить поступление». */
export interface ReceiptEditInput {
  version: number;
  total: Tyiyn;
  date: IsoDate;
  rows: readonly { reportId: string; amount: Tyiyn }[];
  /** Части за обслуживание — только тому, кто видит плату; иначе они остаются как были. */
  fee?: Allocation;
  holder: string;
  reason: string;
}

const allocLabel = (rows: readonly { report: string; amount: Tyiyn }[]) =>
  rows.map((x) => `${x.report}:${x.amount}`).join(';');
const feeLabel = (rows: Allocation) => rows.map((x) => `${x.month}:${x.amount}`).join(';');

/**
 * «Сохранить» в окне «Изменить поступление» (прототип inDlg с `edit`): как запись поступления —
 * детализация по отчётам контрагента не больше «Осталось» (его собственная детализация не считается
 * «уже полученным»), общая сумма не меньше детализации; на налоги должно остаться не меньше уже
 * потраченного (`receiptMinimum`, прототип `inMin`). Причина обязательна, если меняются сумма, дата,
 * детализация или счёт. Детализация заменяется; части за обслуживание пересоздаются (прототип: старые
 * удаляются, новые записываются), у того, кто их не видит, — остаются как были (меняется только дата).
 */
export async function editReceipt(
  tx: Tx,
  { op, c }: LockedOperation,
  input: ReceiptEditInput,
  ctx: { today: IsoDate; fee: boolean; t: Translate },
): Promise<{ changed: boolean }> {
  if (op.kind !== 'in') throw new RecordNotFoundError('money_operation', op.id);
  if (op.cancelledAt) throw new MoneyRefusedError('op_deleted');
  if (c.archived) throw new MoneyRefusedError('op_archived');
  if (op.version !== input.version)
    throw new RecordChangedError('money_operation', op.id, op.version);
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  const rows = input.rows.filter((x) => x.amount > 0);
  if (new Set(rows.map((x) => x.reportId)).size !== rows.length) {
    throw new MoneyRefusedError('receipt_row_invalid', 400, 'rows');
  }
  const parts0 = await receiptFeeParts(tx, op.id);
  const fee0: Allocation = parts0.map((p) => ({ month: p.month, amount: p.amount }));
  const feeVisible = ctx.fee && c.paysTo === 'org' && !c.oneOff;
  const fee: Allocation = feeVisible
    ? (input.fee ?? [])
        .filter((x) => x.amount > 0)
        .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    : fee0;
  if (!feeVisible && (input.fee ?? []).some((x) => x.amount > 0)) {
    throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
  }
  const feeSum = fee.reduce((a, x) => a + x.amount, 0);
  // Без права на плату сотрудник видит и вводит только часть на налоги.
  const total = feeVisible ? input.total : input.total + feeSum;
  if (!(total > 0)) throw new MoneyRefusedError('op_amount_required', 400, 'total');
  const detail = rows.reduce((a, x) => a + x.amount, 0) + feeSum;
  if (detail > total) throw new MoneyRefusedError('receipt_total_less', 400, 'total');
  const open = new Map((await receiptFormRows(tx, c.id, op.id)).rows.map((r) => [r.reportId, r]));
  for (const x of rows) {
    const r = open.get(x.reportId);
    if (!r) throw new MoneyRefusedError('receipt_row_invalid', 400, 'rows');
    if (x.amount > r.left) throw new MoneyRefusedError('receipt_row_over', 400, 'rows');
  }
  const feeChanged = feeVisible && feeLabel(fee) !== feeLabel(fee0);
  if (feeChanged && fee.length) {
    if (new Set(fee.map((x) => x.month)).size !== fee.length) {
      throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
    }
    const left = await receiptFeeLeft(tx, c.id, ctx.today, op.id);
    for (const x of fee) {
      const l = left.get(x.month);
      if (l === undefined) throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
      if (x.amount > l) throw new MoneyRefusedError('receipt_row_over', 400, 'fee');
    }
  }
  const tax = total - feeSum;
  // На налоги — не меньше уже потраченного (прототип `inMin`).
  const min = receiptMinimum(Number(op.amount), await availableOf(tx, c.id));
  if (tax < min) {
    throw new MoneyRefusedError('receipt_min', 400, 'total', { amount: formatSomWithUnit(min) });
  }
  const holder0 = holderKeyOf(op);
  const holder = input.holder || holder0;
  if (holder !== holder0) {
    const accounts = await editAccounts(tx, c, holder0, true);
    if (!accounts.some((x) => x.key === holder)) {
      throw new MoneyRefusedError('op_holder_invalid', 400, 'holder');
    }
  }
  const allocs0 = await tx
    .select({ reportId: moneyAllocations.reportId, amount: moneyAllocations.amount })
    .from(moneyAllocations)
    .where(eq(moneyAllocations.operationId, op.id))
    .orderBy(asc(moneyAllocations.reportId));
  const labels = await reportLabels(
    tx,
    [...allocs0.map((a) => a.reportId), ...rows.map((r) => r.reportId)],
    ctx.t,
  );
  const from = allocs0.map((a) => ({
    report: labels.get(a.reportId) ?? '—',
    amount: Number(a.amount),
  }));
  const to = [...rows]
    .sort((a, b) => (a.reportId < b.reportId ? -1 : 1))
    .map((x) => ({ report: labels.get(x.reportId) ?? '—', amount: x.amount }));
  const tax0 = Number(op.amount);
  const sum0 = fee0.reduce((a, x) => a + x.amount, 0);
  const rowsOf = (list: readonly { amount: Tyiyn }[]) => list.reduce((a, x) => a + x.amount, 0);
  // Детализация (прототип allocText): отчёты, обслуживание и аванс — аванс считается, только когда
  // есть строки. Изменилась — в историю вся детализация «было → стало» и обе суммы на налоги, чтобы
  // строка «детализация «…» → «…»» показала и аванс.
  const listed = from.length + to.length + fee0.length + fee.length > 0;
  const detailChanged =
    allocLabel(from) !== allocLabel(to) ||
    feeChanged ||
    (listed && tax0 - rowsOf(from) !== tax - rowsOf(to));
  const changes: NonNullable<HistoryEntry['changes']> = [];
  if (tax !== tax0 || detailChanged) changes.push({ field: 'total', from: tax0, to: tax });
  if (input.date !== op.opDate) changes.push({ field: 'opDate', from: op.opDate, to: input.date });
  if (detailChanged) changes.push({ field: 'allocations', from, to });
  if ((tax !== tax0 || detailChanged) && (sum0 || feeSum)) {
    changes.push({ field: 'feeTotal', from: sum0, to: feeSum });
  }
  if (detailChanged && (fee0.length || fee.length)) {
    changes.push({
      field: 'feeAllocations',
      from: fee0.map((x) => ({ month: x.month, amount: x.amount })),
      to: fee.map((x) => ({ month: x.month, amount: x.amount })),
    });
  }
  if (holder !== holder0) {
    changes.push({
      field: 'holder',
      from: { kind: op.holderKind, name: await holderName(tx, holder0) },
      to: { kind: holderFields(holder).holderKind, name: await holderName(tx, holder) },
    });
  }
  const reason = input.reason.trim();
  if (needsReason(changes.map((x) => x.field)) && !reason) {
    throw new MoneyRefusedError('op_reason_required', 400, 'reason');
  }
  if (!changes.length) {
    // Прототип inDlg с `edit`: сохранение без изменений — «Сохранено без изменений» в истории, отметки
    // «Изменена» нет.
    await tx
      .update(moneyOperations)
      .set({
        version: sql`${moneyOperations.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(moneyOperations.id, op.id));
    await writeHistory(tx, {
      entity: 'money_operation',
      entityId: op.id,
      action: 'update',
      changes: [{ field: 'kind', from: 'in', to: 'in' }],
      contractorId: c.id,
    });
    return { changed: false };
  }
  await tx
    .update(moneyOperations)
    .set({
      amount: tax,
      total,
      opDate: input.date,
      ...(holder !== holder0 ? holderFields(holder) : {}),
      edited: true,
      version: sql`${moneyOperations.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(moneyOperations.id, op.id));
  if (allocLabel(from) !== allocLabel(to)) {
    await tx.delete(moneyAllocations).where(eq(moneyAllocations.operationId, op.id));
    if (rows.length) {
      await tx
        .insert(moneyAllocations)
        .values(rows.map((x) => ({ operationId: op.id, reportId: x.reportId, amount: x.amount })));
    }
  }
  if (feeChanged) {
    // Части общего поступления пересоздаются (прототип inDlg); удалённые части остаются в журнале.
    await tx
      .delete(feePayments)
      .where(and(eq(feePayments.operationId, op.id), isNull(feePayments.deletedAt)));
    await insertReceiptFeePayments(
      tx,
      c.id,
      { operationId: op.id, date: input.date, rows: fee },
      ctx.t,
    );
  } else if (input.date !== op.opDate && parts0.length) {
    await tx
      .update(feePayments)
      .set({
        paidOn: input.date,
        version: sql`${feePayments.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(and(eq(feePayments.operationId, op.id), isNull(feePayments.deletedAt)));
  }
  await writeHistory(tx, {
    entity: 'money_operation',
    entityId: op.id,
    action: 'update',
    changes: [{ field: 'kind', from: 'in', to: 'in' }, ...changes],
    reason,
    contractorId: c.id,
  });
  return { changed: true };
}

/** «НДС 09.2026» отчётов по номерам. */
async function reportLabels(
  tx: Tx,
  ids: readonly string[],
  t: Translate,
): Promise<Map<string, string>> {
  const list = [...new Set(ids)].filter((id) => UUID.test(id));
  if (!list.length) return new Map();
  const rows = await tx
    .select({
      id: reports.id,
      typeShort: sql<string>`(select rt.short_name from report_types rt where rt.code = ${reports.reportTypeCode})`,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
    })
    .from(reports)
    .where(inArray(reports.id, list));
  return new Map(rows.map((r) => [r.id, reportLabel(r, t)]));
}

/* ───────────── Оплата за обслуживание ───────────── */

/** Оплата за обслуживание, заблокированная вместе с контрагентом. */
export interface LockedFeePayment {
  payment: typeof feePayments.$inferSelect;
  contractor: { id: string; name: string; archived: boolean; responsibleEmployeeId: string | null };
}

/**
 * Оплата за обслуживание в области `scope`; `lock` — заблокировать контрагента и оплату (изменение и
 * удаление). Нет такой или контрагент вне области — `RecordNotFoundError`.
 */
export async function feePaymentOf(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
  lock: boolean,
): Promise<LockedFeePayment> {
  if (!UUID.test(id)) throw new RecordNotFoundError('fee_payment', id);
  const [row] = await tx
    .select({ contractorId: feePayments.contractorId })
    .from(feePayments)
    .where(eq(feePayments.id, id));
  if (!row) throw new RecordNotFoundError('fee_payment', id);
  const q = tx
    .select({
      id: contractors.id,
      name: contractors.name,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
    })
    .from(contractors)
    .where(and(eq(contractors.id, row.contractorId), scope));
  const [contractor] = lock ? await q.for('no key update') : await q;
  if (!contractor) throw new RecordNotFoundError('fee_payment', id);
  const p = tx.select().from(feePayments).where(eq(feePayments.id, id));
  const [payment] = lock ? await p.for('no key update') : await p;
  if (!payment) throw new RecordNotFoundError('fee_payment', id);
  return { payment, contractor };
}

const fpCreated = alias(employees, 'fp_created');
const fpUpdated = alias(employees, 'fp_updated');
const fpDeleted = alias(employees, 'fp_deleted');

/** Окно оплаты за обслуживание (прототип opWin с `src:'fee'`). */
export interface FeePaymentCard {
  payment: typeof feePayments.$inferSelect;
  contractor: LockedFeePayment['contractor'];
  allocation: Allocation;
  /** Общее поступление, частью которого она является. */
  receipt: { id: string; date: IsoDate; total: Tyiyn } | null;
  createdName: string | null;
  updatedName: string | null;
  deletedName: string | null;
  /** История оплаты: сначала новые (как у окна операции). */
  history: {
    id: number;
    at: Date;
    actorName: string | null;
    action: string;
    changes: unknown;
    reason: string | null;
  }[];
}

const fpHistActor = alias(employees, 'fp_hist_actor');

export async function feePaymentCard(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<FeePaymentCard | null> {
  let found: LockedFeePayment;
  try {
    found = await feePaymentOf(tx, id, scope, false);
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
  const [names, allocs, receipt, history] = await Promise.all([
    tx
      .select({
        created: fpCreated.shortName,
        updated: fpUpdated.shortName,
        deleted: fpDeleted.shortName,
      })
      .from(feePayments)
      .leftJoin(fpCreated, eq(fpCreated.userId, feePayments.createdBy))
      .leftJoin(fpUpdated, eq(fpUpdated.userId, feePayments.updatedBy))
      .leftJoin(fpDeleted, eq(fpDeleted.userId, feePayments.deletedBy))
      .where(eq(feePayments.id, id)),
    tx
      .select({ month: feeAllocations.month, amount: feeAllocations.amount })
      .from(feeAllocations)
      .where(eq(feeAllocations.paymentId, id))
      .orderBy(asc(feeAllocations.month)),
    found.payment.operationId
      ? tx
          .select({
            id: moneyOperations.id,
            date: moneyOperations.opDate,
            total: sql<string>`coalesce(${moneyOperations.total}, ${moneyOperations.amount})`,
          })
          .from(moneyOperations)
          .where(eq(moneyOperations.id, found.payment.operationId))
      : [],
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: fpHistActor.shortName,
        action: auditLog.action,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(fpHistActor, eq(fpHistActor.userId, auditLog.actorUserId))
      .where(and(eq(auditLog.entity, 'fee_payment'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
  ]);
  const n = names[0];
  const r = receipt[0];
  return {
    payment: found.payment,
    contractor: found.contractor,
    allocation: allocs.map((a) => ({
      month: a.month.slice(0, 7) as YearMonth,
      amount: Number(a.amount),
    })),
    receipt: r ? { id: r.id, date: r.date, total: Number(r.total) } : null,
    createdName: n?.created ?? null,
    updatedName: n?.updated ?? null,
    deletedName: n?.deleted ?? null,
    history,
  };
}

/** Окно «Изменить оплату за обслуживание» (прототип feePayDlg с `edit`). */
export interface FeePaymentEditForm {
  subject: FeeSubject;
  fees: ContractorFees;
  form: FeePaymentForm;
  to: FeeToOption[];
  /** Куда поступили сейчас: если такого счёта больше нет, он — первым (прототип: `sel0.unshift`). */
  current: string;
}

/** Ключ «Куда поступили» оплаты: `acc:<номер>`, `org` или `owner`. */
const toKeyOf = (p: typeof feePayments.$inferSelect) =>
  p.toKind === 'owner' ? 'owner' : p.toAccountId ? `acc:${p.toAccountId}` : 'org';

export async function feePaymentEditForm(
  tx: Tx,
  { payment, contractor }: LockedFeePayment,
  ctx: { today: IsoDate; t: Translate },
): Promise<FeePaymentEditForm> {
  const found = await feeSubject(tx, contractor.id, undefined);
  if (!found) throw new RecordNotFoundError('fee_payment', payment.id);
  const fees = contractorFees(found.subject, found.payments, ctx.today);
  const edit = found.payments.find((p) => p.id === payment.id) ?? null;
  const form = feePaymentForm(found.subject, found.payments, fees.debt, ctx.today, edit);
  const to = await feeToOptions(tx, ctx.t);
  const current = toKeyOf(payment);
  if (!to.some((x) => x.key === current)) {
    to.unshift({ key: current, label: payment.toLabel } as FeeToOption);
  }
  return { subject: found.subject, fees, form, to, current };
}

/** Ввод «Изменить оплату за обслуживание». */
export interface FeePaymentEditInput {
  version: number;
  amount: Tyiyn;
  date: IsoDate;
  to: string;
  allocation: Allocation;
  note: string;
  reason: string;
}

/**
 * «Сохранить» в окне «Изменить оплату за обслуживание» (прототип feePayDlg с `edit`): как приём оплаты —
 * строки только по месяцам окна (с недоплатой и те, что оплата закрывала), каждая не больше долга за
 * месяц без этой оплаты, сумма строк не больше суммы; причина обязательна, если меняются сумма, дата,
 * месяцы или куда поступили деньги. Распределение заменяется; оплата получает «Изменена».
 */
export async function editFeePayment(
  tx: Tx,
  locked: LockedFeePayment,
  input: FeePaymentEditInput,
  ctx: { today: IsoDate; t: Translate },
): Promise<{ changed: boolean }> {
  const { payment } = locked;
  if (payment.deletedAt) throw new FeeRefusedError('fee_payment_deleted', 409);
  if (payment.operationId) throw new FeeRefusedError('fee_payment_receipt_part', 409);
  if (payment.version !== input.version)
    throw new RecordChangedError('fee_payment', payment.id, payment.version);
  const { form, to: options } = await feePaymentEditForm(tx, locked, ctx);
  const allocation = savedAllocation(input.allocation);
  if (new Set(allocation.map((x) => x.month)).size !== allocation.length) {
    throw new FeeRefusedError('fee_month_invalid', 400, 'allocation');
  }
  const open = new Set(form.months.map((m) => m.month));
  if (allocation.some((x) => !open.has(x.month))) {
    throw new FeeRefusedError('fee_month_invalid', 400, 'allocation');
  }
  const problem = feePaymentProblem(form.months, input.amount, allocation, input.date, ctx.today);
  if (problem) {
    throw new FeeRefusedError(
      feePaymentErrorCode(problem.problem),
      400,
      problem.field === 'date'
        ? 'date'
        : problem.problem === 'row_over_debt'
          ? 'allocation'
          : 'amount',
      problem.over !== undefined ? { amount: formatSomWithUnit(problem.over) } : undefined,
    );
  }
  const to = options.find((x) => x.key === input.to);
  if (!to) throw new FeeRefusedError('fee_to_invalid', 400, 'to');
  const allocs0 = await tx
    .select({ month: feeAllocations.month, amount: feeAllocations.amount })
    .from(feeAllocations)
    .where(eq(feeAllocations.paymentId, payment.id))
    .orderBy(asc(feeAllocations.month));
  const al0: Allocation = allocs0.map((a) => ({
    month: a.month.slice(0, 7) as YearMonth,
    amount: Number(a.amount),
  }));
  const amount0 = Number(payment.amount);
  const note = input.note.trim().slice(0, MONEY_NOTE_MAX);
  const changes: NonNullable<HistoryEntry['changes']> = [];
  if (input.amount !== amount0) changes.push({ field: 'amount', from: amount0, to: input.amount });
  if (input.date !== payment.paidOn)
    changes.push({ field: 'paidOn', from: payment.paidOn, to: input.date });
  if (feeLabel(al0) !== feeLabel(allocation)) {
    changes.push({
      field: 'allocation',
      from: al0.map((x) => ({ month: x.month, amount: x.amount })),
      to: allocation.map((x) => ({ month: x.month, amount: x.amount })),
    });
  }
  if (to.key !== toKeyOf(payment))
    changes.push({ field: 'to', from: payment.toLabel, to: to.label });
  if (note !== payment.note) changes.push({ field: 'note', from: payment.note, to: note });
  const reason = input.reason.trim();
  const fields = changes.map((x) =>
    x.field === 'allocation' ? 'allocations' : x.field === 'paidOn' ? 'opDate' : x.field,
  );
  if (needsReason(fields) && !reason) {
    throw new FeeRefusedError('fee_reason_required', 400, 'reason');
  }
  if (!changes.length) {
    // Прототип feePayDlg с `edit`: сохранение без изменений — «Изменено: без изменений» в истории,
    // отметки «Изменена» нет.
    await tx
      .update(feePayments)
      .set({
        version: sql`${feePayments.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(feePayments.id, payment.id));
    await writeHistory(tx, {
      entity: 'fee_payment',
      entityId: payment.id,
      action: 'update',
      changes: [],
      contractorId: locked.contractor.id,
    });
    return { changed: false };
  }
  await tx
    .update(feePayments)
    .set({
      amount: input.amount,
      paidOn: input.date,
      toKind: to.key === 'owner' ? 'owner' : 'org',
      toAccountId: to.key.startsWith('acc:') ? to.key.slice(4) : null,
      toLabel: to.label,
      note,
      edited: true,
      version: sql`${feePayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(feePayments.id, payment.id));
  if (feeLabel(al0) !== feeLabel(allocation)) {
    await tx.delete(feeAllocations).where(eq(feeAllocations.paymentId, payment.id));
    if (allocation.length) {
      await tx.insert(feeAllocations).values(
        allocation.map((x) => ({
          paymentId: payment.id,
          month: `${x.month}-01`,
          amount: x.amount,
        })),
      );
    }
  }
  await writeHistory(tx, {
    entity: 'fee_payment',
    entityId: payment.id,
    action: 'update',
    changes,
    reason: reason || null,
    contractorId: locked.contractor.id,
  });
  return { changed: true };
}

/**
 * «Удалить» оплату за обслуживание (прототип opDelDlg с `src:'fee'`): отметка с причиной, оплата уходит
 * из долга и итогов; часть общего поступления так не удаляют — её убирают в самом поступлении.
 */
export async function deleteFeePayment(
  tx: Tx,
  { payment, contractor }: LockedFeePayment,
  reason: string,
): Promise<void> {
  if (payment.deletedAt) throw new FeeRefusedError('fee_payment_deleted', 409);
  if (payment.operationId) throw new FeeRefusedError('fee_payment_receipt_part', 409);
  const why = reason.trim();
  await tx
    .update(feePayments)
    .set({
      deletedAt: sql`now()`,
      deletedBy: sql`app.current_user_id()`,
      deleteReason: why,
      version: sql`${feePayments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(feePayments.id, payment.id));
  await writeHistory(tx, {
    entity: 'fee_payment',
    entityId: payment.id,
    action: 'delete',
    changes: [
      { field: 'amount', from: Number(payment.amount) },
      { field: 'paidOn', from: payment.paidOn },
    ],
    reason: why,
    contractorId: contractor.id,
  });
}

/* ───────────── Закрытый месяц ───────────── */

/** Месяц операции закрыт — для замка оплаты, списания и возврата (прототип `CLOSED.has(ym(x.date))`). */
export async function operationMonthClosed(
  tx: Tx,
  op: Pick<MoneyOperationRecord, 'kind' | 'opDate'>,
): Promise<boolean> {
  return closesWithMonth(op.kind) && (await monthClosed(tx, op.opDate));
}

/** «Закрыть <месяц>»: название месяца для истории и подтверждения. */
export const closedMonthLabel = (m: YearMonth) => monthLabel(m);

/* ───────────── Файлы операций ───────────── */

/** Виды операций, файлы которых — источник «Финансовая операция» (поступление и оплата — свои). */
export const OPERATION_FILE_KINDS = ['bonus', 'refund', 'xfer', 'corr', 'back'] as const;

/**
 * Операция-источник файлов (задача 2.22; прототип opWin: блок «Файлы» у всех операций, opEditDlg —
 * «Добавить файлы»): списание, возврат, перевод, обратная запись, возврат по уточнённому — контрагента в
 * области `scope`. Поступление и оплата налога — источники «Поступление» и «Оплата налога»
 * (`moneyFileSource`).
 */
export async function operationFileSource(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{
  contractor: { id: string; responsibleEmployeeId: string | null; archived: boolean };
  kind: (typeof OPERATION_FILE_KINDS)[number];
  opDate: IsoDate;
  cancelled: boolean;
  /** «Учёт оплаты налогов» включён в учётной политике. */
  taxpay: boolean;
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx
    .select({
      contractorId: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      kind: moneyOperations.kind,
      opDate: moneyOperations.opDate,
      cancelled: sql<boolean>`${moneyOperations.cancelledAt} is not null`,
      taxpay: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'taxpay')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
    })
    .from(moneyOperations)
    .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
    .where(
      and(
        eq(moneyOperations.id, id),
        inArray(moneyOperations.kind, [...OPERATION_FILE_KINDS]),
        scope,
      ),
    );
  if (!row) return null;
  return {
    contractor: {
      id: row.contractorId,
      responsibleEmployeeId: row.responsibleEmployeeId,
      archived: row.archived,
    },
    kind: row.kind as (typeof OPERATION_FILE_KINDS)[number],
    opDate: row.opDate,
    cancelled: row.cancelled,
    taxpay: row.taxpay,
  };
}
