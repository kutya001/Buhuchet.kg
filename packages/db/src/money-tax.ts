import {
  contractorMoney,
  hasTaxSum,
  MONEY_AMOUNT_MAX,
  monthReconciliation,
  payOnlyReportStatus,
  formatDateRu,
  formatSomWithUnit,
  paymentProblem,
  paymentShortage,
  paymentSchedule,
  paymentStatus,
  periodLabel,
  RecordChangedError,
  RecordNotFoundError,
  scheduleDues,
  schedulePayDue,
  type Allocation,
  type ContractorMoney,
  type IsoDate,
  type MoneyHolderKind,
  type MoneyMessageKey,
  type MoneyOpKind,
  type MonthReconciliation,
  type PaymentStatus,
  type ReportAct,
  type ReportFunds,
  type ReportPeriod,
  type SchedulePart,
  type TaxReport,
  type Translate,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import { insertReceiptFeePayments, receiptFeeLeft } from './fees';
import { calendarOf, lockReport, ReportChangedError } from './reports';
import {
  contractors,
  employees,
  feePayments,
  files,
  moneyAllocations,
  moneyOperations,
  orgSettings,
  reports,
  reportTypes,
  statusHistory,
} from './schema';

/*
 * Деньги по отчётам (задача 2.19; ТЗ «Отчеты для сдачи» → «Оплата налога», «Сдача после оплаты»,
 * «Виртуальные счета сотрудников» → «Операции по счёту», «Сверка денег по контрагенту»; прототип
 * core/derive.js, modules/contractors.js inDlg, ui/status-scale.js payDlg, rollbackDlg('pay')).
 * Правила — @buhuchet/domain (`contractorMoney`, `paymentProblem`, `paymentSchedule`); здесь — что
 * прочитать и что записать. Операция, «Оплачено в бюджет» отчёта и история пишутся в одной транзакции;
 * отчёт блокируется до конца транзакции, устаревшая версия — `ReportChangedError`.
 */

/**
 * Отказ денежного действия: код — `MONEY_MESSAGES`; 400 — неверный ввод, 409 — не сейчас. `params` —
 * подстановки текста (`{amount}`, `{date}`) и `variant` — вариант текста.
 */
export class MoneyRefusedError extends Error {
  constructor(
    readonly code: Exclude<MoneyMessageKey, `${string}.${string}` | 'taxpay_off'>,
    readonly status: 400 | 409 = 409,
    readonly field?: string,
    readonly params: Readonly<Record<string, string>> = {},
  ) {
    super(`money: ${code}`);
    this.name = 'MoneyRefusedError';
  }
}

/** Отчёт вида с суммой ждёт денег: сумма больше 0, не «Не требуется», не прежняя версия. */
const PENDING = sql`(${reports.act} <> 'sub' and ${reports.amount} > 0 and ${reports.status} <> 'not_required' and not ${reports.superseded})`;

/** Порядок отчётов в сверке: по сроку оплаты, при равном — постоянный (`moneyReportsOf`, `REPORT_MONEY`). */
const MONEY_ORDER = sql`coalesce(r.pay_due, r.due_date), r.due_date, r.period_start, r.report_type_code, r.revision, r.id`;

/**
 * Деньги отчётов для списка (прототип derive, решение заказчика 25.10.2026): подзапрос `rm` с полями
 * `id`, `self_paid`, `recv` (принято под отчёт детализацией), `reserved` (отложено именно под него),
 * `extra` (свободный остаток, пришедшийся на отчёт), `state` ('paid', 'enough', 'short'), `need`, `short`.
 * Та же сверка, что `contractorMoney` из @buhuchet/domain, но окнами SQL — по ней работают фильтр,
 * сортировка и итоги списка; тест сверяет их на случайных данных.
 */
export const REPORT_MONEY = sql`(with
  avail as (
    select o.contractor_id, coalesce(sum(case when o.kind in ('in', 'back', 'corr') then o.amount else -o.amount end) filter (where o.kind <> 'xfer' and not o.self), 0) as avail
    from ${moneyOperations} o where o.cancelled_at is null group by o.contractor_id
  ),
  recv as (
    select a.report_id, sum(a.amount) as recv
    from ${moneyAllocations} a join ${moneyOperations} o on o.id = a.operation_id
    where o.kind = 'in' and o.cancelled_at is null group by a.report_id
  ),
  selfp as (
    select o.report_id, sum(o.amount) as self_paid from ${moneyOperations} o
    where o.kind = 'pay' and o.self and o.cancelled_at is null group by o.report_id
  ),
  open as (
    select r.id, r.contractor_id, r.amount - r.paid as need, coalesce(av.avail, 0) as avail,
      greatest(0, least(r.amount - r.paid, coalesce(rv.recv, 0) - r.paid)) as x,
      row_number() over (partition by r.contractor_id order by ${MONEY_ORDER}) as ord
    from ${reports} r
    left join recv rv on rv.report_id = r.id
    left join avail av on av.contractor_id = r.contractor_id
    where r.act <> 'sub' and r.amount > 0 and r.status <> 'not_required' and not r.superseded and r.paid < r.amount
  ),
  s1 as (
    select *, coalesce(sum(x) over (partition by contractor_id order by ord rows between unbounded preceding and 1 preceding), 0) as cx,
      sum(x) over (partition by contractor_id) as cx_all
    from open
  ),
  s2 as (
    select *, greatest(0, least(x, avail - cx)) as reserved,
      avail - greatest(0, least(avail, cx_all)) as l
    from s1
  ),
  s3 as (
    select *, need - reserved as rest,
      coalesce(sum(need - reserved) over (partition by contractor_id order by ord rows between unbounded preceding and 1 preceding), 0) as rx
    from s2
  ),
  s4 as (
    select *, case when l < 0 then case when ord = 1 then l else 0 end else greatest(0, l - rx) end as lb
    from s3
  )
  select r.id, coalesce(sp.self_paid, 0) as self_paid, coalesce(rv.recv, 0) as recv,
    coalesce(s4.reserved, 0) as reserved,
    coalesce(least(s4.rest, greatest(0, s4.lb)), 0) as extra,
    case when s4.id is null then 'paid' when s4.lb >= s4.rest then 'enough' else 'short' end as state,
    s4.need, case when s4.lb < s4.rest then s4.rest - s4.lb end as short
  from ${reports} r
  left join s4 on s4.id = r.id
  left join selfp sp on sp.report_id = r.id
  left join recv rv on rv.report_id = r.id
  where r.act <> 'sub' and (s4.id is not null or sp.report_id is not null or rv.report_id is not null or (r.amount > 0 and r.status <> 'not_required' and not r.superseded))
) rm`;

/** Поле подзапроса `rm` (`REPORT_MONEY`). */
export const rmField = (name: string) => sql.raw(`"rm"."${name}"`);

/** «Получено от контрагента» строки списка: его деньги, оплаченные по отчёту, и отложенные под него. */
export const RECEIVED = sql<number>`case when ${reports.act} = 'sub' then 0 else greatest(0, ${reports.paid} - coalesce(${rmField('self_paid')}, 0)) + coalesce(${rmField('reserved')}, 0) + coalesce(${rmField('extra')}, 0) end`;

/** Сверка по отчёту (столбец «Деньги»): только у отчёта, который ждёт денег. */
export const FUNDS_STATE = sql<
  string | null
>`case when ${PENDING} then coalesce(${rmField('state')}, 'paid') end`;

/** Статус оплаты (прототип derive, payStatus) — шкала `payment`. */
export const PAYMENT_STATUS = sql<PaymentStatus>`case
  when ${reports.act} = 'sub' or ${reports.status} = 'not_required' then 'not_required'
  when ${reports.amount} is null then 'unpaid'
  when ${reports.amount} = 0 then 'not_required'
  when ${reports.paid} >= ${reports.amount} then 'paid'
  when ${reports.paid} > 0 then 'partial'
  else 'unpaid' end`;

/** Деньги контрагента на счетах (прототип c.avail) — `fundsBalance` в SQL. */
async function availableOf(tx: Tx, contractorId: string): Promise<Tyiyn> {
  const [row] = await tx
    .select({
      avail:
        sql<number>`coalesce(sum(case when ${moneyOperations.kind} in ('in', 'back', 'corr') then ${moneyOperations.amount} else -${moneyOperations.amount} end) filter (where ${moneyOperations.kind} <> 'xfer' and not ${moneyOperations.self}), 0)`.mapWith(
          Number,
        ),
    })
    .from(moneyOperations)
    .where(
      and(eq(moneyOperations.contractorId, contractorId), isNull(moneyOperations.cancelledAt)),
    );
  return row?.avail ?? 0;
}

/** Отчёт контрагента глазами денег: поля сверки и подписи для вкладки «Деньги». */
export interface MoneyReport extends TaxReport {
  contractorId: string;
  typeCode: string;
  typeShort: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate: IsoDate | null;
  dueDate: IsoDate;
}

/**
 * Отчёты контрагента для сверки денег (без прежних версий — у них сверки нет): оплачено, оплатил сам,
 * принято детализацией — в порядке сверки (`MONEY_ORDER`).
 */
export async function moneyReportsOf(tx: Tx, contractorId: string): Promise<MoneyReport[]> {
  const rows = await tx.execute<{
    id: string;
    contractor_id: string;
    act: ReportAct;
    status: string;
    amount: string | null;
    paid: string;
    self_paid: string;
    recv: string;
    pay_due: IsoDate | null;
    due_date: IsoDate;
    report_type_code: string;
    short_name: string;
    period: ReportPeriod;
    period_start: IsoDate;
    event_date: IsoDate | null;
  }>(sql`select r.id, r.contractor_id, r.act, r.status, r.amount, r.paid, r.pay_due, r.due_date,
      r.report_type_code, t.short_name, r.period, r.period_start, r.event_date,
      coalesce((select sum(o.amount) from ${moneyOperations} o where o.report_id = r.id and o.kind = 'pay' and o.self and o.cancelled_at is null), 0) as self_paid,
      coalesce((select sum(a.amount) from ${moneyAllocations} a join ${moneyOperations} o on o.id = a.operation_id where a.report_id = r.id and o.kind = 'in' and o.cancelled_at is null), 0) as recv
    from ${reports} r join ${reportTypes} t on t.code = r.report_type_code
    where r.contractor_id = ${contractorId} and not r.superseded
    order by ${MONEY_ORDER}`);
  return rows.map((r) => ({
    id: r.id,
    contractorId: r.contractor_id,
    act: r.act,
    status: r.status,
    sum: r.amount === null ? null : Number(r.amount),
    paid: Number(r.paid),
    selfPaid: Number(r.self_paid),
    received: Number(r.recv),
    superseded: false,
    payDue: r.pay_due ?? r.due_date,
    dueDate: r.due_date,
    typeCode: r.report_type_code,
    typeShort: r.short_name,
    period: r.period,
    periodStart: r.period_start,
    eventDate: r.event_date,
  }));
}

/** Сверка денег контрагента: деньги на счетах и распределение по его отчётам. */
export async function contractorMoneyOf(
  tx: Tx,
  contractorId: string,
): Promise<{ money: ContractorMoney; reports: MoneyReport[] }> {
  const [available, list] = await Promise.all([
    availableOf(tx, contractorId),
    moneyReportsOf(tx, contractorId),
  ]);
  return { money: contractorMoney(available, list), reports: list };
}

/** Контрагент для денежного действия: в области, куда переводит деньги, ответственный. */
interface MoneyContractor {
  id: string;
  name: string;
  paysTo: 'emp' | 'org';
  responsibleEmployeeId: string | null;
  responsibleName: string | null;
  archived: boolean;
  needReceiptFile: boolean;
  /** «Платит одной суммой»: налоги и обслуживание вместе (задача 2.21). */
  oneSum: boolean;
  /** Разовый контрагент: без платы за обслуживание. */
  oneOff: boolean;
  version: number;
}

const respEmployee = alias(employees, 'money_resp');

/** Контрагент в области `scope` (группа «Финансовые операции»); null — нет или не виден. */
export async function moneyContractor(
  tx: Tx,
  contractorId: string,
  scope: SQL | undefined,
): Promise<MoneyContractor | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contractorId)) return null;
  const [row] = await tx
    .select({
      id: contractors.id,
      name: contractors.name,
      paysTo: contractors.paysTo,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      responsibleName: respEmployee.shortName,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      needReceiptFile: contractors.needReceiptFile,
      oneSum: contractors.oneSum,
      oneOff: sql<boolean>`${contractors.kind} = 'oneoff'`,
      version: contractors.version,
    })
    .from(contractors)
    .leftJoin(respEmployee, eq(respEmployee.id, contractors.responsibleEmployeeId))
    .where(and(eq(contractors.id, contractorId), scope));
  return row ?? null;
}

