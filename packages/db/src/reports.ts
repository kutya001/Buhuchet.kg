import {
  activeSingleTax,
  assignmentRateText,
  defaultAssignmentFrom,
  dueRuleText,
  effectiveRule,
  periodEnd,
  servedWithin,
  type AssignmentEnRate,
  type CompatibilityRate,
  type CompatibilitySubject,
  type DueRule,
  endsWithAssignment,
  OPEN_REPORT_STATUSES,
  pastPeriods,
  periodInAssignment,
  periodsDue,
  periodStartOf,
  productionCalendar,
  RecordChangedError,
  RecordNotFoundError,
  reportDue,
  restoredByAssignment,
  revisionDue,
  type EffectiveRule,
  type HistoryChange,
  type IsoDate,
  type PayerKind,
  type ProductionCalendar,
  type ReportAct,
  type ReportPeriod,
  type ReportStatus,
  type ReportTypeRule,
  type RateAddition,
  type StatusDueRule,
  type Translate,
  type YearMonth,
} from '@buhuchet/domain';
import { and, asc, count, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias, type PgInsertValue } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import { productionCalendarEntries } from './platform-dicts';
import { servicePeriodsOf } from './service-periods';
import {
  assignments,
  authorities,
  contractorBenefits,
  contractors,
  dueChangeReasons,
  employees,
  orgReportTypes,
  ownershipForms,
  reportDueChanges,
  reports,
  reportTypeRegimes,
  reportTypes,
  singleTaxRates,
  statusHistory,
  taxBenefitDueRules,
  taxBenefits,
  taxRegimes,
} from './schema';

/**
 * Модуль «Отчеты для сдачи»: назначения отчётов контрагентам и отчёты к сдаче организации из контекста
 * `withOrgContext` (RLS). Сроки считает `@buhuchet/domain` (`effectiveRule`, `reportDue`,
 * `periodsDue`); здесь — что прочитать и что записать. Отчёты создаются только недостающие (ключ
 * «контрагент + вид + период + дата события + версия», `reports_period_key`), поэтому задача по
 * расписанию и повтор действия безопасны. История назначений — в `audit_log` (entity `assignment`,
 * с `contractor_id`), смены статуса — в «Истории статусов».
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Вид отчёта: правило сроков и то, что нужно назначению и отчёту. */
export interface ReportTypeInfo extends ReportTypeRule {
  name: string;
  shortName: string;
  active: boolean;
  eventLabel: string;
  rates: string[];
}

/** Виды каталога по кодам (без кодов — все). */
export async function reportTypeInfos(
  tx: Tx,
  codes?: readonly string[],
): Promise<Map<string, ReportTypeInfo>> {
  if (codes && codes.length === 0) return new Map();
  const rows = await tx
    .select({
      code: reportTypes.code,
      name: reportTypes.name,
      shortName: reportTypes.shortName,
      active: reportTypes.active,
      kind: reportTypes.kind,
      period: reportTypes.period,
      dueDay: reportTypes.dueDay,
      dueAfter: reportTypes.dueAfter,
      dueMonth: reportTypes.dueMonth,
      dueFrom: reportTypes.dueFrom,
      payDay: reportTypes.payDay,
      payAfter: reportTypes.payAfter,
      payMonth: reportTypes.payMonth,
      paySchedule: reportTypes.paySchedule,
      shiftToWorkday: reportTypes.shiftToWorkday,
      skipQuarters: reportTypes.skipQuarters,
      oneOff: reportTypes.oneOff,
      eventLabel: reportTypes.eventLabel,
      periodPerAssignment: reportTypes.periodPerAssignment,
      act: reportTypes.act,
      rates: reportTypes.rates,
    })
    .from(reportTypes)
    .where(codes ? inArray(reportTypes.code, [...codes]) : undefined);
  return new Map(rows.map((r) => [r.code, r]));
}

/** Вид отчёта для проверок назначения и разового отчёта: правило, ставки, подключён ли в организации. */
export interface AssignableType extends ReportTypeInfo {
  rateAdditions: RateAddition[];
  /** «Плательщик» и коды «Применимых режимов» — подходит ли вид контрагенту. */
  payer: PayerKind;
  regimes: string[];
  /** Подключён в организации («Справочники → Виды отчётов»). */
  enabled: boolean;
}

/** Вид каталога с настройкой организации; null — такого вида нет. */
export async function assignableType(tx: Tx, code: string): Promise<AssignableType | null> {
  const info = (await reportTypeInfos(tx, [code])).get(code);
  if (!info) return null;
  const [[extra], regimes, [org]] = await Promise.all([
    tx
      .select({ rateAdditions: reportTypes.rateAdditions, payer: reportTypes.payer })
      .from(reportTypes)
      .where(eq(reportTypes.code, code)),
    tx
      .select({ code: reportTypeRegimes.regimeCode })
      .from(reportTypeRegimes)
      .where(eq(reportTypeRegimes.reportTypeCode, code)),
    // FOR SHARE: одновременное отключение вида ждёт конца назначения и видит его (п. А-2 docs/decisions.md).
    tx
      .select({ enabled: orgReportTypes.enabled })
      .from(orgReportTypes)
      .where(eq(orgReportTypes.reportTypeCode, code))
      .for('share'),
  ]);
  return {
    ...info,
    rateAdditions: extra?.rateAdditions ?? [],
    payer: extra?.payer ?? 'all',
    regimes: regimes.map((r) => r.code),
    enabled: org?.enabled ?? false,
  };
}

const regime1 = alias(taxRegimes, 'cp_regime1');
const regime2 = alias(taxRegimes, 'cp_regime2');

/** Строки справочника «Ставки единого налога» для проверки и текста ставки. */
export async function singleTaxRateRows(tx: Tx): Promise<CompatibilityRate[]> {
  return tx
    .select({
      code: singleTaxRates.code,
      rate: singleTaxRates.rate,
      rateCashless: singleTaxRates.rateCashless,
      rateCash: singleTaxRates.rateCash,
      addsTo: singleTaxRates.addsTo,
    })
    .from(singleTaxRates);
}

/**
 * Контрагент для проверки «подходит ли вид» (прототип compatible): форма собственности, режимы по
 * порядку и строки ЕНС действующего назначения единого налога. Контрагента уже проверили на область.
 */
export async function compatibilitySubject(
  tx: Tx,
  contractorId: string,
): Promise<CompatibilitySubject> {
  const [[row], current] = await Promise.all([
    tx
      .select({
        formCode: contractors.formCode,
        declarationFor: ownershipForms.declarationFor,
        regime: regime1.code,
        regimeName: regime1.name,
        regime2: regime2.code,
        regime2Name: regime2.name,
      })
      .from(contractors)
      .innerJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode))
      .leftJoin(regime1, eq(regime1.code, contractors.regimeCode))
      .leftJoin(regime2, eq(regime2.code, contractors.regime2Code))
      .where(eq(contractors.id, contractorId)),
    tx
      .select({
        reportTypeCode: assignments.reportTypeCode,
        endedOn: assignments.endedOn,
        enRates: assignments.enRates,
      })
      .from(assignments)
      .where(eq(assignments.contractorId, contractorId))
      .orderBy(asc(assignments.createdAt)),
  ]);
  if (!row) throw new RecordNotFoundError('contractor', contractorId);
  return {
    form: { code: row.formCode, declarationFor: row.declarationFor },
    regimes: [
      ...(row.regime ? [{ code: row.regime, name: row.regimeName! }] : []),
      ...(row.regime2 ? [{ code: row.regime2, name: row.regime2Name! }] : []),
    ],
    singleTax: activeSingleTax(current),
  };
}

/** Причина из справочника «Причины изменения срока отчёта»; null — нет такой. */
export async function dueChangeReason(
  tx: Tx,
  code: string,
): Promise<{ name: string; active: boolean } | null> {
  const [row] = await tx
    .select({ name: dueChangeReasons.name, active: dueChangeReasons.active })
    .from(dueChangeReasons)
    .where(eq(dueChangeReasons.code, code));
  return row ?? null;
}

/** Производственный календарь КР для переноса сроков. */
export async function calendarOf(tx: Tx): Promise<ProductionCalendar> {
  return productionCalendar(await productionCalendarEntries(tx));
}

const ruleKey = (contractorId: string, typeCode: string) => `${contractorId}:${typeCode}`;

/**
 * Сроки по статусам контрагентов (прототип tOv, benLive): статус действует, пока сегодня в его датах
 * «Действует с / по» и он не отключён в справочнике; из нескольких статусов со своим сроком одного вида
 * берётся первый по коду.
 */
