import {
  periodLabel,
  shiftedPeriodStart,
  type IsoDate,
  type StartDateFacts,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Tx } from './client';
import {
  contractorServicePeriods,
  feeAllocations,
  feePayments,
  reports,
  reportTypes,
} from './schema';
import { dateOfMonth, servicePeriodsOf } from './service-periods';

/*
 * Исправление даты начала обслуживания в «Изменить контрагента» (прототип v84, modules/
 * contractor-form.js — `cpStartWhy`, `cpSetStart`; docs/deviations.md п. О-73). Правило — в
 * `@buhuchet/domain` (`startDateProblem`, `shiftedPeriodStart`); здесь — что о контрагенте знает база
 * и сдвиг первого периода. Саму дату и запись истории пишет `updateContractor`.
 */

/**
 * Что мешает поставить дату `next` (прототип `cpStartWhy`): конец первого периода обслуживания, самая
 * ранняя неудалённая оплата обслуживания за месяц раньше месяца новой даты и самый ранний отчёт,
 * сданный раньше новой даты («НДС 09.2026»; `reportResponsibleId` — кто за него отвечает: название
 * отчёта вызывающий отдаёт только тому, кто этот отчёт видит). Вызывать в контексте организации,
 * контрагент — в области.
 */
export async function startDateFacts(
  tx: Tx,
  contractorId: string,
  next: IsoDate,
  today: IsoDate,
  t: Translate,
): Promise<StartDateFacts & { reportResponsibleId: string | null }> {
  const first = (await servicePeriodsOf(tx, [contractorId])).get(contractorId)![0];
  const [paid] = await tx
    .select({ month: sql<string | null>`min(${feeAllocations.month})` })
    .from(feeAllocations)
    .innerJoin(feePayments, eq(feePayments.id, feeAllocations.paymentId))
    .where(
      and(
        eq(feePayments.contractorId, contractorId),
        isNull(feePayments.deletedAt),
        lt(feeAllocations.month, `${next.slice(0, 7)}-01`),
      ),
    );
  const [report] = await tx
    .select({
      short: reportTypes.shortName,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
      submittedOn: reports.submittedOn,
      responsibleEmployeeId: reports.responsibleEmployeeId,
    })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .where(and(eq(reports.contractorId, contractorId), lt(reports.submittedOn, next)))
    .orderBy(asc(reports.submittedOn), asc(reports.periodStart), asc(reports.id))
    .limit(1);
  return {
    today,
    firstPeriodTo: first?.to ?? null,
    paidMonth: paid?.month ? paid.month.slice(0, 7) : null,
    report: report
      ? {
          name: `${report.short} ${periodLabel(
            { period: report.period, start: report.periodStart, event: report.eventDate },
            t,
          )}`,
          submittedOn: report.submittedOn!,
        }
      : null,
    reportResponsibleId: report?.responsibleEmployeeId ?? null,
  };
}

/**
 * Сдвинуть начало первого периода обслуживания вслед за датой начала (прототип `cpSetStart`): только
 * если период начинался в месяце прежней даты. Вызывает `updateContractor` под блокировкой контрагента.
 */
export async function shiftFirstPeriod(
  tx: Tx,
  contractorId: string,
  was: IsoDate,
  next: IsoDate,
): Promise<void> {
  const first = (await servicePeriodsOf(tx, [contractorId])).get(contractorId)![0];
  const from = shiftedPeriodStart(first?.from ?? null, was, next);
  if (!first || !from) return;
  await tx
    .update(contractorServicePeriods)
    .set({ fromMonth: dateOfMonth(from) })
    .where(
      and(
        eq(contractorServicePeriods.contractorId, contractorId),
        eq(contractorServicePeriods.fromMonth, dateOfMonth(first.from)),
      ),
    );
}