/**
 * Чей счёт у операции (прототип holder): деньги переводятся на счёт организации или на кошелёк
 * ответственного; «Оплатил контрагент сам» — мимо наших счетов. Без ответственного у прототипа деньги
 * ни на чьём кошельке (holder пуст), в базе — на счёте организации, как в `syncMoneyHolders`.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-15
function holderOf(
  c: MoneyContractor,
  self: boolean,
): { holderKind: MoneyHolderKind; holderEmployeeId: string | null } {
  if (self) return { holderKind: 'client', holderEmployeeId: null };
  if (c.paysTo === 'org' || !c.responsibleEmployeeId)
    return { holderKind: 'org', holderEmployeeId: null };
  return { holderKind: 'employee', holderEmployeeId: c.responsibleEmployeeId };
}

/** Строка формы поступления: неоплаченный отчёт контрагента (прототип inDlg, `reps`). */
export interface ReceiptFormRow {
  reportId: string;
  typeShort: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate: IsoDate | null;
  payDue: IsoDate;
  sum: Tyiyn;
  /** «Уже получено»: под отчёт принято или по нему оплачено — что больше. */
  already: Tyiyn;
  /** Сколько ещё можно распределить на отчёт. */
  left: Tyiyn;
}

/** «Уже получено» по отчёту (прототип inDlg, `already`). */
const alreadyOf = (r: Pick<TaxReport, 'paid' | 'received'>) => Math.max(0, r.paid, r.received);