export async function statusDueRules(
  tx: Tx,
  contractorIds: readonly string[],
  today: IsoDate,
): Promise<Map<string, StatusDueRule>> {
  if (contractorIds.length === 0) return new Map();
  const rows = await tx
    .select({
      contractorId: contractorBenefits.contractorId,
      reportTypeCode: taxBenefitDueRules.reportTypeCode,
      benefitCode: taxBenefitDueRules.benefitCode,
      dueDay: taxBenefitDueRules.dueDay,
      dueAfter: taxBenefitDueRules.dueAfter,
      dueMonth: taxBenefitDueRules.dueMonth,
      payDay: taxBenefitDueRules.payDay,
      payAfter: taxBenefitDueRules.payAfter,
    })
    .from(contractorBenefits)
    .innerJoin(
      taxBenefitDueRules,
      eq(taxBenefitDueRules.benefitCode, contractorBenefits.benefitCode),
    )
    .innerJoin(taxBenefits, eq(taxBenefits.code, contractorBenefits.benefitCode))
    .where(
      and(
        inArray(contractorBenefits.contractorId, [...contractorIds]),
        eq(taxBenefits.active, true),
        or(isNull(contractorBenefits.validFrom), lte(contractorBenefits.validFrom, today)),
        or(isNull(contractorBenefits.validTo), gte(contractorBenefits.validTo, today)),
      ),
    )
    .orderBy(asc(contractorBenefits.benefitCode));
  const out = new Map<string, StatusDueRule>();
  for (const { contractorId, reportTypeCode, ...rule } of rows) {
    const key = ruleKey(contractorId, reportTypeCode);
    if (!out.has(key)) out.set(key, rule);
  }
  return out;
}

/** Назначение с тем, что нужно для отчётов. */
type AssignmentRow = typeof assignments.$inferSelect;

/** Правило сроков отчётов назначения: вид, статус контрагента и срок в назначении. */
export function assignmentRule(
  type: ReportTypeRule,
  a: Pick<AssignmentRow, 'dueDay' | 'ownPeriod' | 'ownDay' | 'ownMonth'>,
  status: StatusDueRule | null,
): EffectiveRule {
  return effectiveRule(
    type,
    { dueDay: a.dueDay, ownPeriod: a.ownPeriod, ownDay: a.ownDay, ownMonth: a.ownMonth },
    status,
  );
}

/** Поля нового отчёта по правилу и периоду. */
function reportValues(
  rule: EffectiveRule,
  start: IsoDate,
  calendar: ProductionCalendar,
  base: {
    contractorId: string;
    assignmentId: string | null;
    responsibleEmployeeId: string | null;
    fixedAmount: number | null;
  },
): PgInsertValue<typeof reports> {
  const ref = { period: rule.period, start };
  const due = reportDue(rule, ref, calendar);
  const auto = base.fixedAmount !== null && rule.act !== 'sub';
  return {
    contractorId: base.contractorId,
    reportTypeCode: rule.code,
    assignmentId: base.assignmentId,
    period: rule.period,
    periodStart: start,
    act: rule.act,
    dueBase: due.base,
    dueDate: due.due,
    payDue: due.payDue,
    amount: auto ? base.fixedAmount : null,
    amountAuto: auto,
    responsibleEmployeeId: base.responsibleEmployeeId,
    createdBy: sql`app.current_user_id()`,
    updatedBy: sql`app.current_user_id()`,
  };
}

/** Вставить отчёты, которых ещё нет; у новых — первая запись «Истории статусов». */
async function insertMissing(
  tx: Tx,
  values: PgInsertValue<typeof reports>[],
): Promise<{ id: string; status: ReportStatus }[]> {
  const out: { id: string; status: ReportStatus }[] = [];
  // Пачками: у postgres.js не больше 65 535 параметров в запросе.
  for (let i = 0; i < values.length; i += 1000) {
    const inserted = await tx
      .insert(reports)
      .values(values.slice(i, i + 1000))
      .onConflictDoNothing()
      .returning({ id: reports.id, status: reports.status });
    out.push(...inserted);
  }
  for (let i = 0; i < out.length; i += 5000) {
    const part = out.slice(i, i + 5000);
    if (part.length) {
      await tx
        .insert(statusHistory)
        .values(
          part.map((r) => ({ scale: 'report' as const, entityId: r.id, toStatus: r.status })),
        );
    }
  }
  return out;
}

/** Последний месяц периода отчёта: у квартального — третий, у годового — декабрь. */
const lastMonth = (period: ReportPeriod, start: IsoDate): YearMonth =>
  periodEnd({ period, start }).slice(0, 7);

/**
 * Отчёты по действующим назначениям на сегодня (ТЗ «По каждому назначению система сама создаёт отчёт
 * на каждый период: на текущий и на один вперёд»; прототип assignTypes): только недостающие, только за
 * периоды, в которых контрагент обслуживался хоть месяц (ТЗ «Приостановить»: «с этого месяца не
 * создаются … новые отчёты»; квартал и год — `servedWithin`, docs/deviations.md п. В-11), не у архивных
 * и только по действующим видам каталога; разовые виды — через «Разовый отчёт». Без условий — все
 * назначения организации (задача по расписанию).
 */
export async function createDueReports(
  tx: Tx,
  options: {
    today: IsoDate;
    contractorIds?: readonly string[];
    assignmentIds?: readonly string[];
    calendar?: ProductionCalendar;
  },
): Promise<number> {
  const { today } = options;
  // Сначала — контрагенты, по номеру: правка назначения (`lockAssignee`, `lockAssignment`) и действие с
  // обслуживанием (`changeService`) блокируют контрагента FOR UPDATE, поэтому сохранённое во время
  // задачи она дождётся, а назначения и периоды обслуживания прочитает после блокировки — свежими.
  await tx
    .select({ id: contractors.id })
    .from(contractors)
    .where(
      and(
        ne(contractors.serviceStatus, 'archived'),
        eq(contractors.kind, 'regular'),
        options.contractorIds ? inArray(contractors.id, [...options.contractorIds]) : undefined,
        options.assignmentIds
          ? inArray(
              contractors.id,
              tx
                .select({ id: assignments.contractorId })
                .from(assignments)
                .where(inArray(assignments.id, [...options.assignmentIds])),
            )
          : undefined,
      ),
    )
    .orderBy(asc(contractors.id))
    .for('share');
  const rows = await tx
    .select({ a: assignments, contractorResponsible: contractors.responsibleEmployeeId })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, assignments.reportTypeCode))
    .where(
      and(
        isNull(assignments.endedOn),
        ne(contractors.serviceStatus, 'archived'),
        // У разового контрагента регулярных отчётов нет (ТЗ «Непостоянные контрагенты»).
        eq(contractors.kind, 'regular'),
        eq(reportTypes.active, true),
        eq(reportTypes.oneOff, false),
        options.contractorIds
          ? inArray(assignments.contractorId, [...options.contractorIds])
          : undefined,
        options.assignmentIds ? inArray(assignments.id, [...options.assignmentIds]) : undefined,
      ),
    )
    .orderBy(asc(assignments.contractorId), asc(assignments.reportTypeCode));
  if (rows.length === 0) return 0;
  const contractorIds = [...new Set(rows.map((r) => r.a.contractorId))];
  const [types, calendar, statuses, periods] = await Promise.all([
    reportTypeInfos(tx, [...new Set(rows.map((r) => r.a.reportTypeCode))]),
    options.calendar ?? calendarOf(tx),
    statusDueRules(tx, contractorIds, today),
    servicePeriodsOf(tx, contractorIds),
  ]);
  const values = rows.flatMap(({ a, contractorResponsible }) => {
    const rule = assignmentRule(
      types.get(a.reportTypeCode)!,
      a,
      statuses.get(ruleKey(a.contractorId, a.reportTypeCode)) ?? null,
    );
    const served = periods.get(a.contractorId)!;
    // ОТКЛОНЕНИЕ: docs/deviations.md#В-12 — прототип создаёт отчёты и за месяцы паузы, сразу «Не требуется».
    return periodsDue(rule, { today, from: a.fromMonth, until: a.untilMonth }, calendar)
      .filter((start) => servedWithin(served, start.slice(0, 7), lastMonth(rule.period, start)))
      .map((start) =>
        reportValues(rule, start, calendar, {
          contractorId: a.contractorId,
          assignmentId: a.id,
          responsibleEmployeeId: a.responsibleEmployeeId ?? contractorResponsible,
          fixedAmount: a.fixedAmount,
        }),
      );
  });
  return (await insertMissing(tx, values)).length;
}

/**
 * Отчёты за прошлые месяцы, отмеченные «досоздать» при откате приостановки (ТЗ «Откат приостановки»:
 * «предлагает досоздать за них … отчёты»; задача 2.12): закончившиеся периоды действующих назначений
 * контрагента, в которые входит один из `months`, только недостающие, «К сдаче» (срок мог пройти).
 */
