import {
  blockingPayments,
  contractorMoney,
  correctionMinusLimit,
  deleteBlock,
  employeeAccount,
  formatSomWithUnit,
  localPhoneText,
  orgHeld,
  RecordNotFoundError,
  requisiteText,
  taxRequisiteChoices,
  type EmployeeAccount,
  type HeldOp,
  type IsoDate,
  type MoneyHolderKind,
  type MoneyOpKind,
  type Translate,
  type Tyiyn,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { bankNamesOf } from './fees';
import { writeHistory } from './history';
import { listEmployeeWallets, listOrgAccounts, type OrgAccountRecord } from './money';
import {
  availableOf,
  holderOf,
  lockMoneyContractor,
  moneyContractor,
  moneyReportsOf,
  reportLabel,
  syncPaymentState,
  MoneyRefusedError,
  type MoneyContractor,
} from './money-tax';
import { lockReport } from './reports';
import { phoneCodeList } from './staff';
import {
  auditLog,
  contractors,
  employees,
  feeAllocations,
  feePayments,
  moneyAllocations,
  moneyOperations,
  reports,
  reportTypes,
  roles,
} from './schema';

/*
 * Остаток контрагента и окно финансовой операции (задача 2.20; ТЗ «Отчеты для сдачи» → «Виртуальные
 * счета сотрудников» → «Остаток после оплаты», «Операции по счёту»; «Финансовые операции по
 * контрагентам» → «Окно оплаты», «Обратные записи», «Счёт организации»; прототип
 * modules/contractors.js `moneyOpDlg`, `restDlg`, modules/finance.js `xferDlg`, `corrDlg`, `orgHeld`,
 * modules/fin-op.js `opWin`, `opDelDlg`, `inBlock`, ui/status-scale.js `revBack`, modules/staff.js —
 * вкладка «Счёт»). Правила — @buhuchet/domain (money/ops.ts); здесь — что прочитать и что записать.
 * Контрагент блокируется до конца транзакции (`lockMoneyContractor`): два действия с его деньгами не считают
 * остаток одновременно. Права и область проверяет вызывающий — по заблокированному контрагенту.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Действующие операции контрагента для счетов (`orgHeld`, `employeeAccount`). */
async function heldOpsOf(tx: Tx, contractorId: string): Promise<HeldOp[]> {
  const rows = await tx
    .select({
      kind: moneyOperations.kind,
      amount: moneyOperations.amount,
      holderKind: moneyOperations.holderKind,
      holderEmployeeId: moneyOperations.holderEmployeeId,
      self: moneyOperations.self,
    })
    .from(moneyOperations)
    .where(and(eq(moneyOperations.contractorId, contractorId), isNull(moneyOperations.cancelledAt)))
    .orderBy(asc(moneyOperations.createdAt), asc(moneyOperations.id));
  return rows.map((o) => ({ ...o, amount: Number(o.amount) }));
}

/** Деньги контрагента на счёте организации (прототип `orgHeld`). */
export async function orgHeldOf(tx: Tx, contractorId: string): Promise<Tyiyn> {
  return orgHeld(await heldOpsOf(tx, contractorId));
}

/** Деньги контрагента: на счетах, свободный остаток после всех неоплаченных налогов, на счёте организации. */
export interface ContractorFunds {
  available: Tyiyn;
  free: Tyiyn;
  orgHeld: Tyiyn;
}

export async function contractorFunds(tx: Tx, contractorId: string): Promise<ContractorFunds> {
  const [available, list, held] = await Promise.all([
    availableOf(tx, contractorId),
    moneyReportsOf(tx, contractorId),
    orgHeldOf(tx, contractorId),
  ]);
  return { available, free: contractorMoney(available, list).free, orgHeld: held };
}

/** Сотрудник, на счёт которого можно перевести деньги (прототип xferDlg: активный, не владелец). */
export interface TransferTarget {
  id: string;
  fullName: string;
  shortName: string;
}

/** «Кому» перевода: активные сотрудники организации, кроме владельца (прототип xferDlg, `opEditDlg`). */
export async function transferTargets(tx: Tx): Promise<TransferTarget[]> {
  return tx
    .select({ id: employees.id, fullName: employees.fullName, shortName: employees.shortName })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(and(eq(employees.active, true), eq(roles.isOwner, false)))
    .orderBy(asc(employees.fullName), asc(employees.id));
}

/** Ввод «Списать в бонус» и «Вернуть остаток» (прототип moneyOpDlg). */
export interface WriteOffInput {
  kind: 'bonus' | 'refund';
  amount: Tyiyn;
  date: IsoDate;
  /** «Причина» списания, «Комментарий» возврата. */
  note: string;
}

/**
 * «Списать в бонус» и «Вернуть остаток» (ТЗ «Остаток после оплаты»; прототип moneyOpDlg): сумма больше 0
 * и не больше свободного остатка — денег контрагента сверх всех неоплаченных налогов; дата не позже
 * сегодня (как в окне изменения операции, docs/deviations.md п. В-21). Деньги уходят со счёта, где они
 * лежат: у контрагента, который переводит деньги ответственному, — с его счёта. Остаток на счёте
 * организации в бонус не списывается (прототип: кнопки «Списать в бонус» у такого контрагента нет).
 * Контрагент уже заблокирован (`lockMoneyContractor`), право и архив проверил вызывающий.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-21
export async function writeOff(
  tx: Tx,
  c: MoneyContractor,
  input: WriteOffInput,
  ctx: { today: IsoDate },
): Promise<{ id: string }> {
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  const holder = holderOf(c, false);
  if (input.kind === 'bonus' && holder.holderKind !== 'employee') {
    throw new MoneyRefusedError('writeoff_org');
  }
  const { free } = await contractorFunds(tx, c.id);
  if (input.amount > free) {
    throw new MoneyRefusedError('writeoff_free_over', 400, 'amount', {
      amount: formatSomWithUnit(Math.max(0, free)),
    });
  }
  const note = input.note.trim();
  const [op] = await tx
    .insert(moneyOperations)
    .values({
      contractorId: c.id,
      kind: input.kind,
      amount: input.amount,
      opDate: input.date,
      ...holder,
      note,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: moneyOperations.id });
  await writeHistory(tx, {
    entity: 'money_operation',
    entityId: op!.id,
    action: 'create',
    changes: [
      { field: 'kind', to: input.kind },
      { field: 'amount', to: input.amount },
      { field: 'opDate', to: input.date },
      ...(note ? [{ field: 'note', to: note }] : []),
    ],
    contractorId: c.id,
  });
  return { id: op!.id };
}

/** Ввод «Перевод на счёт сотрудника» (прототип xferDlg). */
export interface TransferInput {
  to: string;
  amount: Tyiyn;
  date: IsoDate;
  note: string;
}

/**
 * «Перевод» (ТЗ «Счёт организации»; прототип xferDlg): деньги контрагента со счёта организации — на счёт
 * сотрудника, который оплачивает его налоги; остаток контрагента не меняется. Можно, когда у контрагента
 * есть ответственный, а на счёте организации — его деньги; сумма — не больше этих денег и не больше
 * денег контрагента на счетах; «Кому» — активный сотрудник, не владелец; дата не позже сегодня.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-21
export async function transferToEmployee(
  tx: Tx,
  c: MoneyContractor,
  input: TransferInput,
  ctx: { today: IsoDate; t: Translate },
): Promise<{ id: string }> {
  if (c.archived) throw new MoneyRefusedError('contractor_archived');
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  const { available, orgHeld: held } = await contractorFunds(tx, c.id);
  const max = Math.min(held, available);
  if (!c.responsibleEmployeeId || max <= 0) throw new MoneyRefusedError('xfer_not_allowed');
  if (input.amount > max) throw new MoneyRefusedError('xfer_over', 400, 'amount');
  const to = UUID.test(input.to)
    ? (await transferTargets(tx)).find((e) => e.id === input.to)
    : undefined;
  if (!to) throw new MoneyRefusedError('xfer_to_invalid', 400, 'to');
  const note = input.note.trim();
  const [op] = await tx
    .insert(moneyOperations)
    .values({
      contractorId: c.id,
      kind: 'xfer',
      amount: input.amount,
      opDate: input.date,
      holderKind: 'employee',
      holderEmployeeId: to.id,
      note,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: moneyOperations.id });
  await writeHistory(tx, {
    entity: 'money_operation',
    entityId: op!.id,
    action: 'create',
    changes: [
      { field: 'kind', to: 'xfer' },
      { field: 'amount', to: input.amount },
      { field: 'opDate', to: input.date },
      { field: 'holder', to: to.shortName },
      ...(note ? [{ field: 'note', to: note }] : []),
    ],
    contractorId: c.id,
  });
  return { id: op!.id };
}

type MoneyOperationRecord = typeof moneyOperations.$inferSelect;

/** Операция, заблокированная вместе со своим контрагентом. */
export interface LockedOperation {
  op: MoneyOperationRecord;
  c: MoneyContractor;
}

/**
 * Операция по счёту контрагента в области `scope` (группа «Финансовые операции»): сначала контрагент,
 * потом сама операция — в том же порядке, что поступление и оплата. Нет такой или контрагент вне
 * области — `RecordNotFoundError`.
 */
export async function lockOperation(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<LockedOperation> {
  if (!UUID.test(id)) throw new RecordNotFoundError('money_operation', id);
  const [row] = await tx
    .select({ contractorId: moneyOperations.contractorId })
    .from(moneyOperations)
    .where(eq(moneyOperations.id, id));
  if (!row) throw new RecordNotFoundError('money_operation', id);
  let c: MoneyContractor;
  try {
    c = await lockMoneyContractor(tx, row.contractorId, scope);
  } catch (e) {
    if (e instanceof RecordNotFoundError) throw new RecordNotFoundError('money_operation', id);
    throw e;
  }
  const [op] = await tx
    .select()
    .from(moneyOperations)
    .where(eq(moneyOperations.id, id))
    .for('no key update');
  if (!op) throw new RecordNotFoundError('money_operation', id);
  return { op, c };
}

/** Сумма обратных записей к поступлению (прототип `corrOf`). */
async function correctionsSum(tx: Tx, receiptId: string): Promise<Tyiyn> {
  const [row] = await tx
    .select({ s: sql<number>`coalesce(sum(${moneyOperations.amount}), 0)`.mapWith(Number) })
    .from(moneyOperations)
    .where(
      and(
        eq(moneyOperations.refOperationId, receiptId),
        eq(moneyOperations.kind, 'corr'),
        isNull(moneyOperations.cancelledAt),
      ),
    );
  return row?.s ?? 0;
}

/** Ввод «Обратная запись к поступлению» (прототип corrDlg). */
export interface CorrectionInput {
  /** «Уменьшить: поступило меньше» или «Увеличить: поступило больше». */
  sign: '-' | '+';
  amount: Tyiyn;
  date: IsoDate;
  reason: string;
}

/**
 * «Обратная запись» к поступлению (ТЗ «Обратные записи»; прототип corrDlg): отдельная операция с
 * причиной; поступление и оплаты налогов не меняются, остаток пересчитывается. «Уменьшить» — не больше
 * денег контрагента на счетах и не больше самого поступления с его обратными записями. Счёт — тот же,
 * что у поступления. В истории поступления — запись об обратной записи (её видно в окне поступления).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-21
export async function correctReceipt(
  tx: Tx,
  { op, c }: LockedOperation,
  input: CorrectionInput,
  ctx: { today: IsoDate },
): Promise<{ id: string }> {
  if (op.kind !== 'in') throw new RecordNotFoundError('money_operation', op.id);
  if (op.cancelledAt) throw new MoneyRefusedError('op_deleted');
  if (c.archived) throw new MoneyRefusedError('op_archived');
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  if (input.sign === '-') {
    const [available, corr] = await Promise.all([availableOf(tx, c.id), correctionsSum(tx, op.id)]);
    const limit = correctionMinusLimit(available, Number(op.amount), corr);
    if (input.amount > limit) {
      throw new MoneyRefusedError('correction_minus_over', 400, 'amount', {
        amount: formatSomWithUnit(limit),
      });
    }
  }
  const amount = input.sign === '-' ? -input.amount : input.amount;
  const reason = input.reason.trim();
  const [corr] = await tx
    .insert(moneyOperations)
    .values({
      contractorId: c.id,
      kind: 'corr',
      amount,
      opDate: input.date,
      holderKind: op.holderKind,
      holderEmployeeId: op.holderEmployeeId,
      refOperationId: op.id,
      note: reason,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: moneyOperations.id });
  await writeHistory(
    tx,
    {
      entity: 'money_operation',
      entityId: corr!.id,
      action: 'create',
      changes: [
        { field: 'kind', to: 'corr' },
        { field: 'amount', to: amount },
        { field: 'opDate', to: input.date },
        { field: 'receipt', to: op.opDate },
      ],
      reason,
      contractorId: c.id,
    },
    // В окне поступления — «Обратная запись ±X: причина»; в истории контрагента она уже есть выше.
    {
      entity: 'money_operation',
      entityId: op.id,
      action: 'update',
      changes: [{ field: 'correction', to: amount }],
      reason,
    },
  );
  return { id: corr!.id };
}

/** Оплата налога, которая мешает удалить поступление (прототип `inBlock`). */
export interface BlockingPaymentRow {
  id: string;
  reportId: string;
  report: string;
  date: IsoDate;
  amount: Tyiyn;
}

/** Почему удалить нельзя: деньги уже потрачены на налоги (прототип opDelDlg, `blk`, `neg`). */
export interface DeleteBlock {
  code: 'receipt_spent' | 'correction_spent';
  available: Tyiyn;
  amount: Tyiyn;
  /** У поступления — оплаты, которые сначала изменяют или удаляют (не больше 8). */
  payments: BlockingPaymentRow[];
}

/**
 * Удалить нельзя (прототип opDelDlg): поступление, деньги которого уже потрачены на налоги, — с
 * таблицей оплат: сначала по отчётам из его детализации, потом от новых к старым; обратную запись «+»,
 * если её деньги потрачены. null — можно.
 */
export async function operationDeleteBlock(
  tx: Tx,
  op: MoneyOperationRecord,
  t: Translate,
): Promise<DeleteBlock | null> {
  if (op.cancelledAt || (op.kind !== 'in' && op.kind !== 'corr')) return null;
  const available = await availableOf(tx, op.contractorId);
  const amount = Number(op.amount);
  const code = deleteBlock(op.kind, amount, available);
  if (!code) return null;
  if (code === 'correction_spent') return { code, available, amount, payments: [] };
  const [pays, allocs] = await Promise.all([
    tx
      .select({
        id: moneyOperations.id,
        reportId: moneyOperations.reportId,
        date: moneyOperations.opDate,
        amount: moneyOperations.amount,
        createdAt: moneyOperations.createdAt,
        typeShort: reportTypes.shortName,
        period: reports.period,
        periodStart: reports.periodStart,
        eventDate: reports.eventDate,
      })
      .from(moneyOperations)
      .innerJoin(reports, eq(reports.id, moneyOperations.reportId))
      .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
      .where(
        and(
          eq(moneyOperations.contractorId, op.contractorId),
          eq(moneyOperations.kind, 'pay'),
          isNull(moneyOperations.cancelledAt),
        ),
      ),
    tx
      .select({ reportId: moneyAllocations.reportId })
      .from(moneyAllocations)
      .where(eq(moneyAllocations.operationId, op.id)),
  ]);
  const list = blockingPayments(
    pays.map((p) => ({
      ...p,
      reportId: p.reportId!,
      amount: Number(p.amount),
      createdAt: p.createdAt.getTime(),
    })),
    new Set(allocs.map((a) => a.reportId)),
  );
  return {
    code,
    available,
    amount,
    payments: list.map((p) => ({
      id: p.id,
      reportId: p.reportId,
      report: reportLabel(p, t),
      date: p.date,
      amount: p.amount,
    })),
  };
}

/**
 * «Удалить», «Отменить списание», «Отменить возврат» (ТЗ «Окно оплаты»; прототип opDelDlg): операция не
 * стирается — получает отметку отмены с автором, временем и причиной и уходит из сумм, сверок и итогов.
 * Оплата налога — «Оплачено в бюджет» отчёта уменьшается, статус оплаты пересчитывается; поступление —
 * оплаты за обслуживание из него тоже удаляются. Возврат по уточнённому расчёту создала система — его
 * не удаляют; потраченное поступление и обратную запись «+» — тоже (`operationDeleteBlock`). Оплату
 * прежней версии отчёта не удаляют, как и не откатывают (docs/deviations.md п. В-20). Права, архив и
 * закрытый месяц (`opLock`) проверяет вызывающий.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-20
export async function deleteOperation(
  tx: Tx,
  { op, c }: LockedOperation,
  reason: string,
  ctx: { scope: SQL | undefined; t: Translate },
): Promise<void> {
  if (op.cancelledAt) throw new MoneyRefusedError('op_deleted');
  if (op.kind === 'back') throw new MoneyRefusedError('op_system');
  const block = await operationDeleteBlock(tx, op, ctx.t);
  if (block) {
    throw new MoneyRefusedError(block.code, 409, undefined, {
      available: formatSomWithUnit(block.available),
      amount: formatSomWithUnit(block.amount),
    });
  }
  const why = reason.trim();
  const amount = Number(op.amount);
  let report: Awaited<ReturnType<typeof lockReport>> | null = null;
  if (op.kind === 'pay' && op.reportId) {
    report = await lockReport(tx, op.reportId, ctx.scope);
    if (report.superseded) throw new MoneyRefusedError('payment_superseded');
  }
  await tx
    .update(moneyOperations)
    .set({
      cancelledAt: sql`now()`,
      cancelledBy: sql`app.current_user_id()`,
      cancelReason: why,
      version: sql`${moneyOperations.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(moneyOperations.id, op.id));
  const fee =
    op.kind === 'in'
      ? await tx
          .update(feePayments)
          .set({
            deletedAt: sql`now()`,
            deletedBy: sql`app.current_user_id()`,
            deleteReason: why,
            version: sql`${feePayments.version} + 1`,
            updatedAt: sql`now()`,
            updatedBy: sql`app.current_user_id()`,
          })
          .where(and(eq(feePayments.operationId, op.id), isNull(feePayments.deletedAt)))
          .returning({ id: feePayments.id, amount: feePayments.amount })
      : [];
  const entries: Parameters<typeof writeHistory>[1][] = [
    {
      entity: 'money_operation',
      entityId: op.id,
      action: 'delete',
      changes: [
        { field: 'kind', from: op.kind },
        {
          field: 'amount',
          from: op.kind === 'in' ? Number(op.total ?? amount) - feeOf(fee) : amount,
        },
        { field: 'opDate', from: op.opDate },
        ...(fee.length ? [{ field: 'feeTotal', from: feeOf(fee) }] : []),
      ],
      reason: why,
      contractorId: c.id,
    },
    // Оплаты за обслуживание из поступления — в их окне: «Удалена вместе с поступлением».
    ...fee.map((f) => ({
      entity: 'fee_payment' as const,
      entityId: f.id,
      action: 'delete' as const,
      changes: [{ field: 'receipt', from: op.opDate }],
      reason: why,
    })),
  ];
  if (report) {
    const paid = Number(report.paid);
    const next = Math.max(0, paid - amount);
    await tx
      .update(reports)
      .set({
        paid: next,
        version: sql`${reports.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(reports.id, report.id));
    await syncPaymentState(tx, report.id);
    entries.push({
      entity: 'report',
      entityId: report.id,
      action: 'update',
      changes: [
        { field: 'paymentCancel', from: { amount, date: op.opDate } },
        { field: 'paid', from: paid, to: next },
      ],
      reason: why,
      contractorId: c.id,
    });
  }
  await writeHistory(tx, ...entries);
}

const feeOf = (rows: readonly { amount: string | number }[]) =>
  rows.reduce((a, r) => a + Number(r.amount), 0);

/**
 * Возврат по уточнённому расчёту (ТЗ «Возврат по уточнённому расчёту: создаётся системой, когда
 * уточнённый отчёт уменьшил уже оплаченный налог»; прототип `revBack`): уточнённая версия получила «Сдан»,
 * а по ней оплачено больше новой суммы — разница возвращается в остаток контрагента операцией «Возврат по
 * уточнённому» (на счёт, куда он переводит деньги), «Оплачено в бюджет» становится равным сумме. Вызывает
 * сдача отчёта в той же транзакции; контрагента не блокирует — операция только добавляет деньги.
 */
export async function revisionRefund(
  tx: Tx,
  r: typeof reports.$inferSelect,
  date: IsoDate,
): Promise<typeof reports.$inferSelect> {
  const sum = r.amount === null ? 0 : Number(r.amount);
  const paid = Number(r.paid);
  if (!(r.revision > 0 && paid > sum)) return r;
  const diff = paid - sum;
  const [c] = await tx
    .select({
      paysTo: contractors.paysTo,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
    })
    .from(contractors)
    .where(eq(contractors.id, r.contractorId));
  const toOrg = !c || c.paysTo === 'org' || !c.responsibleEmployeeId;
  const holder: { holderKind: MoneyHolderKind; holderEmployeeId: string | null } = toOrg
    ? { holderKind: 'org', holderEmployeeId: null }
    : { holderKind: 'employee', holderEmployeeId: c.responsibleEmployeeId };
  await tx.insert(moneyOperations).values({
    contractorId: r.contractorId,
    kind: 'back',
    amount: diff,
    opDate: date,
    reportId: r.id,
    ...holder,
    createdBy: sql`app.current_user_id()`,
    updatedBy: sql`app.current_user_id()`,
  });
  const [updated] = await tx
    .update(reports)
    .set({ paid: sum })
    .where(eq(reports.id, r.id))
    .returning();
  await syncPaymentState(tx, r.id);
  await writeHistory(tx, {
    entity: 'report',
    entityId: r.id,
    action: 'update',
    changes: [
      { field: 'revisionRefund', to: { amount: diff, revision: r.revision } },
      { field: 'paid', from: paid, to: sum },
    ],
    contractorId: r.contractorId,
  });
  return updated!;
}

/** Строка «Детализация» поступления. */
export interface OperationAllocation {
  reportId: string;
  report: string;
  amount: Tyiyn;
}

/** Обратная запись в окне поступления. */
export interface OperationCorrection {
  id: string;
  date: IsoDate;
  note: string;
  author: string | null;
  amount: Tyiyn;
  deleted: boolean;
}

/** Окно финансовой операции (прототип `opWin`, `opView`). */
export interface OperationCard {
  op: MoneyOperationRecord;
  contractor: MoneyContractor;
  /** Отчёт оплаты и возврата по уточнённому: подпись и номер версии. */
  report: { id: string; label: string; revision: number } | null;
  holderName: string | null;
  allocations: OperationAllocation[];
  /** Часть за обслуживание по месяцам (у поступления; удалённые — вместе с удалённым поступлением). */
  fee: { month: YearMonth; amount: Tyiyn }[];
  /** Обратная запись — к какому поступлению. */
  receipt: { id: string; date: IsoDate; total: Tyiyn; amount: Tyiyn } | null;
  corrections: OperationCorrection[];
  createdName: string | null;
  updatedName: string | null;
  cancelledName: string | null;
  deleteBlock: DeleteBlock | null;
  history: {
    id: number;
    at: Date;
    actorName: string | null;
    action: string;
    changes: unknown;
    reason: string | null;
  }[];
}

const holderEmp = alias(employees, 'fin_holder');
const createdEmp = alias(employees, 'fin_created');
const updatedEmp = alias(employees, 'fin_updated');
const cancelledEmp = alias(employees, 'fin_cancelled');
const histActor = alias(employees, 'fin_hist_actor');

/**
 * Окно операции в области `scope`: поля, как их вводили, детализация и часть за обслуживание,
 * обратные записи, кто создал и изменил, отметка удаления, почему удалить нельзя и история; null — нет
 * такой или контрагент вне области.
 */
export async function operationCard(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
  t: Translate,
): Promise<OperationCard | null> {
  if (!UUID.test(id)) return null;
  const [row] = await tx
    .select({
      op: moneyOperations,
      holderName: holderEmp.shortName,
      createdName: createdEmp.shortName,
      updatedName: updatedEmp.shortName,
      cancelledName: cancelledEmp.shortName,
    })
    .from(moneyOperations)
    .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
    .leftJoin(holderEmp, eq(holderEmp.id, moneyOperations.holderEmployeeId))
    .leftJoin(createdEmp, eq(createdEmp.userId, moneyOperations.createdBy))
    .leftJoin(updatedEmp, eq(updatedEmp.userId, moneyOperations.updatedBy))
    .leftJoin(cancelledEmp, eq(cancelledEmp.userId, moneyOperations.cancelledBy))
    .where(and(eq(moneyOperations.id, id), scope));
  if (!row) return null;
  const { op } = row;
  const contractor = (await moneyContractor(tx, op.contractorId, scope))!;
  const [report, allocations, fee, receipt, corrections, history, block] = await Promise.all([
    op.reportId ? reportOf(tx, op.reportId, t) : null,
    op.kind === 'in' ? allocationsOf(tx, op.id, t) : [],
    op.kind === 'in' ? feePartsOf(tx, op.id, !!op.cancelledAt) : [],
    op.refOperationId ? receiptOf(tx, op.refOperationId) : null,
    op.kind === 'in' ? correctionsOf(tx, op.id) : [],
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: histActor.shortName,
        action: auditLog.action,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(histActor, eq(histActor.userId, auditLog.actorUserId))
      .where(and(eq(auditLog.entity, 'money_operation'), eq(auditLog.entityId, op.id)))
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
    operationDeleteBlock(tx, op, t),
  ]);
  return {
    op,
    contractor,
    report,
    holderName: row.holderName,
    allocations,
    fee,
    receipt,
    corrections,
    createdName: row.createdName,
    updatedName: row.updatedName,
    cancelledName: row.cancelledName,
    deleteBlock: block,
    history,
  };
}

async function reportOf(tx: Tx, id: string, t: Translate) {
  const [r] = await tx
    .select({
      id: reports.id,
      revision: reports.revision,
      typeShort: reportTypes.shortName,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
    })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(eq(reports.id, id));
  return r ? { id: r.id, label: reportLabel(r, t), revision: r.revision } : null;
}

async function allocationsOf(tx: Tx, operationId: string, t: Translate) {
  const rows = await tx
    .select({
      reportId: moneyAllocations.reportId,
      amount: moneyAllocations.amount,
      typeShort: reportTypes.shortName,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
    })
    .from(moneyAllocations)
    .innerJoin(reports, eq(reports.id, moneyAllocations.reportId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(eq(moneyAllocations.operationId, operationId))
    .orderBy(asc(reports.payDue), asc(reports.id));
  return rows.map((r) => ({
    reportId: r.reportId,
    report: reportLabel(r, t),
    amount: Number(r.amount),
  }));
}

/** Части за обслуживание поступления; у удалённого поступления — удалённые вместе с ним. */
async function feePartsOf(tx: Tx, operationId: string, withDeleted: boolean) {
  const rows = await tx
    .select({ month: feeAllocations.month, amount: feeAllocations.amount })
    .from(feePayments)
    .innerJoin(feeAllocations, eq(feeAllocations.paymentId, feePayments.id))
    .where(
      and(
        eq(feePayments.operationId, operationId),
        withDeleted ? undefined : isNull(feePayments.deletedAt),
      ),
    )
    .orderBy(asc(feeAllocations.month));
  return rows.map((r) => ({ month: r.month.slice(0, 7) as YearMonth, amount: Number(r.amount) }));
}

async function receiptOf(tx: Tx, id: string) {
  const [r] = await tx
    .select({
      id: moneyOperations.id,
      date: moneyOperations.opDate,
      total: moneyOperations.total,
      amount: moneyOperations.amount,
    })
    .from(moneyOperations)
    .where(eq(moneyOperations.id, id));
  return r
    ? { id: r.id, date: r.date, total: Number(r.total ?? r.amount), amount: Number(r.amount) }
    : null;
}

const corrAuthor = alias(employees, 'fin_corr_author');

async function correctionsOf(tx: Tx, receiptId: string): Promise<OperationCorrection[]> {
  const rows = await tx
    .select({
      id: moneyOperations.id,
      date: moneyOperations.opDate,
      note: moneyOperations.note,
      author: corrAuthor.shortName,
      amount: moneyOperations.amount,
      cancelledAt: moneyOperations.cancelledAt,
    })
    .from(moneyOperations)
    .leftJoin(corrAuthor, eq(corrAuthor.userId, moneyOperations.createdBy))
    .where(and(eq(moneyOperations.refOperationId, receiptId), eq(moneyOperations.kind, 'corr')))
    .orderBy(asc(moneyOperations.opDate), asc(moneyOperations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    note: r.note,
    author: r.author,
    amount: Number(r.amount),
    deleted: !!r.cancelledAt,
  }));
}

/** Контрагент строки вкладки «Счёт». */
export interface AccountContractor {
  id: string;
  name: string;
}

/**
 * Виртуальный счёт сотрудника (ТЗ «Сотрудники» → вкладка «Счёт»; прототип staff.js, вкладка `acc`):
 * действующие операции на его счёте по контрагентам в области `scope` (группа «Финансовые операции»,
 * docs/deviations.md п. В-22) — баланс, поступления, оплаты налогов, бонусы и строки по контрагентам в
 * порядке, в котором контрагентов завели (docs/deviations.md п. В-24).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-22
// ОТКЛОНЕНИЕ: docs/deviations.md#В-24
export async function employeeAccountOf(
  tx: Tx,
  employeeId: string,
  scope: SQL | undefined,
): Promise<{ account: EmployeeAccount; contractors: AccountContractor[] }> {
  if (!UUID.test(employeeId)) return { account: employeeAccount([], ''), contractors: [] };
  const rows = await tx
    .select({
      contractorId: moneyOperations.contractorId,
      name: contractors.name,
      kind: moneyOperations.kind,
      amount: moneyOperations.amount,
      holderKind: moneyOperations.holderKind,
      holderEmployeeId: moneyOperations.holderEmployeeId,
    })
    .from(moneyOperations)
    .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
    .where(
      and(
        eq(moneyOperations.holderEmployeeId, employeeId),
        isNull(moneyOperations.cancelledAt),
        scope,
      ),
    )
    // Строки — по порядку, в котором контрагентов завели (прототип: `Object.entries(byCp)` с номерами
    // контрагентов по возрастанию).
    .orderBy(asc(contractors.createdAt), asc(contractors.id), asc(moneyOperations.createdAt));
  const names = new Map(rows.map((r) => [r.contractorId, r.name]));
  const account = employeeAccount(
    rows.map((r) => ({ ...r, kind: r.kind as MoneyOpKind, amount: Number(r.amount) })),
    employeeId,
  );
  return {
    account,
    contractors: account.rows.map((x) => ({
      id: x.contractorId,
      name: names.get(x.contractorId)!,
    })),
  };
}

/** Остаток архивного контрагента (прототип restDlg): где деньги и сколько свободно. */
export interface ArchiveRest {
  id: string;
  name: string;
  paysTo: 'emp' | 'org';
  /** Ответственный, у которого деньги; null — деньги на счёте организации. */
  holder: string | null;
  free: Tyiyn;
}

/**
 * Свободный остаток контрагентов после архивирования (прототип archiveDlg: `c.free > 0`) — по
 * контрагентам в области `scope` (группа «Финансовые операции»), в порядке `ids`. Сначала одним
 * запросом — у кого деньги на счетах вообще есть, затем свободный остаток только у них.
 */
export async function archiveRestOf(
  tx: Tx,
  ids: readonly string[],
  scope: SQL | undefined,
): Promise<ArchiveRest[]> {
  const list = ids.filter((id) => UUID.test(id));
  if (!list.length) return [];
  const rows = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      paysTo: contractors.paysTo,
      holder: restHolder.shortName,
      avail:
        sql<number>`coalesce(sum(case when ${moneyOperations.kind} in ('in', 'back', 'corr') then ${moneyOperations.amount} else -${moneyOperations.amount} end) filter (where ${moneyOperations.kind} <> 'xfer' and not ${moneyOperations.self} and ${moneyOperations.cancelledAt} is null), 0)`.mapWith(
          Number,
        ),
    })
    .from(contractors)
    .leftJoin(restHolder, eq(restHolder.id, contractors.responsibleEmployeeId))
    .leftJoin(moneyOperations, eq(moneyOperations.contractorId, contractors.id))
    .where(and(inArray(contractors.id, list), scope))
    .groupBy(contractors.id, restHolder.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ArchiveRest[] = [];
  for (const id of list) {
    const r = byId.get(id);
    if (!r || r.avail <= 0) continue;
    const free = contractorMoney(r.avail, await moneyReportsOf(tx, id)).free;
    if (free <= 0) continue;
    out.push({
      id,
      name: r.name,
      paysTo: r.paysTo,
      holder: r.paysTo === 'emp' ? r.holder : null,
      free,
    });
  }
  return out;
}

const restHolder = alias(employees, 'rest_holder');

/** Реквизит в окне «Напомнить в WhatsApp»: строка для сообщения и поля для отметок. */
export interface TaxReminderRequisite {
  id: string;
  text: string;
  bank: string;
  number: string;
  phone: boolean;
  holder: string;
  main: boolean;
}

/** Что нужно окну «Напомнить в WhatsApp» по отчёту (прототип waDlg с `r`). */
export interface TaxReminderSource {
  report: {
    id: string;
    contractorId: string;
    act: (typeof reports.$inferSelect)['act'];
    status: (typeof reports.$inferSelect)['status'];
    superseded: boolean;
    period: (typeof reports.$inferSelect)['period'];
    periodStart: IsoDate;
    dueDate: IsoDate;
    payDue: IsoDate | null;
    amount: Tyiyn | null;
    paid: Tyiyn;
    typeName: string;
    /** Разовый отчёт: дата события и её подпись в справочнике (пусто — «Дата события»). */
    eventDate: IsoDate | null;
    eventLabel: string;
  };
  contractor: {
    id: string;
    name: string;
    phone: string;
    paysTo: 'emp' | 'org';
  };
  /** Ответственный — чьи реквизиты у контрагента, который переводит деньги ему. */
  holder: { id: string; name: string; userId: string | null } | null;
  requisites: TaxReminderRequisite[];
}

const remindHolder = alias(employees, 'remind_holder');

/**
 * Отчёт в области `scope` (через контрагента) и куда контрагенту переводить деньги на налог (прототип
 * waDlg): счета организации для налогов — у того, кто переводит на счёт организации; реквизиты
 * ответственного — у того, кто переводит ему; основной отмечен (`taxRequisiteChoices`). null — отчёта нет.
 */
export async function taxReminderSource(
  tx: Tx,
  reportId: string,
  scope: SQL | undefined,
  t: Translate,
): Promise<TaxReminderSource | null> {
  if (!UUID.test(reportId)) return null;
  const [row] = await tx
    .select({
      r: {
        id: reports.id,
        contractorId: reports.contractorId,
        act: reports.act,
        status: reports.status,
        superseded: reports.superseded,
        period: reports.period,
        periodStart: reports.periodStart,
        dueDate: reports.dueDate,
        payDue: reports.payDue,
        amount: reports.amount,
        paid: reports.paid,
        typeName: reportTypes.name,
        eventDate: reports.eventDate,
        eventLabel: reportTypes.eventLabel,
      },
      c: {
        id: contractors.id,
        name: contractors.name,
        phone: contractors.phone,
        paysTo: contractors.paysTo,
      },
      holderId: remindHolder.id,
      holderName: remindHolder.shortName,
      holderUser: remindHolder.userId,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .leftJoin(remindHolder, eq(remindHolder.id, contractors.responsibleEmployeeId))
    .where(and(eq(reports.id, reportId), scope));
  if (!row) return null;
  const holder =
    row.c.paysTo === 'emp' && row.holderId
      ? { id: row.holderId, name: row.holderName!, userId: row.holderUser }
      : null;
  const [accounts, wallets, codes] = await Promise.all([
    row.c.paysTo === 'org' ? listOrgAccounts(tx) : Promise.resolve([]),
    holder ? listEmployeeWallets(tx, holder.id) : Promise.resolve([]),
    phoneCodeList(tx),
  ]);
  const choices = taxRequisiteChoices<RequisiteRow, RequisiteRow>(
    row.c.paysTo,
    accounts.map((a) => ({ ...a, isMain: false })),
    wallets.map((w) => ({
      ...w,
      bik: null,
      purpose: 'tax' as const,
      mainTax: false,
      mainFee: false,
    })),
  );
  const names = await bankNamesOf(
    tx,
    choices.flatMap(({ requisite: a }) =>
      a.kind === 'phone' ? a.phoneBanks : a.bankCode ? [a.bankCode] : [],
    ),
  );
  const owner = row.c.paysTo === 'org' ? 'org' : 'employee';
  return {
    report: {
      ...row.r,
      amount: row.r.amount === null ? null : Number(row.r.amount),
      paid: Number(row.r.paid),
    },
    contractor: row.c,
    holder,
    requisites: choices.map(({ requisite: a, main }) => {
      const bankNames =
        a.kind === 'phone'
          ? a.phoneBanks.map((c) => names.get(c) ?? c)
          : [a.bankCode ? (names.get(a.bankCode) ?? a.bankCode) : ''];
      const phoneText = a.phone ? localPhoneText(a.phone, codes) : '';
      return {
        id: a.id,
        text: requisiteText(
          {
            kind: a.kind,
            bankNames,
            accountNo: a.accountNo,
            bik: a.bik,
            phoneText,
            holderName: a.holderName,
          },
          owner,
          t,
        ),
        bank: bankNames.join(', '),
        number: a.kind === 'phone' ? phoneText : (a.accountNo ?? ''),
        phone: a.kind === 'phone',
        holder: a.holderName,
        main,
      };
    }),
  };
}

/** Счёт организации или реквизит сотрудника глазами окна напоминания. */
type RequisiteRow = OrgAccountRecord & { isMain: boolean };

/** «Открыть WhatsApp» с напоминанием о налоге (прототип: «Напоминание в WhatsApp отправлено контрагенту»). */
export async function logTaxReminder(
  tx: Tx,
  reportId: string,
  contractorId: string,
): Promise<void> {
  await writeHistory(tx, {
    entity: 'report',
    entityId: reportId,
    action: 'remind',
    changes: [{ field: 'taxReminder' }],
    contractorId,
  });
}