/**
 * Неоплаченные отчёты контрагента для формы поступления (прототип inDlg): с суммой больше 0, не «Не
 * требуется», не прежние версии, ещё не всё получено — по сроку оплаты.
 */
export async function receiptFormRows(
  tx: Tx,
  contractorId: string,
): Promise<{ rows: ReceiptFormRow[]; unpaid: number }> {
  const list = await moneyReportsOf(tx, contractorId);
  // Неоплаченные отчёты, деньги на которые уже получены: подсказка «эта сумма станет авансом».
  const unpaid = list.filter(
    (r) => hasTaxSum(r.act) && r.status !== 'not_required' && (r.sum ?? 0) > r.paid,
  ).length;
  const rows = list
    .filter(
      (r) =>
        hasTaxSum(r.act) &&
        (r.sum ?? 0) > 0 &&
        r.status !== 'not_required' &&
        r.sum! - alreadyOf(r) > 0,
    )
    .map((r) => ({
      reportId: r.id,
      typeShort: r.typeShort,
      period: r.period,
      periodStart: r.periodStart,
      eventDate: r.eventDate,
      payDue: r.payDue,
      sum: r.sum!,
      already: alreadyOf(r),
      left: r.sum! - alreadyOf(r),
    }));
  return { rows, unpaid };
}

/** Ввод формы «Поступление от контрагента». */
export interface ReceiptInput {
  total: Tyiyn;
  date: IsoDate;
  rows: readonly { reportId: string; amount: Tyiyn }[];
  /**
   * Часть за обслуживание по месяцам (задача 2.21; прототип inDlg, `feeAlloc`): только когда
   * сотруднику она доступна (`ctx.fee`) — плата видна, контрагент не разовый и платит организации.
   */
  fee?: Allocation;
  /**
   * Сколько файлов окно загрузит к поступлению после сохранения (источник «Поступление», как файлы
   * задачи — к уже созданной записи): при «Файл при поступлении обязателен» и включённых «Файлах в
   * карточках» — не меньше одного.
   */
  files: number;
}

/**
 * «Записать поступление» (ТЗ «Поступление от контрагента»; прототип inDlg): общая сумма больше 0, дата
 * не позже сегодня; строки детализации — неоплаченные отчёты этого контрагента, каждая не больше
 * «Осталось»; общая сумма не меньше суммы строк, излишек — аванс. Файл обязателен, если так отмечено у
 * контрагента, а «Файлы в карточках» включены (без них файл приложить некуда). Деньги — на счёт
 * организации или ответственного, по карточке контрагента.
 */