export async function createMonthReports(
  tx: Tx,
  options: { contractorId: string; months: readonly YearMonth[]; today: IsoDate },
): Promise<number> {
  const { contractorId, months, today } = options;
  if (months.length === 0) return 0;
  // Без блокировки назначений: контрагент уже взят FOR UPDATE (`changeService`), а правка назначения
  // сначала ждёт контрагента.
  const rows = await tx
    .select({ a: assignments, contractorResponsible: contractors.responsibleEmployeeId })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, assignments.reportTypeCode))
    .where(
      and(
        eq(assignments.contractorId, contractorId),
        isNull(assignments.endedOn),
        ne(contractors.serviceStatus, 'archived'),
        eq(contractors.kind, 'regular'),
        eq(reportTypes.active, true),
        eq(reportTypes.oneOff, false),
      ),
    );
  if (rows.length === 0) return 0;
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [...new Set(rows.map((r) => r.a.reportTypeCode))]),
    calendarOf(tx),
    statusDueRules(tx, [contractorId], today),
  ]);
  const values = rows.flatMap(({ a, contractorResponsible }) => {
    const rule = assignmentRule(
      types.get(a.reportTypeCode)!,
      a,
      statuses.get(ruleKey(a.contractorId, a.reportTypeCode)) ?? null,
    );
    return pastPeriods(rule.period, a.fromMonth, today, rule.skipQuarters)
      .filter((start) => {
        const last = lastMonth(rule.period, start);
        const picked = months.some((m) => start.slice(0, 7) <= m && m <= last);
        return picked && (!a.untilMonth || start <= a.untilMonth);
      })
      .map((start) =>
        reportValues(rule, start, calendar, {
          contractorId,
          assignmentId: a.id,
          responsibleEmployeeId: a.responsibleEmployeeId ?? contractorResponsible,
          fixedAmount: a.fixedAmount,
        }),
      );
  });
  return (await insertMissing(tx, values)).length;
}

/** Смена статуса отчётов системой (назначение снято или возвращено) с записью «Истории статусов». */
async function setStatuses(
  tx: Tx,
  rows: readonly { id: string; status: ReportStatus }[],
  to: ReportStatus,
  reason: string,
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .update(reports)
    .set({
      status: to,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(
      inArray(
        reports.id,
        rows.map((r) => r.id),
      ),
    );
  await tx.insert(statusHistory).values(
    rows.map((r) => ({
      scale: 'report' as const,
      entityId: r.id,
      fromStatus: r.status,
      toStatus: to,
      reason,
    })),
  );
}

/** Отчёты контрагента по виду (последние версии), заблокированные до конца транзакции. */
function lockTypeReports(tx: Tx, contractorId: string, typeCode: string) {
  return tx
    .select({
      id: reports.id,
      status: reports.status,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
      period: reports.period,
      dueBase: reports.dueBase,
      dueDate: reports.dueDate,
      payDue: reports.payDue,
      dueManual: reports.dueManual,
      submittedOn: reports.submittedOn,
      responsibleEmployeeId: reports.responsibleEmployeeId,
      assignmentId: reports.assignmentId,
      amount: reports.amount,
      amountAuto: reports.amountAuto,
    })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, contractorId),
        eq(reports.reportTypeCode, typeCode),
        eq(reports.superseded, false),
      ),
    )
    .orderBy(asc(reports.periodStart), asc(reports.id))
    .for('update');
}

/** Тексты, которые система пишет причиной в «Историю статусов». */
export interface AssignmentTexts {
  ended: string;
  restored: string;
  until: string;
  /** Причина в «Истории статусов» у прошлого периода, созданного при назначении. */
  past: string;
  /** То же, отмеченного сданным. */
  pastMarked: string;
  /** То же, отмеченного сданным и подтверждённым (сдача требует подтверждения). */
  pastConfirmed: string;
  /** Примечание подтверждения у отмеченного сданным (прототип: «Прошлый период отмечен при назначении»). */
  pastConfirmNote: string;
  /** Причина удаления несданного отчёта, когда в назначении изменили периодичность или срок. */
  ownRuleChanged: string;
}

/** Ввод назначения (поля формы; проверки значений — в API). */
export interface AssignmentInput {
  fromMonth: IsoDate;
  untilMonth: IsoDate | null;
  responsibleEmployeeId: string | null;
  rate: string | null;
  enRates: readonly AssignmentEnRate[];
  rateAdditions: readonly string[];
  dueDay: number | null;
  ownPeriod: ReportPeriod | null;
  ownDay: number | null;
  ownMonth: number | null;
  fixedAmount: number | null;
  note: string;
}

/** Что сделало сохранение назначения с отчётами. */
export interface AssignmentEffect {
  created: number;
  past: number;
  restored: number;
  notRequired: number;
  redue: number;
}

/** Есть ли действующее назначение вида у контрагента. */
export class AssignmentExistsError extends Error {
  constructor(
    readonly contractorId: string,
    readonly reportTypeCode: string,
  ) {
    super(`assignments: ${reportTypeCode} уже назначен контрагенту ${contractorId}`);
    this.name = 'AssignmentExistsError';
  }
}

/** Контрагент в архиве: его назначения и отчёты не меняются (прототип: карточка архивного — только чтение). */
export class ContractorArchivedError extends Error {
  constructor(readonly contractorId: string) {
    super(`reports: контрагент ${contractorId} в архиве`);
    this.name = 'ContractorArchivedError';
  }
}

/** Разовому контрагенту регулярные отчёты не назначаются (ТЗ «Непостоянные контрагенты»). */
export class ContractorOneOffError extends Error {
  constructor(readonly contractorId: string) {
    super(`reports: контрагент ${contractorId} разовый`);
    this.name = 'ContractorOneOffError';
  }
}

/**
 * Контрагент для назначения: в области, заблокирован до конца транзакции, с ответственным и статусом
 * обслуживания. Нет или вне области — `RecordNotFoundError` (до проверок полей, чтобы они не выдали
 * чужого контрагента).
 */
export async function lockAssignee(
  tx: Tx,
  contractorId: string,
  scope: SQL | undefined,
  mode: 'update' | 'share' = 'update',
) {
  if (!UUID_RE.test(contractorId)) throw new RecordNotFoundError('contractor', contractorId);
  const [row] = await tx
    .select({
      id: contractors.id,
      kind: contractors.kind,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      serviceStatus: contractors.serviceStatus,
    })
    .from(contractors)
    .where(and(eq(contractors.id, contractorId), scope))
    .for(mode);
  if (!row) throw new RecordNotFoundError('contractor', contractorId);
  return row;
}

/**
 * Закончившиеся периоды с «с какого периода» до сегодня, кроме тех, отчёты за которые создаёт задача
 * по расписанию, и позже «до какого периода». У разовых видов периодов нет.
 */
function pastStarts(
  rule: EffectiveRule,
  a: { fromMonth: IsoDate; untilMonth: IsoDate | null },
  today: IsoDate,
  calendar: ProductionCalendar,
): IsoDate[] {
  if (rule.oneOff) return [];
  const due = new Set(
    periodsDue(rule, { today, from: a.fromMonth, until: a.untilMonth }, calendar),
  );
  return pastPeriods(rule.period, a.fromMonth, today, rule.skipQuarters).filter(
    (start) => !due.has(start) && (!a.untilMonth || start <= a.untilMonth),
  );
}

/**
 * Прошлые периоды назначения (ТЗ «Если «с какого периода» сдвинуто в прошлое, система предлагает
 * создать недостающие прошлые отчёты»; прототип asgDlg): закончившиеся периоды с «с какого периода»,
 * отчётов за которые нет. С отметкой — сразу «Сдан» (дата сдачи — срок по закону, сумма 0) и, если в
 * учётной политике сдача требует подтверждения, «Подтверждено».
 */
async function createPastReports(
  tx: Tx,
  a: AssignmentRow,
  rule: EffectiveRule,
  context: {
    today: IsoDate;
    calendar: ProductionCalendar;
    responsible: string | null;
    mark: boolean;
    confirm: boolean;
    texts: AssignmentTexts;
  },
): Promise<number> {
  const starts = pastStarts(rule, a, context.today, context.calendar);
  if (starts.length === 0) return 0;
  const values = starts.map((start) => {
    const v = reportValues(rule, start, context.calendar, {
      contractorId: a.contractorId,
      assignmentId: a.id,
      responsibleEmployeeId: context.responsible,
      fixedAmount: a.fixedAmount,
    });
    if (!context.mark) return v;
    return {
      ...v,
      status: 'submitted' as const,
      submittedOn: v.dueBase,
      submittedAt: sql`now()`,
      submittedBy: sql`app.current_user_id()`,
      amount: v.amount ?? 0,
      ...(context.confirm
        ? {
            confirmedAt: sql`now()`,
            confirmedBy: sql`app.current_user_id()`,
            confirmNote: context.texts.pastConfirmNote,
          }
        : {}),
    };
  });
  const inserted: { id: string }[] = [];
  for (let i = 0; i < values.length; i += 1000) {
    inserted.push(
      ...(await tx
        .insert(reports)
        .values(values.slice(i, i + 1000))
        .onConflictDoNothing()
        .returning({ id: reports.id })),
    );
  }
  if (inserted.length) {
    await tx.insert(statusHistory).values(
      inserted.map((r) => ({
        scale: 'report' as const,
        entityId: r.id,
        toStatus: context.mark ? ('submitted' as const) : ('todo' as const),
        reason: !context.mark
          ? context.texts.past
          : context.confirm
            ? context.texts.pastConfirmed
            : context.texts.pastMarked,
      })),
    );
  }
  return inserted.length;
}

