import {
  effectiveRule,
  OPEN_REPORT_STATUSES,
  reportDue,
  type IsoDate,
  type ProductionCalendar,
  type ReportPeriod,
  type StatusDueRule,
} from '@buhuchet/domain';
import { and, asc, count, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { withOrgContext } from './context';
import { writeHistory } from './history';
import { orgIds } from './organizations';
import { assignmentRule, calendarOf, reportTypeInfos, type ReportTypeInfo } from './reports';
import {
  assignments,
  contractorBenefits,
  reports,
  reportTypes,
  taxBenefitDueRules,
  taxBenefits,
} from './schema';

/*
 * Пересчёт сроков несданных отчётов после правки каталога в Админке (задача 2.37; ТЗ «Если изменение
 * каталога влияет на сроки уже созданных отчётов, система показывает, сколько несданных отчётов в
 * скольких организациях изменится, и пересчитывает только их»; прототип recalcDues, typeEditDlg,
 * importDictDlg): после правки производственного календаря, правила срока вида отчёта, «Меняет сроки»
 * статуса и загрузки из Excel. Отбор и расчёт — как у `redueContractorReports`: несданные, не
 * заменённые уточнённым, без ручного срока и не разовые, срок — `reportDue` по правилу назначения.
 * Каждая организация — своей транзакцией `withOrgContext` с пределом времени задач; повтор безопасен:
 * второй раз сроки уже совпадают. Предпросмотр считает тем же кодом без записи — по каталогу, который
 * прочитан в ещё не завершённой (или откатываемой) транзакции администратора (`DueCatalog`).
 */

/** Правила сроков платформы: виды отчётов, «Меняет сроки» статусов и производственный календарь. */
export interface DueCatalog {
  types: ReadonlyMap<string, ReportTypeInfo>;
  /** Сроки действующих (не отключённых) статусов: код статуса → вид отчёта → срок. */
  statuses: ReadonlyMap<string, ReadonlyMap<string, StatusDueRule>>;
  calendar: ProductionCalendar;
}

/** Каталог сроков, как его видит транзакция: у администратора — вместе с ещё не сохранённой правкой. */
export async function dueCatalog(tx: Tx): Promise<DueCatalog> {
  const [types, rules, calendar] = await Promise.all([
    reportTypeInfos(tx),
    tx
      .select({
        benefitCode: taxBenefitDueRules.benefitCode,
        reportTypeCode: taxBenefitDueRules.reportTypeCode,
        dueDay: taxBenefitDueRules.dueDay,
        dueAfter: taxBenefitDueRules.dueAfter,
        dueMonth: taxBenefitDueRules.dueMonth,
        payDay: taxBenefitDueRules.payDay,
        payAfter: taxBenefitDueRules.payAfter,
      })
      .from(taxBenefitDueRules)
      .innerJoin(taxBenefits, eq(taxBenefits.code, taxBenefitDueRules.benefitCode))
      .where(eq(taxBenefits.active, true)),
    calendarOf(tx),
  ]);
  const statuses = new Map<string, Map<string, StatusDueRule>>();
  for (const { reportTypeCode, ...rule } of rules) {
    const byType = statuses.get(rule.benefitCode) ?? new Map<string, StatusDueRule>();
    byType.set(reportTypeCode, rule);
    statuses.set(rule.benefitCode, byType);
  }
  return { types, statuses, calendar };
}

/**
 * Какие отчёты пересчитать: виды отчётов (правило срока), статусы (контрагенты, у которых они есть)
 * или все (производственный календарь).
 */
export type RedueScope =
  | { kind: 'types'; codes: readonly string[] }
  | { kind: 'statuses'; codes: readonly string[] }
  | { kind: 'calendar' };

/** Причины пересчёта в истории отчёта; `{name}` — название статуса. */
export interface CatalogRedueTexts {
  /** «Изменено правило срока вида отчёта». */
  byType: string;
  /** «Изменён производственный календарь». */
  byCalendar: string;
  /** «Срок по статусу «…»» (как при установке статуса у контрагента). */
  byStatus: string;
  /** «Срок по каталогу (снят статус «…»)» — статус больше не меняет этот срок. */
  byStatusDropped: string;
  /** «Срок по каталогу». */
  byCatalog: string;
}

/** Объединить области пересчёта: виды и статусы — по кодам, календарь поглощает остальные. */
export function mergeRedueScopes(scopes: readonly (RedueScope | null)[]): RedueScope | null {
  const list = scopes.filter((x): x is RedueScope => x !== null);
  if (list.some((x) => x.kind === 'calendar')) return { kind: 'calendar' };
  const codes = (kind: 'types' | 'statuses') => [
    ...new Set(list.flatMap((x) => (x.kind === kind ? x.codes : []))),
  ];
  const types = codes('types');
  const statuses = codes('statuses');
  if (types.length && statuses.length) return { kind: 'calendar' };
  if (types.length) return { kind: 'types', codes: types };
  if (statuses.length) return { kind: 'statuses', codes: statuses };
  return null;
}

/** Отбор отчётов области в SQL. */
function scopeSql(scope: RedueScope): SQL | undefined {
  switch (scope.kind) {
    case 'types':
      return inArray(reports.reportTypeCode, [...scope.codes]);
    case 'statuses':
      return inArray(
        reports.contractorId,
        sql`(select ${contractorBenefits.contractorId} from ${contractorBenefits} where ${inArray(contractorBenefits.benefitCode, [...scope.codes])})`,
      );
    case 'calendar':
      return undefined;
  }
}

/**
 * Статусы со своим сроком у контрагентов на сегодня (как `statusDueRules`, но по каталогу `catalog`):
 * статус действует, пока сегодня в его датах «Действует с / по»; из нескольких статусов со своим сроком
 * одного вида берётся первый по коду. Ещё — какие статусы области есть у контрагента: от них причина
 * «снят статус».
 */
async function contractorStatuses(
  tx: Tx,
  contractorIds: readonly string[],
  today: IsoDate,
  catalog: DueCatalog,
) {
  const rows = contractorIds.length
    ? await tx
        .select({
          contractorId: contractorBenefits.contractorId,
          benefitCode: contractorBenefits.benefitCode,
        })
        .from(contractorBenefits)
        .where(
          and(
            inArray(contractorBenefits.contractorId, [...contractorIds]),
            or(isNull(contractorBenefits.validFrom), lte(contractorBenefits.validFrom, today)),
            or(isNull(contractorBenefits.validTo), gte(contractorBenefits.validTo, today)),
          ),
        )
        .orderBy(asc(contractorBenefits.benefitCode))
    : [];
  const rules = new Map<string, StatusDueRule>();
  const held = new Map<string, string[]>();
  for (const { contractorId, benefitCode } of rows) {
    held.set(contractorId, [...(held.get(contractorId) ?? []), benefitCode]);
    for (const [typeCode, rule] of catalog.statuses.get(benefitCode) ?? []) {
      const key = `${contractorId}:${typeCode}`;
      if (!rules.has(key)) rules.set(key, rule);
    }
  }
  return { rules, held };
}

/**
 * Пересчитать (или, без `write`, только посчитать) сроки несданных отчётов организации из контекста
 * `withOrgContext`: отвечает, у скольких отчётов срок сдачи или оплаты меняется. С `write` каждый такой
 * отчёт получает новые сроки и запись в историю «было → стало» с причиной. Каталог по умолчанию —
 * сохранённый (`dueCatalog`).
 */
export async function redueOpenReports(
  tx: Tx,
  scope: RedueScope,
  today: IsoDate,
  options: {
    write: boolean;
    texts: CatalogRedueTexts;
    catalog?: DueCatalog;
  },
): Promise<number> {
  const query = tx
    .select({ r: reports, a: assignments })
    .from(reports)
    .leftJoin(assignments, eq(assignments.id, reports.assignmentId))
    .where(
      and(
        inArray(reports.status, [...OPEN_REPORT_STATUSES]),
        eq(reports.superseded, false),
        eq(reports.dueManual, false),
        isNull(reports.eventDate),
        scopeSql(scope),
      ),
    );
  const rows = options.write ? await query.for('update', { of: reports }) : await query;
  if (rows.length === 0) return 0;
  const catalog = options.catalog ?? (await dueCatalog(tx));
  const { rules, held } = await contractorStatuses(
    tx,
    [...new Set(rows.map((x) => x.r.contractorId))],
    today,
    catalog,
  );
  const inScope = new Set(scope.kind === 'statuses' ? scope.codes : []);
  const names =
    options.write && scope.kind === 'statuses'
      ? await statusNames(tx, [...inScope, ...[...rules.values()].map((x) => x.benefitCode)])
      : new Map<string, string>();
  const named = (template: string, code: string) =>
    template.replace('{name}', names.get(code) ?? code);
  let changed = 0;
  for (const { r, a } of rows) {
    const type = catalog.types.get(r.reportTypeCode);
    if (!type || type.oneOff) continue;
    const status = rules.get(`${r.contractorId}:${r.reportTypeCode}`) ?? null;
    const rule = a ? assignmentRule(type, a, status) : effectiveRule(type, null, status);
    if (rule.period !== r.period) continue;
    // «Что сделать» — отчёта: он сохраняет своё, даже если вид потом поменяли (без оплаты — без срока).
    const d = reportDue(
      { ...rule, act: r.act },
      { period: r.period, start: r.periodStart },
      catalog.calendar,
    );
    if (d.due === r.dueDate && d.base === r.dueBase && d.payDue === r.payDue) continue;
    changed++;
    if (!options.write) continue;
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
    const dropped = (held.get(r.contractorId) ?? []).find((code) => inScope.has(code));
    await writeHistory(tx, {
      entity: 'report',
      entityId: r.id,
      action: 'update',
      changes: [
        ...(d.due !== r.dueDate ? [{ field: 'dueDate', from: r.dueDate, to: d.due }] : []),
        ...(d.payDue !== r.payDue ? [{ field: 'payDue', from: r.payDue, to: d.payDue }] : []),
      ],
      reason:
        scope.kind === 'types'
          ? options.texts.byType
          : scope.kind === 'calendar'
            ? options.texts.byCalendar
            : rule.benefitCode
              ? named(options.texts.byStatus, rule.benefitCode)
              : dropped
                ? named(options.texts.byStatusDropped, dropped)
                : options.texts.byCatalog,
      contractorId: r.contractorId,
    });
  }
  return changed;
}

/** Названия статусов области — для причин в истории отчёта. */
async function statusNames(tx: Tx, codes: readonly string[]): Promise<Map<string, string>> {
  const rows = await tx
    .select({ code: taxBenefits.code, name: taxBenefits.name })
    .from(taxBenefits)
    .where(inArray(taxBenefits.code, [...new Set(codes)]));
  return new Map(rows.map((x) => [x.code, x.name]));
}

/** Итог пересчёта по всем организациям: сколько отчётов, в скольких организациях, где не вышло. */
export interface RedueSummary {
  reports: number;
  orgs: number;
  /** Организации, где пересчёт не прошёл и со второй попытки (ошибка базы). */
  failed: string[];
}

/**
 * Пересчёт или предпросмотр во всех организациях: каждая — своей транзакцией с пределом времени задач,
 * не прошедшая со второй попытки не мешает остальным. Без `write` — только счёт (предпросмотр); тогда
 * ошибка поднимается: число в окне должно быть честным.
 */
export async function redueAllOrgs(
  db: Db,
  scope: RedueScope,
  today: IsoDate,
  options: { write: boolean; texts: CatalogRedueTexts; catalog?: DueCatalog },
): Promise<RedueSummary> {
  const summary: RedueSummary = { reports: 0, orgs: 0, failed: [] };
  for (const orgId of await orgIds(db)) {
    const run = () =>
      withOrgContext(db, { orgId, kind: 'job' }, (tx) =>
        redueOpenReports(tx, scope, today, options),
      );
    let n: number;
    try {
      n = await run();
    } catch (first) {
      if (!options.write) throw first;
      try {
        n = await run();
      } catch {
        summary.failed.push(orgId);
        continue;
      }
    }
    summary.reports += n;
    if (n > 0) summary.orgs++;
  }
  return summary;
}

/** Отчёты организации по видам: всего и несданных (не заменённых уточнённым). */
export async function typeReportCountsOfOrg(
  tx: Tx,
): Promise<Map<string, { total: number; open: number }>> {
  const rows = await tx
    .select({
      code: reports.reportTypeCode,
      total: count(),
      open: sql<number>`count(*) filter (where ${and(
        inArray(reports.status, [...OPEN_REPORT_STATUSES]),
        eq(reports.superseded, false),
      )})`.mapWith(Number),
    })
    .from(reports)
    .groupBy(reports.reportTypeCode);
  return new Map(rows.map((x) => [x.code, { total: x.total, open: x.open }]));
}

/** Пример переноса срока с нерабочего дня: вид отчёта, период, срок по закону и срок после переноса. */
export interface DueShiftExample {
  shortName: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  dueBase: IsoDate;
  dueDate: IsoDate;
}

/**
 * Пример для пояснения вкладки «Календарь» (прототип renderPDicts: «Пример: <вид> за <период> —
 * дд.мм → дд.мм»): ближайший несданный отчёт без ручного срока, срок которого перенесён с нерабочего
 * дня, — в первой организации, где такой есть; без отчётов примера нет.
 */
export async function dueShiftExample(db: Db): Promise<DueShiftExample | null> {
  for (const orgId of await orgIds(db)) {
    const [row] = await withOrgContext(db, { orgId }, (tx) =>
      tx
        .select({
          shortName: reportTypes.shortName,
          period: reports.period,
          periodStart: reports.periodStart,
          dueBase: reports.dueBase,
          dueDate: reports.dueDate,
        })
        .from(reports)
        .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
        .where(
          and(
            ne(reports.dueDate, reports.dueBase),
            inArray(reports.status, [...OPEN_REPORT_STATUSES]),
            eq(reports.superseded, false),
            eq(reports.dueManual, false),
            isNull(reports.eventDate),
          ),
        )
        .orderBy(asc(reports.dueDate))
        .limit(1),
    );
    if (row) return row;
  }
  return null;
}