export async function createReceipt(
  tx: Tx,
  contractorId: string,
  input: ReceiptInput,
  ctx: {
    today: IsoDate;
    scope: SQL | undefined;
    filesOn: boolean;
    t: Translate;
    /** Часть за обслуживание доступна: плата видна, контрагент в области «Контрагентов». */
    fee?: boolean;
  },
): Promise<{ id: string }> {
  // Контрагент блокируется: два поступления или поступление с оплатой не считают остаток одновременно.
  const c = await lockContractor(tx, contractorId, ctx.scope);
  if (c.archived) throw new MoneyRefusedError('contractor_archived');
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  const rows = input.rows.filter((x) => x.amount > 0);
  if (new Set(rows.map((x) => x.reportId)).size !== rows.length) {
    throw new MoneyRefusedError('receipt_row_invalid', 400, 'rows');
  }
  const fee = (input.fee ?? [])
    .filter((x) => x.amount > 0)
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  // Плата — только организации: у контрагента, который переводит деньги ответственному, её части нет.
  if (fee.length && !(ctx.fee && c.paysTo === 'org' && !c.oneOff)) {
    throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
  }
  const feeSum = fee.reduce((a, x) => a + x.amount, 0);
  const detail = rows.reduce((a, x) => a + x.amount, 0) + feeSum;
  if (detail > input.total) throw new MoneyRefusedError('receipt_total_less', 400, 'total');
  const open = new Map((await receiptFormRows(tx, contractorId)).rows.map((r) => [r.reportId, r]));
  for (const x of rows) {
    const r = open.get(x.reportId);
    if (!r) throw new MoneyRefusedError('receipt_row_invalid', 400, 'rows');
    if (x.amount > r.left) throw new MoneyRefusedError('receipt_row_over', 400, 'rows');
  }
  if (fee.length) {
    if (new Set(fee.map((x) => x.month)).size !== fee.length) {
      throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
    }
    const feeLeft = await receiptFeeLeft(tx, contractorId, ctx.today);
    for (const x of fee) {
      const left = feeLeft.get(x.month);
      if (left === undefined) throw new MoneyRefusedError('receipt_fee_invalid', 400, 'fee');
      if (x.amount > left) throw new MoneyRefusedError('receipt_row_over', 400, 'fee');
    }
  }
  if (c.needReceiptFile && ctx.filesOn && input.files < 1) {
    throw new MoneyRefusedError('receipt_file_required', 400, 'files');
  }
  const [op] = await tx
    .insert(moneyOperations)
    .values({
      contractorId,
      kind: 'in',
      // На налоги — всё, кроме части за обслуживание: она на виртуальный счёт не попадает.
      amount: input.total - feeSum,
      total: input.total,
      opDate: input.date,
      ...holderOf(c, false),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: moneyOperations.id });
  if (rows.length) {
    await tx
      .insert(moneyAllocations)
      .values(rows.map((x) => ({ operationId: op!.id, reportId: x.reportId, amount: x.amount })));
  }
  await insertReceiptFeePayments(
    tx,
    contractorId,
    { operationId: op!.id, date: input.date, rows: fee },
    ctx.t,
  );
  // Часть за обслуживание — отдельными полями: без права «Видеть плату» их в истории не видно, а
  // `total` — только то, что пришло на налоги (ТЗ: плата скрыта везде).
  await writeHistory(tx, {
    entity: 'money_operation',
    entityId: op!.id,
    action: 'create',
    changes: [
      { field: 'kind', to: 'in' },
      { field: 'total', to: input.total - feeSum },
      { field: 'opDate', to: input.date },
      {
        field: 'allocations',
        to: rows.map((x) => {
          const r = open.get(x.reportId)!;
          return { report: reportLabel(r, ctx.t), amount: x.amount };
        }),
      },
      ...(fee.length
        ? [
            { field: 'feeTotal', to: feeSum },
            {
              field: 'feeAllocations',
              to: fee.map((x) => ({ month: x.month, amount: x.amount })),
            },
          ]
        : []),
    ],
    contractorId,
  });
  return { id: op!.id };
}

/** «НДС 09.2026» — вид кратко и период (прототип: `T[r.t].short + ' ' + r.plabel`). */
export function reportLabel(
  r: Pick<MoneyReport, 'typeShort' | 'period' | 'periodStart' | 'eventDate'>,
  t: Translate,
): string {
  return `${r.typeShort} ${periodLabel({ period: r.period, start: r.periodStart, event: r.eventDate }, t)}`;
}

/**
 * Контрагент заблокирован до конца транзакции: деньги по нему считает одно действие. Сначала
 * блокировка, потом чтение — архив, ответственный и счёт берутся уже под ней. `no key update`:
 * денежные действия, архив и назначение идут по очереди, а вставка уточнённого отчёта (внешний ключ на
 * контрагента) не ждёт оплату — взаимной блокировки «оплата ↔ уточнённый» нет.
 */
async function lockContractor(
  tx: Tx,
  contractorId: string,
  scope: SQL | undefined,
): Promise<MoneyContractor> {
  if (!/^[0-9a-f-]{36}$/i.test(contractorId))
    throw new RecordNotFoundError('contractor', contractorId);
  const [locked] = await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(and(eq(contractors.id, contractorId), scope))
    .for('no key update');
  const c = locked ? await moneyContractor(tx, contractorId, scope) : null;
  if (!c) throw new RecordNotFoundError('contractor', contractorId);
  return c;
}

/**
 * Оплата и её отмена: сначала контрагент, потом отчёт — в том же порядке, что приостановка и архив
 * контрагента, чтобы одновременные действия не заблокировали друг друга.
 */
async function lockReportMoney(
  tx: Tx,
  id: string,
  ctx: { scope: SQL | undefined; finScope: SQL | undefined },
): Promise<{ r: typeof reports.$inferSelect; c: MoneyContractor }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new RecordNotFoundError('report', id);
  const [row] = await tx
    .select({ contractorId: reports.contractorId })
    .from(reports)
    .where(eq(reports.id, id));
  if (!row) throw new RecordNotFoundError('report', id);
  const c = await lockContractor(tx, row.contractorId, ctx.finScope);
  const r = await lockReport(tx, id, ctx.scope);
  return { r, c };
}

/**
 * Деньги контрагента — на счёте, куда он их переводит (прототип transferCp и `cp-pays`): после смены
 * ответственного или «Деньги на налоги переводит» операции, кроме «Оплатил контрагент сам», переходят
 * на счёт организации или нового ответственного; без ответственного — на счёт организации. Области
 * функция не проверяет: вызывающий передаёт контрагентов, уже найденных в своей области и
 * заблокированных в этой транзакции (организацию отделяет RLS обеих таблиц).
 */
export async function syncMoneyHolders(tx: Tx, contractorIds: readonly string[]): Promise<void> {
  if (!contractorIds.length) return;
  const toOrg = sql`(${contractors.paysTo} = 'org' or ${contractors.responsibleEmployeeId} is null)`;
  const kind = sql`case when ${toOrg} then 'org' else 'employee' end`;
  const employee = sql`case when ${toOrg} then null else ${contractors.responsibleEmployeeId} end`;
  await tx.execute(sql`update ${moneyOperations}
    set holder_kind = ${kind}, holder_employee_id = ${employee},
      version = ${moneyOperations.version} + 1, updated_at = now(), updated_by = app.current_user_id()
    from ${contractors}
    where ${contractors.id} = ${moneyOperations.contractorId}
      and ${inArray(moneyOperations.contractorId, [...contractorIds])}
      and not ${moneyOperations.self}
      and (${moneyOperations.holderKind}, ${moneyOperations.holderEmployeeId}) is distinct from (${kind}, ${employee})`);
}