/** Поля назначения, которые пишутся в историю создания. */
const assignmentChanges = (a: AssignmentRow): HistoryChange[] =>
  (
    [
      ['reportTypeCode', a.reportTypeCode],
      ['fromMonth', a.fromMonth],
      ['untilMonth', a.untilMonth],
      ['responsibleEmployeeId', a.responsibleEmployeeId],
      ['rate', a.rate],
      ['enRates', a.enRates.length ? a.enRates : null],
      ['rateAdditions', a.rateAdditions.length ? a.rateAdditions : null],
      ['dueDay', a.dueDay],
      ['ownPeriod', a.ownPeriod],
      ['ownDay', a.ownDay],
      ['ownMonth', a.ownMonth],
      ['fixedAmount', a.fixedAmount],
      ['note', a.note || null],
    ] as const
  )
    .filter(([, v]) => v !== null)
    .map(([field, to]) => ({ field, to: to as HistoryChange['to'] }));

/** Правило сроков будущего назначения, календарь и «с какого периода» по умолчанию. */
async function ruleFor(
  tx: Tx,
  input: Pick<
    AssignmentRow,
    'contractorId' | 'reportTypeCode' | 'dueDay' | 'ownPeriod' | 'ownDay' | 'ownMonth'
  >,
  today: IsoDate,
) {
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [input.reportTypeCode]),
    calendarOf(tx),
    statusDueRules(tx, [input.contractorId], today),
  ]);
  const type = types.get(input.reportTypeCode);
  if (!type) throw new RecordNotFoundError('report_type', input.reportTypeCode);
  const rule = assignmentRule(
    type,
    input,
    statuses.get(ruleKey(input.contractorId, input.reportTypeCode)) ?? null,
  );
  return { rule, calendar, defaultFrom: defaultAssignmentFrom(rule, today, calendar) };
}

/** «С какого периода» нового назначения по умолчанию: первый период, за который сегодня должен быть отчёт. */
export async function assignmentDefaultFrom(
  tx: Tx,
  input: Pick<
    AssignmentRow,
    'contractorId' | 'reportTypeCode' | 'dueDay' | 'ownPeriod' | 'ownDay' | 'ownMonth'
  >,
  today: IsoDate,
): Promise<IsoDate> {
  return (await ruleFor(tx, input, today)).defaultFrom;
}

/** Назначение в области сотрудника (через контрагента); null — нет или вне области. */
export async function findAssignment(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<AssignmentRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select({ a: assignments })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .where(and(eq(assignments.id, id), scope));
  return row?.a ?? null;
}

/**
 * Что сделает сохранение назначения с прошлыми периодами (прототип asgDlg: «Назначение начинается в
 * прошлом: нет отчётов за N прошлых периодов… Они будут созданы» и галочка «Сразу отметить прошлые
 * периоды сданными»): «с какого периода» по умолчанию и закончившиеся периоды без отчётов.
 */
export async function assignmentPreview(
  tx: Tx,
  input: Pick<AssignmentInput, 'untilMonth' | 'dueDay' | 'ownPeriod' | 'ownDay' | 'ownMonth'> & {
    contractorId: string;
    reportTypeCode: string;
    fromMonth: IsoDate | null;
  },
  context: { today: IsoDate; scope: SQL | undefined },
): Promise<{
  defaultFrom: IsoDate;
  fromMonth: IsoDate;
  missing: { period: ReportPeriod; start: IsoDate }[];
}> {
  // Предпросмотр только читает: контрагента не меняют, пока он идёт, но и не ждут его.
  await lockAssignee(tx, input.contractorId, context.scope, 'share');
  const { rule, calendar, defaultFrom } = await ruleFor(tx, input, context.today);
  const fromMonth = input.fromMonth ?? defaultFrom;
  const starts = pastStarts(
    rule,
    { fromMonth, untilMonth: input.untilMonth },
    context.today,
    calendar,
  );
  if (starts.length === 0) return { defaultFrom, fromMonth, missing: [] };
  const have = new Set(
    (
      await tx
        .select({ start: reports.periodStart })
        .from(reports)
        .where(
          and(
            eq(reports.contractorId, input.contractorId),
            eq(reports.reportTypeCode, input.reportTypeCode),
            inArray(reports.periodStart, starts),
            isNull(reports.eventDate),
          ),
        )
    ).map((r) => r.start),
  );
  return {
    defaultFrom,
    fromMonth,
    missing: starts.filter((s) => !have.has(s)).map((start) => ({ period: rule.period, start })),
  };
}

/**
 * Назначить вид отчёта контрагенту (ТЗ «Назначение отчётов контрагентам»): один действующий вид у
 * контрагента; отчёты «Не требуется», срок которых не прошёл, возвращаются в «К сдаче»; отчёты на
 * сегодня создаются сразу; прошлые периоды — если «с какого периода» в прошлом.
 */