/** График оплаты отчёта (прототип schedule): платежи, их сроки, суммы и оплаченное. */
export async function reportSchedule(
  tx: Tx,
  r: {
    reportTypeCode: string;
    periodStart: IsoDate;
    payDue: IsoDate | null;
    dueDate: IsoDate;
    amount: number | null;
    paid: number;
    act: ReportAct;
  },
): Promise<SchedulePart[]> {
  if (!hasTaxSum(r.act)) return [];
  const [type] = await tx
    .select({ schedule: reportTypes.paySchedule })
    .from(reportTypes)
    .where(eq(reportTypes.code, r.reportTypeCode));
  const base = r.payDue ?? r.dueDate;
  const installments = type?.schedule ?? null;
  const dues = installments?.length
    ? scheduleDues(installments, Number(r.periodStart.slice(0, 4)), base, await calendarOf(tx))
    : [base];
  return paymentSchedule(r.amount, r.paid, dues);
}

/**
 * После оплаты, её отмены или новой суммы: срок оплаты — первого неоплаченного платежа графика
 * (прототип derive: `r.payDue`), у вида «Уплата» статус считается сам (`payOnlyReportStatus`).
 */
export async function syncPaymentState(tx: Tx, reportId: string): Promise<void> {
  const [r] = await tx.select().from(reports).where(eq(reports.id, reportId));
  if (!r || !hasTaxSum(r.act)) return;
  const set: Partial<typeof reports.$inferInsert> = {};
  const parts = await reportSchedule(tx, {
    ...r,
    amount: r.amount === null ? null : Number(r.amount),
    paid: Number(r.paid),
  });
  if (parts.length > 1) {
    const due = schedulePayDue(parts, r.payDue ?? r.dueDate);
    if (due !== r.payDue) set.payDue = due;
  }
  if (r.act === 'pay' && !r.superseded) {
    const status = payOnlyReportStatus({
      status: r.status,
      sum: r.amount === null ? null : Number(r.amount),
      paid: Number(r.paid),
    });
    if (status !== r.status) {
      set.status = status as typeof r.status;
      await tx.insert(statusHistory).values({
        scale: 'report',
        entityId: r.id,
        fromStatus: r.status,
        toStatus: status,
      });
    }
  }
  if (Object.keys(set).length) await tx.update(reports).set(set).where(eq(reports.id, r.id));
}

/** Ввод окна «Оплата налога в бюджет». */
export interface PaymentInput {
  version: number;
  amount: Tyiyn;
  date: IsoDate;
  /** «Оплатил контрагент сам». */
  self: boolean;
}

/** Можно ли отметить оплату (прототип reportActions: «Отметить оплаченным»). */
function payable(r: typeof reports.$inferSelect): void {
  // У прежней версии оплаты нет: её оплаченное уже в уточнённой (прототип: кнопки нет).
  const sum = r.amount === null ? 0 : Number(r.amount);
  if (
    r.superseded ||
    !hasTaxSum(r.act) ||
    r.status === 'not_required' ||
    !(sum > 0) ||
    Number(r.paid) >= sum
  ) {
    throw new MoneyRefusedError('payment_not_allowed');
  }
}

/**
 * «Отметить оплаченным» (ТЗ «Оплата налога», «Сдача после оплаты»; прототип payDlg): сумма больше 0
 * (может быть больше «К уплате» — пеня), дата не позже сегодня. Без «Оплатил контрагент сам» — только
 * деньгами этого контрагента: сверка по отчёту «Достаточно» и сумма не больше денег на счетах.
 */