export async function createAssignment(
  tx: Tx,
  input: Omit<AssignmentInput, 'fromMonth'> & {
    contractorId: string;
    reportTypeCode: string;
    /** Пусто — первый период, за который сегодня должен быть отчёт (`defaultAssignmentFrom`). */
    fromMonth: IsoDate | null;
  },
  context: {
    today: IsoDate;
    scope: SQL | undefined;
    markPast: boolean;
    confirm: boolean;
    texts: AssignmentTexts;
  },
): Promise<{ assignment: AssignmentRow; effect: AssignmentEffect }> {
  const cp = await lockAssignee(tx, input.contractorId, context.scope);
  if (cp.serviceStatus === 'archived') throw new ContractorArchivedError(input.contractorId);
  if (cp.kind === 'oneoff') throw new ContractorOneOffError(input.contractorId);
  const fromMonth = input.fromMonth ?? (await ruleFor(tx, input, context.today)).defaultFrom;
  const [existing] = await tx
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.contractorId, input.contractorId),
        eq(assignments.reportTypeCode, input.reportTypeCode),
        isNull(assignments.endedOn),
      ),
    );
  if (existing) throw new AssignmentExistsError(input.contractorId, input.reportTypeCode);
  const [a] = await tx
    .insert(assignments)
    .values({
      contractorId: input.contractorId,
      reportTypeCode: input.reportTypeCode,
      fromMonth,
      untilMonth: input.untilMonth,
      responsibleEmployeeId: input.responsibleEmployeeId,
      rate: input.rate,
      enRates: [...input.enRates],
      rateAdditions: [...input.rateAdditions],
      dueDay: input.dueDay,
      ownPeriod: input.ownPeriod,
      ownDay: input.ownDay,
      ownMonth: input.ownMonth,
      fixedAmount: input.fixedAmount,
      note: input.note,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning();
  await writeHistory(tx, {
    entity: 'assignment',
    entityId: a!.id,
    action: 'create',
    changes: assignmentChanges(a!),
    contractorId: input.contractorId,
  });
  const effect = await applyAssignment(tx, a!, cp.responsibleEmployeeId, {
    ...context,
    restore: true,
    redue: false,
  });
  return { assignment: a!, effect };
}

/**
 * Отчёты после сохранения назначения: возврат «Не требуется» (при новом назначении), «Не требуется» позже
 * «до какого периода», у остальных несданных — назначение, ответственный, сроки по новому правилу (кроме
 * изменённых вручную и разовых) и повторяющаяся сумма; затем отчёты на сегодня и прошлые.
 */
async function applyAssignment(
  tx: Tx,
  a: AssignmentRow,
  contractorResponsible: string | null,
  context: {
    today: IsoDate;
    markPast: boolean;
    confirm: boolean;
    texts: AssignmentTexts;
    restore: boolean;
    redue: boolean;
    amountChanged?: boolean;
  },
): Promise<AssignmentEffect> {
  const { today } = context;
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [a.reportTypeCode]),
    calendarOf(tx),
    statusDueRules(tx, [a.contractorId], today),
  ]);
  const type = types.get(a.reportTypeCode)!;
  const rule = assignmentRule(
    type,
    a,
    statuses.get(ruleKey(a.contractorId, a.reportTypeCode)) ?? null,
  );
  const responsible = a.responsibleEmployeeId ?? contractorResponsible;
  const effect: AssignmentEffect = { created: 0, past: 0, restored: 0, notRequired: 0, redue: 0 };
  const existing = await lockTypeReports(tx, a.contractorId, a.reportTypeCode);
  const inRange = (start: IsoDate) =>
    start >= periodStartOf(rule.period, a.fromMonth) && (!a.untilMonth || start <= a.untilMonth);
  const touched = new Set<string>();

  if (context.restore) {
    const back = existing.filter(
      (r) =>
        restoredByAssignment(
          { status: r.status, dueDate: r.dueDate, submitted: r.submittedOn !== null },
          today,
        ) && inRange(r.periodStart),
    );
    await setStatuses(tx, back, 'todo', context.texts.restored);
    for (const r of back) {
      r.status = 'todo';
      touched.add(r.id);
    }
    effect.restored = back.length;
  }

  if (a.untilMonth) {
    const after = existing.filter(
      (r) => OPEN_REPORT_STATUSES.has(r.status) && r.periodStart > a.untilMonth!,
    );
    await setStatuses(tx, after, 'not_required', context.texts.until);
    for (const r of after) r.status = 'not_required';
    effect.notRequired = after.length;
  }

  const auto = a.fixedAmount !== null && type.act !== 'sub';
  for (const r of existing) {
    if (!OPEN_REPORT_STATUSES.has(r.status) || !(context.redue || touched.has(r.id))) continue;
    const set: Partial<typeof reports.$inferInsert> = {};
    if (r.responsibleEmployeeId !== responsible) set.responsibleEmployeeId = responsible;
    if (r.assignmentId !== null && r.assignmentId !== a.id) set.assignmentId = a.id;
    if (!r.dueManual && !r.eventDate && r.period === rule.period) {
      const d = reportDue(rule, { period: r.period, start: r.periodStart }, calendar);
      if (d.due !== r.dueDate) effect.redue++;
      if (d.base !== r.dueBase || d.due !== r.dueDate || d.payDue !== r.payDue) {
        Object.assign(set, { dueBase: d.base, dueDate: d.due, payDue: d.payDue });
      }
    }
    // Повторяющаяся сумма — в несданные без суммы или с прежней подставленной.
    if (context.amountChanged && auto && (r.amount === null || r.amountAuto)) {
      Object.assign(set, { amount: a.fixedAmount, amountAuto: true });
    }
    if (Object.keys(set).length === 0) continue;
    await tx
      .update(reports)
      .set({
        ...set,
        version: sql`${reports.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(reports.id, r.id));
  }

  effect.created = await createDueReports(tx, { today, assignmentIds: [a.id], calendar });
  effect.past = await createPastReports(tx, a, rule, {
    today,
    calendar,
    responsible,
    mark: context.markPast,
    confirm: context.confirm,
    texts: context.texts,
  });
  return effect;
}

/** Назначение в области сотрудника (через контрагента), заблокированное до конца транзакции. */
async function lockAssignment(tx: Tx, id: string, scope: SQL | undefined) {
  if (!UUID_RE.test(id)) throw new RecordNotFoundError('assignment', id);
  const [row] = await tx
    .select({
      a: assignments,
      contractorResponsible: contractors.responsibleEmployeeId,
      serviceStatus: contractors.serviceStatus,
    })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .where(and(eq(assignments.id, id), scope))
    // Контрагент тоже: ответственный и статус обслуживания не меняются до конца сохранения.
    .for('update', { of: [assignments, contractors] });
  if (!row) throw new RecordNotFoundError('assignment', id);
  return row;
}

/** Назначение изменено другим пользователем после того, как его открыли. */
export class AssignmentChangedError extends RecordChangedError {
  constructor(id: string, currentVersion: number) {
    super('assignment', id, currentVersion);
    this.name = 'AssignmentChangedError';
  }
}

/** Снятое назначение не меняется. */
export class AssignmentEndedError extends Error {
  constructor(readonly id: string) {
    super(`assignments: ${id} снято`);
    this.name = 'AssignmentEndedError';
  }
}

/** Поля назначения со своей периодичностью и сроком: их смена пересоздаёт несданные отчёты. */
const OWN_RULE_FIELDS = new Set(['ownPeriod', 'ownDay', 'ownMonth']);

/**
 * «Изменить» назначение (ТЗ: с какого периода, до какого, ответственный, вариант срока, ставка,
 * повторяющаяся сумма, примечание; прототип asgDlg): несданные отчёты получают нового ответственного и
 * сроки по новому правилу (кроме изменённых вручную и разовых), отчёты позже «до какого периода» — «Не
 * требуется», прошлые периоды — если «с какого периода» сдвинуто в прошлое.
 */
export async function updateAssignment(
  tx: Tx,
  id: string,
  patch: Partial<AssignmentInput>,
  context: {
    version: number;
    today: IsoDate;
    scope: SQL | undefined;
    markPast: boolean;
    confirm: boolean;
    texts: AssignmentTexts;
  },
): Promise<{ assignment: AssignmentRow; effect: AssignmentEffect }> {
  const {
    a: before,
    contractorResponsible,
    serviceStatus,
  } = await lockAssignment(tx, id, context.scope);
  if (before.version !== context.version) throw new AssignmentChangedError(id, before.version);
  if (before.endedOn) throw new AssignmentEndedError(id);
  if (serviceStatus === 'archived') throw new ContractorArchivedError(before.contractorId);
  const next = { ...before, ...patch } as AssignmentRow;
  const fields = [
    'fromMonth',
    'untilMonth',
    'responsibleEmployeeId',
    'rate',
    'enRates',
    'rateAdditions',
    'dueDay',
    'ownPeriod',
    'ownDay',
    'ownMonth',
    'fixedAmount',
    'note',
  ] as const;
  const changes: HistoryChange[] = fields
    .filter((f) => JSON.stringify(before[f]) !== JSON.stringify(next[f]))
    .map((f) => ({
      field: f,
      from: before[f] as HistoryChange['from'],
      to: next[f] as HistoryChange['to'],
    }));
  if (changes.length === 0) {
    return {
      assignment: before,
      effect: { created: 0, past: 0, restored: 0, notRequired: 0, redue: 0 },
    };
  }
  const [a] = await tx
    .update(assignments)
    .set({
      ...Object.fromEntries(fields.map((f) => [f, next[f]])),
      version: sql`${assignments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(assignments.id, id))
    .returning();
  await writeHistory(tx, {
    entity: 'assignment',
    entityId: id,
    action: 'update',
    changes,
    contractorId: before.contractorId,
  });
  // Новые периодичность или срок в назначении: несданные первичные отчёты этого назначения со сроком с
  // сегодняшнего дня удаляются и создаются заново по новому правилу (прототип asgDlg, «Настроить»).
  // Разовые и с изменённым вручную сроком остаются со своим журналом (docs/decisions.md п. А-2).
  if (changes.some((c) => OWN_RULE_FIELDS.has(c.field))) {
    const gone = await tx
      .delete(reports)
      .where(
        and(
          eq(reports.assignmentId, id),
          inArray(reports.status, ['todo', 'in_progress']),
          gte(reports.dueDate, context.today),
          eq(reports.revision, 0),
          eq(reports.dueManual, false),
        ),
      )
      .returning({ id: reports.id });
    await writeHistory(
      tx,
      ...gone.map((r) => ({
        entity: 'report' as const,
        entityId: r.id,
        action: 'delete' as const,
        reason: context.texts.ownRuleChanged,
        contractorId: before.contractorId,
      })),
    );
  }
  const effect = await applyAssignment(tx, a!, contractorResponsible, {
    ...context,
    restore: false,
    redue: true,
    amountChanged: changes.some((c) => c.field === 'fixedAmount'),
  });
  return { assignment: a!, effect };
}

/**
 * Снять назначение (ТЗ «Снять назначение — значит указать дату окончания; сданные отчёты остаются,
 * будущие несданные получают статус «Не требуется»»; прототип unassignDlg): с сегодняшнего дня.
 */
export async function endAssignment(
  tx: Tx,
  id: string,
  context: { version: number; today: IsoDate; scope: SQL | undefined; texts: AssignmentTexts },
): Promise<{ assignment: AssignmentRow; notRequired: number }> {
  const { a: before, serviceStatus } = await lockAssignment(tx, id, context.scope);
  if (before.version !== context.version) throw new AssignmentChangedError(id, before.version);
  if (serviceStatus === 'archived') throw new ContractorArchivedError(before.contractorId);
  if (before.endedOn) throw new AssignmentEndedError(id);
  const [a] = await tx
    .update(assignments)
    .set({
      endedOn: context.today,
      version: sql`${assignments.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(assignments.id, id))
    .returning();
  await writeHistory(tx, {
    entity: 'assignment',
    entityId: id,
    action: 'update',
    changes: [{ field: 'endedOn', from: null, to: context.today }],
    contractorId: before.contractorId,
  });
  const open = (await lockTypeReports(tx, before.contractorId, before.reportTypeCode)).filter((r) =>
    endsWithAssignment({ status: r.status, dueDate: r.dueDate }, context.today),
  );
  await setStatuses(tx, open, 'not_required', context.texts.ended);
  return { assignment: a!, notRequired: open.length };
}

/** Назначение для экрана: поля, как называется вид, ставка словами и ответственный. */
export interface AssignmentRecord {
  id: string;
  contractorId: string;
  reportTypeCode: string;
  reportTypeName: string;
  reportTypeShort: string;
  fromMonth: IsoDate;
  untilMonth: IsoDate | null;
  endedOn: IsoDate | null;
  responsibleEmployeeId: string | null;
  /** Ответственный назначения, иначе — ответственный контрагента. */
  responsible: { id: string; shortName: string } | null;
  rate: string | null;
  enRates: AssignmentEnRate[];
  rateAdditions: string[];
  /** Ставка словами на сегодня (прототип aRateTxt); пусто — без ставки. */
  rateText: string;
  /** Орган, куда сдаётся вид. */
  authority: string;
  /** Срок сдачи словами по действующему правилу (прототип ruleText ∘ tEff). */
  dueText: string;
  /** Статус контрагента, который задаёт срок (метка «по статусу»); null — срок вида или назначения. */
  dueStatus: { code: string; name: string } | null;
  /** Периодичность отчётов назначения (у вида с периодичностью в назначении — своя). */
  period: ReportPeriod;
  periodInAssignment: boolean;
  oneOff: boolean;
  act: ReportAct;
  /** Вид действует в каталоге платформы; false — метка «Вид отключён». */
  typeActive: boolean;
  dueDay: number | null;
  ownPeriod: ReportPeriod | null;
  ownDay: number | null;
  ownMonth: number | null;
  fixedAmount: number | null;
  note: string;
  version: number;
}

const assignee = alias(employees, 'assignee');

/** Назначения контрагента (в области): сначала действующие, по виду. */
export async function listAssignments(
  tx: Tx,
  contractorId: string,
  context: { scope: SQL | undefined; today: IsoDate; t: Translate },
): Promise<AssignmentRecord[]> {
  if (!UUID_RE.test(contractorId)) throw new RecordNotFoundError('contractor', contractorId);
  const [cp] = await tx
    .select({ id: contractors.id, responsibleEmployeeId: contractors.responsibleEmployeeId })
    .from(contractors)
    .where(and(eq(contractors.id, contractorId), context.scope));
  if (!cp) throw new RecordNotFoundError('contractor', contractorId);
  const [rows, rates, statuses] = await Promise.all([
    tx
      .select({
        a: assignments,
        typeName: reportTypes.name,
        typeShort: reportTypes.shortName,
        typeAdditions: reportTypes.rateAdditions,
        typeActive: reportTypes.active,
        authority: authorities.name,
        responsibleName: assignee.shortName,
      })
      .from(assignments)
      .innerJoin(reportTypes, eq(reportTypes.code, assignments.reportTypeCode))
      .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
      .leftJoin(
        assignee,
        eq(
          assignee.id,
          sql`coalesce(${assignments.responsibleEmployeeId}, ${cp.responsibleEmployeeId}::uuid)`,
        ),
      )
      .where(eq(assignments.contractorId, contractorId))
      .orderBy(
        sql`${assignments.endedOn} is not null`,
        asc(reportTypes.sortOrder),
        asc(assignments.createdAt),
      ),
    tx
      .select({
        code: singleTaxRates.code,
        rate: singleTaxRates.rate,
        rateCashless: singleTaxRates.rateCashless,
        rateCash: singleTaxRates.rateCash,
      })
      .from(singleTaxRates),
    statusDueRules(tx, [contractorId], context.today),
  ]);
  const types = await reportTypeInfos(tx, [...new Set(rows.map((r) => r.a.reportTypeCode))]);
  const benefitNames = new Map(
    (
      await tx
        .select({ code: taxBenefits.code, name: taxBenefits.name })
        .from(taxBenefits)
        .where(
          inArray(taxBenefits.code, [
            ...new Set([...statuses.values()].map((x) => x.benefitCode)),
            '',
          ]),
        )
    ).map((b) => [b.code, b.name]),
  );
  return rows.map(
    ({ a, typeName, typeShort, typeAdditions, typeActive, authority, responsibleName }) => {
      const responsibleId = a.responsibleEmployeeId ?? cp.responsibleEmployeeId;
      const type = types.get(a.reportTypeCode)!;
      const rule = assignmentRule(
        type,
        a,
        statuses.get(ruleKey(contractorId, a.reportTypeCode)) ?? null,
      );
      return {
        id: a.id,
        contractorId: a.contractorId,
        reportTypeCode: a.reportTypeCode,
        reportTypeName: typeName,
        reportTypeShort: typeShort,
        fromMonth: a.fromMonth,
        untilMonth: a.untilMonth,
        endedOn: a.endedOn,
        responsibleEmployeeId: a.responsibleEmployeeId,
        responsible: responsibleId ? { id: responsibleId, shortName: responsibleName ?? '' } : null,
        rate: a.rate,
        enRates: a.enRates,
        rateAdditions: a.rateAdditions,
        rateText: assignmentRateText(
          a,
          { rateAdditions: typeAdditions },
          rates,
          {
            date: context.today,
          },
          context.t,
        ),
        authority,
        dueText: dueRuleText(rule, context.t),
        dueStatus: rule.benefitCode
          ? { code: rule.benefitCode, name: benefitNames.get(rule.benefitCode) ?? rule.benefitCode }
          : null,
        period: rule.period,
        periodInAssignment: periodInAssignment(type),
        oneOff: type.oneOff,
        act: type.act,
        typeActive,
        dueDay: a.dueDay,
        ownPeriod: a.ownPeriod,
        ownDay: a.ownDay,
        ownMonth: a.ownMonth,
        fixedAmount: a.fixedAmount,
        note: a.note,
        version: a.version,
      };
    },
  );
}

/**
 * Незавершённые отчёты переходят к новому ответственному контрагента (прототип transferCp): те, что
 * были за прежним ответственным или ни за кем. Отчёты, назначенные другому сотруднику (Соцфонд ведёт
 * кадровик), остаются за ним.
 */
export async function moveUnfinishedReports(
  tx: Tx,
  moves: readonly { contractorId: string; from: string | null; to: string }[],
): Promise<number> {
  let moved = 0;
  for (const m of moves) {
    const rows = await tx
      .update(reports)
      .set({
        responsibleEmployeeId: m.to,
        version: sql`${reports.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(
        and(
          eq(reports.contractorId, m.contractorId),
          unfinishedSql(),
          m.from
            ? or(eq(reports.responsibleEmployeeId, m.from), isNull(reports.responsibleEmployeeId))
            : isNull(reports.responsibleEmployeeId),
        ),
      )
      .returning({ id: reports.id });
    moved += rows.length;
  }
  return moved;
}

/** Условие «незавершённый отчёт» (`reportUnfinished`) в SQL. */
function unfinishedSql(): SQL {
  return and(
    eq(reports.superseded, false),
    ne(reports.status, 'not_required'),
    ne(reports.status, 'submitted'),
  )!;
}

/** Сколько незавершённых отчётов перейдёт при передаче контрагентов сотрудника (прототип transferDlg). */
export async function unfinishedReportsCount(
  tx: Tx,
  contractorIds: readonly string[],
  fromEmployeeId: string,
): Promise<number> {
  if (contractorIds.length === 0) return 0;
  const [row] = await tx
    .select({ n: count() })
    .from(reports)
    .where(
      and(
        inArray(reports.contractorId, [...contractorIds]),
        unfinishedSql(),
        or(
          eq(reports.responsibleEmployeeId, fromEmployeeId),
          isNull(reports.responsibleEmployeeId),
        ),
      ),
    );
  return row?.n ?? 0;
}

/** Причины пересчёта срока в истории отчёта (прототип cpRedue): шаблоны с `{name}` — название статуса. */
export interface RedueTexts {
  /** «Срок по статусу «…»». */
  byStatus: string;
  /** «Срок по каталогу». */
  byCatalog: string;
  /** «Срок по каталогу (снят статус «…»)». */
  byCatalogDropped: string;
}

/**
 * Сроки несданных отчётов контрагента по его статусам на сегодня (прототип cpRedueList, cpRedue): при
 * установке или снятии статуса со своим сроком; изменённые вручную и разовые не трогаются. Каждый
 * изменённый отчёт — запись в его историю «было → стало» с причиной: срок по статусу или по каталогу;
 * `was` — статусы со своим сроком до правки (от них — «снят статус «…»»).
 */
export async function redueContractorReports(
  tx: Tx,
  contractorId: string,
  today: IsoDate,
  context: { was: Map<string, StatusDueRule>; texts: RedueTexts },
): Promise<number> {
  const rows = await tx
    .select({ r: reports, a: assignments })
    .from(reports)
    .leftJoin(assignments, eq(assignments.id, reports.assignmentId))
    .where(
      and(
        eq(reports.contractorId, contractorId),
        inArray(reports.status, [...OPEN_REPORT_STATUSES]),
        eq(reports.superseded, false),
        eq(reports.dueManual, false),
        isNull(reports.eventDate),
      ),
    )
    .for('update', { of: reports });
  if (rows.length === 0) return 0;
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [...new Set(rows.map((x) => x.r.reportTypeCode))]),
    calendarOf(tx),
    statusDueRules(tx, [contractorId], today),
  ]);
  const codes = [...statuses.values(), ...context.was.values()].map((b) => b.benefitCode);
  const names = new Map(
    codes.length
      ? (
          await tx
            .select({ code: taxBenefits.code, name: taxBenefits.name })
            .from(taxBenefits)
            .where(inArray(taxBenefits.code, [...new Set(codes)]))
        ).map((b) => [b.code, b.name])
      : [],
  );
  const named = (template: string, code: string) =>
    template.replace('{name}', names.get(code) ?? code);
  const ruleOf = (type: ReportTypeInfo, a: AssignmentRow | null, status: StatusDueRule | null) =>
    a ? assignmentRule(type, a, status) : effectiveRule(type, null, status);
  let changed = 0;
  for (const { r, a } of rows) {
    const type = types.get(r.reportTypeCode);
    if (!type) continue;
    const key = ruleKey(contractorId, r.reportTypeCode);
    const rule = ruleOf(type, a, statuses.get(key) ?? null);
    if (rule.period !== r.period) continue;
    const d = reportDue(rule, { period: r.period, start: r.periodStart }, calendar);
    if (d.due === r.dueDate && d.base === r.dueBase && d.payDue === r.payDue) continue;
    await tx
      .update(reports)
      .set({
        dueBase: d.base,
        dueDate: d.due,
        payDue: d.payDue,
        version: sql`${reports.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(reports.id, r.id));
    const dropped = ruleOf(type, a, context.was.get(key) ?? null).benefitCode;
    await writeHistory(tx, {
      entity: 'report',
      entityId: r.id,
      action: 'update',
      changes: [
        ...(d.due !== r.dueDate ? [{ field: 'dueDate', from: r.dueDate, to: d.due }] : []),
        ...(d.payDue !== r.payDue ? [{ field: 'payDue', from: r.payDue, to: d.payDue }] : []),
      ],
      reason: rule.benefitCode
        ? named(context.texts.byStatus, rule.benefitCode)
        : dropped
          ? named(context.texts.byCatalogDropped, dropped)
          : context.texts.byCatalog,
      contractorId,
    });
    changed++;
  }
  return changed;
}

/** Сколько отчётов у контрагента (для запрета удаления). */
export async function contractorReportCount(tx: Tx, contractorId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(reports)
    .where(eq(reports.contractorId, contractorId));
  return row?.n ?? 0;
}

/** Сколько действующих назначений вида у контрагентов на обслуживании (вкладка «Виды отчётов»). */
export async function activeAssignmentCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx
    .select({ code: assignments.reportTypeCode, n: count() })
    .from(assignments)
    .innerJoin(contractors, eq(contractors.id, assignments.contractorId))
    .where(and(isNull(assignments.endedOn), ne(contractors.serviceStatus, 'archived')))
    .groupBy(assignments.reportTypeCode);
  return new Map(rows.map((r) => [r.code, r.n]));
}

/** Отчёт изменён другим пользователем после того, как его открыли. */
export class ReportChangedError extends RecordChangedError {
  constructor(id: string, currentVersion: number) {
    super('report', id, currentVersion);
    this.name = 'ReportChangedError';
  }
}

/** Такой отчёт уже есть: контрагент + вид + период (дата события) + версия. */
export class ReportExistsError extends Error {
  constructor(
    readonly contractorId: string,
    readonly reportTypeCode: string,
  ) {
    super(`reports: ${reportTypeCode} за этот период у контрагента ${contractorId} уже есть`);
    this.name = 'ReportExistsError';
  }
}

/** Действие недоступно в этом статусе отчёта (срок сданного, уточнённый несданного). */
export class ReportStateError extends Error {
  constructor(
    readonly id: string,
    readonly reason: 'not_open' | 'not_submitted' | 'superseded' | 'pay_only',
  ) {
    super(`reports: ${id} — ${reason}`);
    this.name = 'ReportStateError';
  }
}

/** Правило сроков отчёта на сегодня: вид, его назначение и статус контрагента. */
async function reportRule(
  tx: Tx,
  r: typeof reports.$inferSelect,
  today: IsoDate,
): Promise<EffectiveRule | null> {
  const [types, assignment, statuses] = await Promise.all([
    reportTypeInfos(tx, [r.reportTypeCode]),
    r.assignmentId
      ? tx
          .select()
          .from(assignments)
          .where(eq(assignments.id, r.assignmentId))
          .then(([a]) => a ?? null)
      : null,
    statusDueRules(tx, [r.contractorId], today),
  ]);
  const type = types.get(r.reportTypeCode);
  if (!type) return null;
  const status = statuses.get(ruleKey(r.contractorId, r.reportTypeCode)) ?? null;
  return assignment ? assignmentRule(type, assignment, status) : effectiveRule(type, null, status);
}

/**
 * Срок оплаты идёт за сроком сдачи (прототип `schedule`: у вида без своего правила оплаты срок оплаты —
 * нынешний срок сдачи, в том числе изменённый вручную и у уточнённого; у разового — от даты события).
 */
const payFollowsDue = (rule: EffectiveRule | null, r: typeof reports.$inferSelect) =>
  r.payDue !== null && (r.eventDate !== null || !rule || rule.payDay === null);

/** Отчёт в области сотрудника (через контрагента), заблокированный до конца транзакции. */
async function lockReport(tx: Tx, id: string, scope: SQL | undefined) {
  if (!UUID_RE.test(id)) throw new RecordNotFoundError('report', id);
  const [row] = await tx
    .select({ r: reports })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .where(and(eq(reports.id, id), scope))
    .for('update', { of: reports });
  if (!row) throw new RecordNotFoundError('report', id);
  return row.r;
}

/**
 * «Изменить срок» (ТЗ: новый срок, причина из справочника платформы, комментарий; запись в историю
 * отчёта; прототип dueEditDlg): только у несданного отчёта со сдачей. Изменённый вручную срок не
 * пересчитывается при изменении правил вида и календаря.
 */
export async function changeReportDue(
  tx: Tx,
  id: string,
  input: { due: IsoDate; reasonCode: string; reasonName: string; comment: string },
  context: { version: number; today: IsoDate; scope: SQL | undefined },
): Promise<typeof reports.$inferSelect> {
  const r = await lockReport(tx, id, context.scope);
  if (r.version !== context.version) throw new ReportChangedError(id, r.version);
  if (r.superseded) throw new ReportStateError(id, 'superseded');
  if (!OPEN_REPORT_STATUSES.has(r.status)) throw new ReportStateError(id, 'not_open');
  if (r.act === 'pay') throw new ReportStateError(id, 'pay_only');
  if (input.due === r.dueDate) return r;
  const payDue = payFollowsDue(await reportRule(tx, r, context.today), r) ? input.due : r.payDue;
  const [updated] = await tx
    .update(reports)
    .set({
      dueDate: input.due,
      dueManual: true,
      payDue,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(reports.id, id))
    .returning();
  await tx.insert(reportDueChanges).values({
    reportId: id,
    fromDue: r.dueDate,
    toDue: input.due,
    reasonCode: input.reasonCode,
    comment: input.comment,
  });
  await writeHistory(tx, {
    entity: 'report',
    entityId: id,
    action: 'update',
    changes: [
      { field: 'dueDate', from: r.dueDate, to: input.due },
      ...(payDue !== r.payDue ? [{ field: 'payDue', from: r.payDue, to: payDue }] : []),
    ],
    reason: input.comment ? `${input.reasonName}, ${input.comment}` : input.reasonName,
    contractorId: r.contractorId,
  });
  return updated!;
}

/** Ввод «Разового отчёта». */
export interface ManualReportInput {
  contractorId: string;
  reportTypeCode: string;
  /** Месяц периода (первое число); у разового вида — пусто, вместо него дата события. */
  month: IsoDate | null;
  eventDate: IsoDate | null;
  /** Срок сдачи; у разового вида пусто — по правилу вида от даты события. */
  due: IsoDate | null;
  reasonCode: string;
  reasonName: string;
}

/**
 * «+ Добавить» → «Разовый отчёт» (ТЗ: контрагент, вид из подключённых, месяц периода — для квартальных
 * и годовых их период; у разового вида — дата события, срок от неё; причина из справочника; в историю
 * «Создан вручную (причина)»; прототип adhocDlg). Ответственный — ответственный контрагента;
 * повторяющаяся сумма действующего назначения вида подставляется, как у отчёта по назначению.
 */
export async function createManualReport(
  tx: Tx,
  input: ManualReportInput,
  context: { today: IsoDate; scope: SQL | undefined },
): Promise<typeof reports.$inferSelect> {
  const cp = await lockAssignee(tx, input.contractorId, context.scope);
  if (cp.serviceStatus === 'archived') throw new ContractorArchivedError(input.contractorId);
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [input.reportTypeCode]),
    calendarOf(tx),
    statusDueRules(tx, [input.contractorId], context.today),
  ]);
  const type = types.get(input.reportTypeCode)!;
  const [active] = await tx
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.contractorId, input.contractorId),
        eq(assignments.reportTypeCode, input.reportTypeCode),
        isNull(assignments.endedOn),
      ),
    );
  const rule = effectiveRule(
    type,
    null,
    statuses.get(ruleKey(input.contractorId, input.reportTypeCode)) ?? null,
  );
  const event = type.oneOff ? input.eventDate! : null;
  const ref = event
    ? { period: 'M' as const, start: periodStartOf('M', event), event }
    : { period: rule.period, start: periodStartOf(rule.period, input.month!) };
  const computed = reportDue(rule, ref, calendar);
  const due = input.due ?? computed.due;
  const [clash] = await tx
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, input.contractorId),
        eq(reports.reportTypeCode, input.reportTypeCode),
        eq(reports.periodStart, ref.start),
        event ? eq(reports.eventDate, event) : isNull(reports.eventDate),
        eq(reports.superseded, false),
      ),
    );
  if (clash) throw new ReportExistsError(input.contractorId, input.reportTypeCode);
  const fixed = active?.fixedAmount ?? null;
  const auto = fixed !== null && type.act !== 'sub';
  const payDue = type.act === 'sub' ? null : rule.payDay === null || event ? due : computed.payDue;
  const [created] = await tx
    .insert(reports)
    .values({
      contractorId: input.contractorId,
      reportTypeCode: input.reportTypeCode,
      assignmentId: null,
      period: ref.period,
      periodStart: ref.start,
      eventDate: event,
      act: type.act,
      // У разового вида срок по закону — от даты события; у остального срок задают руками.
      dueBase: event ? computed.base : due,
      dueDate: due,
      dueManual: event ? due !== computed.due : false,
      payDue,
      amount: auto ? fixed : null,
      amountAuto: auto,
      responsibleEmployeeId: cp.responsibleEmployeeId,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) throw new ReportExistsError(input.contractorId, input.reportTypeCode);
  await tx
    .insert(statusHistory)
    .values({ scale: 'report', entityId: created.id, toStatus: 'todo' });
  await tx.insert(reportDueChanges).values({
    reportId: created.id,
    fromDue: null,
    toDue: due,
    reasonCode: input.reasonCode,
  });
  await writeHistory(tx, {
    entity: 'report',
    entityId: created.id,
    action: 'create',
    changes: [
      { field: 'reportTypeCode', to: created.reportTypeCode },
      { field: 'periodStart', to: created.periodStart },
      ...(event ? [{ field: 'eventDate', to: event }] : []),
      { field: 'dueDate', to: due },
    ],
    reason: input.reasonName,
    contractorId: input.contractorId,
  });
  return created;
}

/** Что можно выбрать в окне «Разовый отчёт». */
export interface ManualReportOptions {
  /** Контрагенты в области «Свои» группы «Отчеты для сдачи», кроме архивных (прототип visCps). */
  contractors: { id: string; name: string }[];
  /** Подключённые в организации и действующие виды по порядку каталога, с правилом срока. */
  types: (DueRule & {
    code: string;
    name: string;
    shortName: string;
    eventLabel: string;
  })[];
}

/** Списки окна «Разовый отчёт» (прототип adhocDlg). */
export async function manualReportOptions(
  tx: Tx,
  scope: SQL | undefined,
): Promise<ManualReportOptions> {
  const [cps, types] = await Promise.all([
    tx
      .select({ id: contractors.id, name: contractors.name })
      .from(contractors)
      .where(and(ne(contractors.serviceStatus, 'archived'), scope))
      .orderBy(asc(contractors.name), asc(contractors.id)),
    tx
      .select({
        code: reportTypes.code,
        name: reportTypes.name,
        shortName: reportTypes.shortName,
        act: reportTypes.act,
        oneOff: reportTypes.oneOff,
        eventLabel: reportTypes.eventLabel,
        period: reportTypes.period,
        dueDay: reportTypes.dueDay,
        dueAfter: reportTypes.dueAfter,
        dueMonth: reportTypes.dueMonth,
        dueFrom: reportTypes.dueFrom,
      })
      .from(reportTypes)
      .innerJoin(orgReportTypes, eq(orgReportTypes.reportTypeCode, reportTypes.code))
      .where(and(eq(orgReportTypes.enabled, true), eq(reportTypes.active, true)))
      .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code)),
  ]);
  return { contractors: cps, types };
}

/**
 * Срок «Разового отчёта» разового вида по дате события — до сохранения (прототип adhocDlg, `evDue`):
 * правило вида и статуса контрагента, перенос с нерабочего дня — как при создании. null — вид не
 * разовый или его нет. Контрагент вне области — `RecordNotFoundError`, архивный —
 * `ContractorArchivedError`, как при создании.
 */
export async function manualReportDue(
  tx: Tx,
  input: { contractorId: string; reportTypeCode: string; eventDate: IsoDate },
  context: { today: IsoDate; scope: SQL | undefined },
): Promise<IsoDate | null> {
  const cp = await lockAssignee(tx, input.contractorId, context.scope, 'share');
  if (cp.serviceStatus === 'archived') throw new ContractorArchivedError(input.contractorId);
  const [types, calendar, statuses] = await Promise.all([
    reportTypeInfos(tx, [input.reportTypeCode]),
    calendarOf(tx),
    statusDueRules(tx, [input.contractorId], context.today),
  ]);
  const type = types.get(input.reportTypeCode);
  if (!type?.oneOff) return null;
  const rule = effectiveRule(
    type,
    null,
    statuses.get(ruleKey(input.contractorId, input.reportTypeCode)) ?? null,
  );
  const ref = {
    period: 'M' as const,
    start: periodStartOf('M', input.eventDate),
    event: input.eventDate,
  };
  return reportDue(rule, ref, calendar).due;
}

/**
 * «Создать уточнённый» (ТЗ «Уточнённые отчёты»; прототип createRevision): у сданного отчёта — новая
 * версия того же периода со своей суммой, сроком и статусами; срок — не раньше прежнего и не раньше
 * чем через 10 дней; прежняя версия не меняется и уходит из списка по умолчанию.
 */
export async function createRevision(
  tx: Tx,
  id: string,
  context: { version: number; today: IsoDate; scope: SQL | undefined },
): Promise<typeof reports.$inferSelect> {
  const r = await lockReport(tx, id, context.scope);
  if (r.version !== context.version) throw new ReportChangedError(id, r.version);
  if (r.superseded) throw new ReportStateError(id, 'superseded');
  // У вида «Уплата» статуса сдачи нет — нет и уточнённого (прототип: статус «—», кнопки нет).
  if (r.act === 'pay') throw new ReportStateError(id, 'pay_only');
  if (r.status !== 'submitted') throw new ReportStateError(id, 'not_submitted');
  const due = revisionDue(r.dueDate, context.today);
  const follows = payFollowsDue(await reportRule(tx, r, context.today), r);
  const [created] = await tx
    .insert(reports)
    .values({
      contractorId: r.contractorId,
      reportTypeCode: r.reportTypeCode,
      assignmentId: r.assignmentId,
      period: r.period,
      periodStart: r.periodStart,
      eventDate: r.eventDate,
      act: r.act,
      revision: r.revision + 1,
      dueBase: due,
      dueDate: due,
      // Срок оплаты своим правилом вида остаётся прежним, иначе — как новый срок сдачи.
      payDue: follows ? due : r.payDue,
      responsibleEmployeeId: r.responsibleEmployeeId,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning();
  await tx
    .update(reports)
    .set({
      superseded: true,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(reports.id, id));
  await tx
    .insert(statusHistory)
    .values({ scale: 'report', entityId: created!.id, toStatus: 'todo' });
  await writeHistory(
    tx,
    {
      entity: 'report',
      entityId: id,
      action: 'update',
      changes: [{ field: 'superseded', from: false, to: true }],
      contractorId: r.contractorId,
    },
    {
      entity: 'report',
      entityId: created!.id,
      action: 'create',
      changes: [
        { field: 'revision', to: created!.revision },
        { field: 'dueDate', to: due },
      ],
      contractorId: r.contractorId,
    },
  );
  return created!;
}