export async function payReport(
  tx: Tx,
  id: string,
  input: PaymentInput,
  ctx: { today: IsoDate; scope: SQL | undefined; finScope: SQL | undefined },
): Promise<{ report: typeof reports.$inferSelect; operationId: string }> {
  const { r, c } = await lockReportMoney(tx, id, ctx);
  if (r.version !== input.version) throw new ReportChangedError(id, r.version);
  payable(r);
  if (input.date > ctx.today) throw new MoneyRefusedError('money_date_future', 400, 'date');
  if (input.amount > MONEY_AMOUNT_MAX)
    throw new MoneyRefusedError('payment_not_allowed', 400, 'amount');
  if (!input.self) {
    const { money } = await contractorMoneyOf(tx, r.contractorId);
    const funds = money.reports.get(id)?.funds ?? null;
    if (paymentProblem(input.amount, false, funds, money.available)) {
      const { variant, amount } = paymentShortage(funds, money.available);
      throw new MoneyRefusedError('payment_not_enough', 409, 'amount', {
        variant,
        amount: formatSomWithUnit(amount),
      });
    }
  }
  const [op] = await tx
    .insert(moneyOperations)
    .values({
      contractorId: r.contractorId,
      kind: 'pay',
      amount: input.amount,
      opDate: input.date,
      reportId: id,
      self: input.self,
      ...holderOf(c, input.self),
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: moneyOperations.id });
  const paid = Number(r.paid);
  const [updated] = await tx
    .update(reports)
    .set({
      paid: paid + input.amount,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(reports.id, id))
    .returning();
  await syncPaymentState(tx, id);
  const need = Number(r.amount ?? 0) - paid;
  await writeHistory(tx, {
    entity: 'report',
    entityId: id,
    action: 'update',
    changes: [
      {
        field: 'payment',
        to: {
          amount: input.amount,
          date: input.date,
          self: input.self,
          over: Math.max(0, input.amount - need),
        },
      },
      { field: 'paid', from: paid, to: paid + input.amount },
    ],
    contractorId: r.contractorId,
  });
  return { report: updated!, operationId: op!.id };
}

/** Последняя действующая оплата отчёта: её отменяет откат шкалы оплаты (прототип scBack('pay')). */
async function lastPayment(tx: Tx, reportId: string) {
  const [op] = await tx
    .select()
    .from(moneyOperations)
    .where(
      and(
        eq(moneyOperations.reportId, reportId),
        eq(moneyOperations.kind, 'pay'),
        isNull(moneyOperations.cancelledAt),
      ),
    )
    .orderBy(
      desc(moneyOperations.opDate),
      desc(moneyOperations.createdAt),
      desc(moneyOperations.id),
    )
    .limit(1);
  return op ?? null;
}

/** Откат шкалы оплаты: сколько останется оплачено (`scaleBack` с `paidRest`); null — оплат нет. */
export async function paymentRest(tx: Tx, reportId: string, paid: number): Promise<number | null> {
  const op = await lastPayment(tx, reportId);
  return op ? paid - Number(op.amount) : null;
}

/**
 * Откат оплаты (ТЗ «Отменить оплату у сданного отчёта можно; отчёт остаётся «Сдан», а оплата снова
 * считается по сроку оплаты»; прототип rollbackDlg('pay')): отменяется последняя оплата, с причиной;
 * нельзя, если после неё остаток контрагента списан в бонус — сначала отменяют списание. Право «Откат
 * статусов» проверяет API.
 */
export async function cancelPayment(
  tx: Tx,
  id: string,
  input: { version: number; reason: string },
  ctx: { scope: SQL | undefined; finScope: SQL | undefined },
): Promise<typeof reports.$inferSelect> {
  const { r } = await lockReportMoney(tx, id, ctx);
  if (r.version !== input.version) throw new ReportChangedError(id, r.version);
  // ОТКЛОНЕНИЕ: docs/deviations.md#В-16 — у прежней версии оплату не отменяют: её оплаченное уже перешло в уточнённую.
  if (r.superseded) throw new MoneyRefusedError('payment_superseded');
  const op = await lastPayment(tx, id);
  if (!op) throw new MoneyRefusedError('payment_none');
  const [bonus] = await tx
    .select({ date: moneyOperations.opDate })
    .from(moneyOperations)
    .where(
      and(
        eq(moneyOperations.contractorId, r.contractorId),
        eq(moneyOperations.kind, 'bonus'),
        isNull(moneyOperations.cancelledAt),
        sql`${moneyOperations.opDate} >= ${op.opDate}`,
      ),
    )
    .orderBy(asc(moneyOperations.opDate))
    .limit(1);
  if (bonus) {
    throw new MoneyRefusedError('payment_bonus_after', 409, undefined, {
      date: formatDateRu(bonus.date),
    });
  }
  await tx
    .update(moneyOperations)
    .set({
      cancelledAt: sql`now()`,
      cancelledBy: sql`app.current_user_id()`,
      cancelReason: input.reason.trim(),
      version: sql`${moneyOperations.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(moneyOperations.id, op.id));
  const paid = Number(r.paid);
  const next = Math.max(0, paid - Number(op.amount));
  const [updated] = await tx
    .update(reports)
    .set({
      paid: next,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(reports.id, id))
    .returning();
  await syncPaymentState(tx, id);
  await writeHistory(tx, {
    entity: 'report',
    entityId: id,
    action: 'update',
    changes: [
      { field: 'paymentCancel', from: { amount: Number(op.amount), date: op.opDate } },
      { field: 'paid', from: paid, to: next },
    ],
    reason: input.reason,
    contractorId: r.contractorId,
  });
  return updated!;
}

/** Событие шкалы оплаты (прототип statusHist('pay')): оплата или её отмена. */
export interface PaymentEvent {
  at: Date;
  amount: Tyiyn;
  self: boolean;
  date: IsoDate;
  actorUserId: string | null;
  actorName: string | null;
  fileId: string | null;
  fileName: string | null;
  /** Отмена оплаты: причина. */
  cancelled: {
    at: Date;
    actorUserId: string | null;
    actorName: string | null;
    reason: string;
  } | null;
}

const payActor = alias(employees, 'pay_actor');
const cancelActor = alias(employees, 'pay_cancel_actor');

/** Оплаты отчёта по порядку записи: для «Истории статусов» оплаты и файлов платёжных поручений. */
export async function reportPayments(tx: Tx, reportId: string): Promise<PaymentEvent[]> {
  const rows = await tx
    .select({
      id: moneyOperations.id,
      at: moneyOperations.createdAt,
      amount: moneyOperations.amount,
      self: moneyOperations.self,
      date: moneyOperations.opDate,
      actorUserId: moneyOperations.createdBy,
      actorName: payActor.shortName,
      cancelledAt: moneyOperations.cancelledAt,
      cancelledBy: moneyOperations.cancelledBy,
      cancelName: cancelActor.shortName,
      reason: moneyOperations.cancelReason,
      fileId: sql<
        string | null
      >`(select f.id from ${files} f where f.source_kind = 'tax_payment' and f.source_id = ${moneyOperations.id} and f.state = 'ready' order by f.created_at, f.id limit 1)`,
      fileName: sql<
        string | null
      >`(select f.name from ${files} f where f.source_kind = 'tax_payment' and f.source_id = ${moneyOperations.id} and f.state = 'ready' order by f.created_at, f.id limit 1)`,
    })
    .from(moneyOperations)
    .leftJoin(payActor, eq(payActor.userId, moneyOperations.createdBy))
    .leftJoin(cancelActor, eq(cancelActor.userId, moneyOperations.cancelledBy))
    .where(and(eq(moneyOperations.reportId, reportId), eq(moneyOperations.kind, 'pay')))
    .orderBy(asc(moneyOperations.createdAt), asc(moneyOperations.id));
  return rows.map((o) => ({
    at: o.at,
    amount: Number(o.amount),
    self: o.self,
    date: o.date,
    actorUserId: o.actorUserId,
    actorName: o.actorName,
    fileId: o.fileId,
    fileName: o.fileName,
    cancelled: o.cancelledAt
      ? {
          at: o.cancelledAt,
          actorUserId: o.cancelledBy,
          actorName: o.cancelName,
          reason: o.reason ?? '',
        }
      : null,
  }));
}

/** Операция вкладки «Деньги» карточки контрагента. */
export interface MoneyOperationRow {
  id: string;
  kind: MoneyOpKind;
  self: boolean;
  date: IsoDate;
  amount: Tyiyn;
  total: Tyiyn | null;
  /** «Основание»: отчёты детализации или отчёт оплаты — «НДС 09.2026». */
  reports: string[];
  note: string;
  actorUserId: string | null;
  actorName: string | null;
}

const opActor = alias(employees, 'op_actor');
const opReport = alias(reports, 'op_report');
const opType = alias(reportTypes, 'op_type');

/** Операции контрагента без отменённых, от новых к старым (прототип: вкладка «Деньги», «Операции»). */
export async function contractorOperations(
  tx: Tx,
  contractorId: string,
  t: Translate,
): Promise<MoneyOperationRow[]> {
  const ops = await tx
    .select({
      id: moneyOperations.id,
      kind: moneyOperations.kind,
      self: moneyOperations.self,
      date: moneyOperations.opDate,
      amount: moneyOperations.amount,
      total: moneyOperations.total,
      note: moneyOperations.note,
      actorUserId: moneyOperations.createdBy,
      actorName: opActor.shortName,
      typeShort: opType.shortName,
      period: opReport.period,
      periodStart: opReport.periodStart,
      eventDate: opReport.eventDate,
    })
    .from(moneyOperations)
    .leftJoin(opActor, eq(opActor.userId, moneyOperations.createdBy))
    .leftJoin(opReport, eq(opReport.id, moneyOperations.reportId))
    .leftJoin(opType, eq(opType.code, opReport.reportTypeCode))
    .where(and(eq(moneyOperations.contractorId, contractorId), isNull(moneyOperations.cancelledAt)))
    .orderBy(
      desc(moneyOperations.opDate),
      desc(moneyOperations.createdAt),
      desc(moneyOperations.id),
    );
  const ids = ops.filter((o) => o.kind === 'in').map((o) => o.id);
  const allocs = ids.length
    ? await tx
        .select({
          operationId: moneyAllocations.operationId,
          typeShort: reportTypes.shortName,
          period: reports.period,
          periodStart: reports.periodStart,
          eventDate: reports.eventDate,
        })
        .from(moneyAllocations)
        .innerJoin(reports, eq(reports.id, moneyAllocations.reportId))
        .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
        .where(inArray(moneyAllocations.operationId, ids))
        .orderBy(asc(reports.payDue), asc(reports.id))
    : [];
  return ops.map((o) => ({
    id: o.id,
    kind: o.kind,
    self: o.self,
    date: o.date,
    amount: Number(o.amount),
    total: o.total === null ? null : Number(o.total),
    reports:
      o.kind === 'in'
        ? allocs.filter((a) => a.operationId === o.id).map((a) => reportLabel(a, t))
        : o.typeShort && o.period && o.periodStart
          ? [
              reportLabel(
                {
                  typeShort: o.typeShort,
                  period: o.period,
                  periodStart: o.periodStart,
                  eventDate: o.eventDate,
                },
                t,
              ),
            ]
          : [],
    note: o.note,
    actorUserId: o.actorUserId,
    actorName: o.actorName,
  }));
}

/** Итоги «Баланса по контрагенту» (прототип: блок во вкладке «Основное»). */
export interface ContractorBalance {
  /** «Получено от контрагента»: поступления, возвраты по уточнённому и корректировки. */
  received: Tyiyn;
  /** «Оплачено в бюджет» и из них «контрагент оплатил сам». */
  paid: Tyiyn;
  selfPaid: Tyiyn;
  /** «Списано в бонус». */
  bonus: Tyiyn;
  /** «Остаток на счёте» — деньги контрагента на счетах. */
  available: Tyiyn;
}

/** Итоги операций контрагента без отменённых. */
export async function contractorBalance(tx: Tx, contractorId: string): Promise<ContractorBalance> {
  const sum = (where: SQL) =>
    sql<number>`coalesce(sum(${moneyOperations.amount}) filter (where ${where}), 0)`.mapWith(
      Number,
    );
  const [row] = await tx
    .select({
      received: sum(sql`${moneyOperations.kind} in ('in', 'back', 'corr')`),
      paid: sum(sql`${moneyOperations.kind} = 'pay'`),
      selfPaid: sum(sql`${moneyOperations.kind} = 'pay' and ${moneyOperations.self}`),
      bonus: sum(sql`${moneyOperations.kind} = 'bonus'`),
    })
    .from(moneyOperations)
    .where(
      and(eq(moneyOperations.contractorId, contractorId), isNull(moneyOperations.cancelledAt)),
    );
  return {
    received: row?.received ?? 0,
    paid: row?.paid ?? 0,
    selfPaid: row?.selfPaid ?? 0,
    bonus: row?.bonus ?? 0,
    available: await availableOf(tx, contractorId),
  };
}

/** Вкладка «Деньги»: сверка за месяц и что нужно оплатить. */
export interface ContractorMoneyView {
  money: ContractorMoney;
  reports: MoneyReport[];
  reconciliation: MonthReconciliation;
}

/** Сверка денег контрагента за месяц (по сроку оплаты до конца месяца `monthEnd`). */
export async function contractorMoneyView(
  tx: Tx,
  contractorId: string,
  monthEnd: IsoDate,
): Promise<ContractorMoneyView> {
  const { money, reports: list } = await contractorMoneyOf(tx, contractorId);
  return { money, reports: list, reconciliation: monthReconciliation(money, list, monthEnd) };
}

/** Деньги отчёта для карточки: сверка, график, деньги контрагента на счетах. */
export interface ReportMoneyCard {
  funds: ReportFunds | null;
  received: Tyiyn;
  selfPaid: Tyiyn;
  available: Tyiyn;
  schedule: SchedulePart[];
  status: PaymentStatus;
}

/** Деньги отчёта в карточке (прототип report-card.js: блок сумм, «Деньги контрагента», график). */
export async function reportMoneyCard(
  tx: Tx,
  r: {
    id: string;
    contractorId: string;
    reportTypeCode: string;
    periodStart: IsoDate;
    payDue: IsoDate | null;
    dueDate: IsoDate;
    amount: number | null;
    paid: number;
    act: ReportAct;
    status: string;
    superseded: boolean;
  },
): Promise<ReportMoneyCard> {
  const [{ money, reports: list }, schedule] = await Promise.all([
    contractorMoneyOf(tx, r.contractorId),
    reportSchedule(tx, r),
  ]);
  const own = money.reports.get(r.id);
  const self = list.find((x) => x.id === r.id)?.selfPaid;
  const selfPaid =
    self ??
    Number(
      (
        await tx
          .select({
            s: sql<number>`coalesce(sum(${moneyOperations.amount}), 0)`.mapWith(Number),
          })
          .from(moneyOperations)
          .where(
            and(
              eq(moneyOperations.reportId, r.id),
              eq(moneyOperations.kind, 'pay'),
              eq(moneyOperations.self, true),
              isNull(moneyOperations.cancelledAt),
            ),
          )
      )[0]?.s ?? 0,
    );
  return {
    funds: own?.funds ?? null,
    received: own?.received ?? Math.max(0, r.paid - selfPaid),
    selfPaid,
    available: money.available,
    schedule,
    status: paymentStatus({ act: r.act, status: r.status, sum: r.amount, paid: r.paid }),
  };
}

/**
 * Операция-источник файлов «Поступление» (`in`) и «Оплата налога» (`pay`) для блока «Файлы»: контрагент
 * в области `scope`, отчёт оплаты; null — нет такой операции или она вне области.
 */
export async function moneyFileSource(
  tx: Tx,
  id: string,
  kind: 'receipt' | 'tax_payment',
  scope: SQL | undefined,
): Promise<{
  contractor: { id: string; responsibleEmployeeId: string | null; archived: boolean };
  reportId: string | null;
  cancelled: boolean;
  /** «Учёт оплаты налогов» включён в учётной политике. */
  taxpay: boolean;
  /** «Плата за обслуживание» включена в учётной политике. */
  feeOn: boolean;
  /** Поступление только за обслуживание: часть на налоги — 0 (задача 2.21). */
  feeOnly: boolean;
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx
    .select({
      contractorId: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
      reportId: moneyOperations.reportId,
      cancelled: sql<boolean>`${moneyOperations.cancelledAt} is not null`,
      taxpay: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'taxpay')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
      feeOn: sql<boolean>`coalesce((select (${orgSettings.features} ->> 'fee')::boolean from ${orgSettings} where ${orgSettings.orgId} = app.current_org_id()), false)`,
      amount: moneyOperations.amount,
    })
    .from(moneyOperations)
    .innerJoin(contractors, eq(contractors.id, moneyOperations.contractorId))
    .where(
      and(
        eq(moneyOperations.id, id),
        eq(moneyOperations.kind, kind === 'receipt' ? 'in' : 'pay'),
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
    reportId: row.reportId,
    cancelled: row.cancelled,
    taxpay: row.taxpay,
    feeOn: row.feeOn,
    feeOnly: kind === 'receipt' && Number(row.amount) === 0,
  };
}

/**
 * «Файл при поступлении», «Деньги на налоги переводит» и «Платит одной суммой» (прототип
 * contractor-card.js, `cp-needf`, `cp-pays`, `cp-one`): с версией контрагента, в истории контрагента —
 * было → стало. Смена счёта переносит на него деньги контрагента: операции, кроме «Оплатил контрагент
 * сам», получают новый счёт. Отметки файла и одной суммы у контрагента в архиве не меняют (в прототипе
 * переключатель неактивен); «Платит одной суммой» у разового нет — у него нет платы за обслуживание.
 * Видит ли сотрудник плату, проверяет вызывающий.
 */
export async function saveMoneySettings(
  tx: Tx,
  contractorId: string,
  input: { version: number; needReceiptFile?: boolean; paysTo?: 'emp' | 'org'; oneSum?: boolean },
  scope: SQL | undefined,
): Promise<{ id: string; version: number }> {
  const c = await lockContractor(tx, contractorId, scope);
  if (c.version !== input.version) throw new RecordChangedError('contractor', c.id, c.version);
  const patch: { needReceiptFile?: boolean; paysTo?: 'emp' | 'org'; oneSum?: boolean } = {};
  if (input.needReceiptFile !== undefined && input.needReceiptFile !== c.needReceiptFile) {
    if (c.archived) throw new MoneyRefusedError('contractor_archived');
    patch.needReceiptFile = input.needReceiptFile;
  }
  if (input.oneSum !== undefined && input.oneSum !== c.oneSum) {
    if (c.archived) throw new MoneyRefusedError('contractor_archived');
    if (c.oneOff) throw new MoneyRefusedError('one_sum_one_off', 400, 'oneSum');
    patch.oneSum = input.oneSum;
  }
  if (input.paysTo !== undefined && input.paysTo !== c.paysTo) patch.paysTo = input.paysTo;
  const saved = await updateWithHistory(tx, {
    table: contractors,
    entity: 'contractor',
    id: c.id,
    version: input.version,
    patch,
    contractorId: c.id,
  });
  if (patch.paysTo) await syncMoneyHolders(tx, [c.id]);
  return { id: saved.id, version: saved.version };
}

/**
 * Есть операции с деньгами контрагента (и отменённые — они остаются в журнале) или оплаты за
 * обслуживание: его можно только отправить в архив (ТЗ «Контрагенты» → удаление; прототип cpActions:
 * `OPS.some(…) || FEEPAYS.some(…)`).
 */
export async function contractorHasMoney(tx: Tx, contractorId: string): Promise<boolean> {
  const [row] = await tx.execute<{ yes: boolean }>(
    sql`select exists (select 1 from ${moneyOperations} where ${moneyOperations.contractorId} = ${contractorId})
      or exists (select 1 from ${feePayments} where ${feePayments.contractorId} = ${contractorId}) as yes`,
  );
  return !!row?.yes;
}
