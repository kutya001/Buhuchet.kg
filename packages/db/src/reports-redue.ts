import {
  effectiveRule,
  nextWorkingDay,
  OPEN_REPORT_STATUSES,
  periodStartOf,
  reportDue,
  shiftPeriod,
  type EffectiveRule,
  type IsoDate,
  type ProductionCalendar,
  type ReportDue,
  type ReportPeriod,
  type StatusDueRule,
} from '@buhuchet/domain';
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Db, Tx } from './client';
import { withOrgContext } from './context';
import { writeHistory } from './history';
import { orgIds } from './organizations';
import { assignmentRule, calendarOf, reportTypeInfos, type ReportTypeInfo } from './reports';
import {
  assignments,
  contractorBenefits,
  reportDueChanges,
  reports,
  taxBenefitDueRules,
  taxBenefits,
} from './schema';

/*
 * Пересчёт сроков несданных отчётов после правки каталога в Админке (задача 2.37; ТЗ «Если изменение
 * каталога влияет на сроки уже созданных отчётов, система показывает, сколько несданных отчётов в
 * скольких организациях изменится, и пересчитывает только их»; прототип recalcDues, typeEditDlg,
 * importDictDlg): после правки производственного календаря, правила срока вида отчёта, «Меняет сроки»
 * статуса и загрузки из Excel. Пересчитываются несданные, не заменённые уточнённым, без ручного срока.
 * Правка календаря заново переносит на рабочий день хранимый срок по закону (`dueBase`), как прототип
 * recalcDues. Правка правила вида или статуса считает срок заново по правилу назначения (`reportDue`,
 * как `redueContractorReports`) — кроме разовых видов, уточнённых и созданных через «Разовый отчёт»:
 * их срок задан не правилом (ОТКЛОНЕНИЕ: docs/deviations.md#Д-18). Каждая организация — своей
 * транзакцией `withOrgContext`; повтор безопасен: второй раз сроки уже совпадают. Предпросмотр считает
 * тем же кодом без записи — по каталогу, который прочитан в ещё не завершённой (или откатываемой)
 * транзакции администратора (`DueCatalog`).
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

/** Отчёт создан через «Разовый отчёт»: его первая запись изменения срока — без прежнего срока. */
const createdByHand = sql`exists (select 1 from ${reportDueChanges} where ${reportDueChanges.orgId} = ${reports.orgId} and ${reportDueChanges.reportId} = ${reports.id} and ${reportDueChanges.fromDue} is null)`;

/**
 * Срок по правилу — только у отчётов, созданных по правилу: не разового вида (дата события), не
 * уточнённых и не созданных вручную.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-18
const byRule = and(isNull(reports.eventDate), eq(reports.revision, 0), not(createdByHand));

/** Отбор отчётов области в SQL. */
function scopeSql(scope: RedueScope): SQL | undefined {
  switch (scope.kind) {
    case 'types':
      return and(inArray(reports.reportTypeCode, [...scope.codes]), byRule);
    case 'statuses':
      return and(
        inArray(
          reports.contractorId,
          sql`(select ${contractorBenefits.contractorId} from ${contractorBenefits} where ${inArray(contractorBenefits.benefitCode, [...scope.codes])})`,
        ),
        byRule,
      );
    case 'calendar':
      return undefined;
  }
}

/**
 * Правка календаря (прототип recalcDues): хранимый срок по закону заново переносится на рабочий день.
 * Срок оплаты без своего правила идёт за сроком сдачи (как `payFollowsDue`), со своим — переносится
 * по правилу вида; у отчёта не своего периода (сменилась периодичность) остаётся прежним.
 */
function calendarDue(
  r: typeof reports.$inferSelect,
  rule: EffectiveRule,
  calendar: ProductionCalendar,
): ReportDue {
  const due = rule.shiftToWorkday ? nextWorkingDay(calendar, r.dueBase) : r.dueBase;
  if (r.payDue === null) return { base: r.dueBase, due, payDue: null };
  if (r.eventDate !== null || rule.payDay === null) return { base: r.dueBase, due, payDue: due };
  if (rule.period !== r.period) return { base: r.dueBase, due, payDue: r.payDue };
  const { payDue } = reportDue(
    { ...rule, act: r.act },
    { period: r.period, start: r.periodStart },
    calendar,
  );
  return { base: r.dueBase, due, payDue };
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
 * отчёт получает новые сроки и запись в историю «было → стало» с причиной. Сдвинулся только срок по
 * закону, а видимые сроки те же (оба дня переносятся на один рабочий) — он сохраняется молча: в счёт и
 * в историю такой отчёт не идёт. Каталог по умолчанию — сохранённый (`dueCatalog`).
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
    if (!type) continue;
    const status = rules.get(`${r.contractorId}:${r.reportTypeCode}`) ?? null;
    const rule = a ? assignmentRule(type, a, status) : effectiveRule(type, null, status);
    let d: ReportDue;
    if (scope.kind === 'calendar') {
      d = calendarDue(r, rule, catalog.calendar);
    } else {
      if (type.oneOff || rule.period !== r.period) continue;
      // «Что сделать» — отчёта: он сохраняет своё, даже если вид потом поменяли (без оплаты — без срока).
      d = reportDue(
        { ...rule, act: r.act },
        { period: r.period, start: r.periodStart },
        catalog.calendar,
      );
    }
    if (d.due === r.dueDate && d.payDue === r.payDue) {
      if (options.write && d.base !== r.dueBase) {
        await tx.update(reports).set({ dueBase: d.base }).where(eq(reports.id, r.id));
      }
      continue;
    }
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
  /** Организации, где пересчёт не прошёл и со второй попытки, с ошибкой — для журнала. */
  failed: { orgId: string; error: unknown }[];
  /** Сколько организаций не начато: время прохода (`until`) кончилось. */
  left: number;
}

/**
 * Пересчёт или предпросмотр во всех организациях, каждая — своей транзакцией. Пересчёт идёт с пределом
 * времени задач и до момента `until` (мс): организации, до которых не дошло, — в `left`, их догонит
 * следующий проход; не прошедшая со второй попытки не мешает остальным. Предпросмотр (без `write`) —
 * с пределом времени запроса API, и ошибка поднимается: число в окне должно быть честным.
 */
export async function redueAllOrgs(
  db: Db,
  scope: RedueScope,
  today: IsoDate,
  options: { write: boolean; texts: CatalogRedueTexts; catalog?: DueCatalog; until?: number },
): Promise<RedueSummary> {
  const summary: RedueSummary = { reports: 0, orgs: 0, failed: [], left: 0 };
  const ids = await orgIds(db);
  for (const [i, orgId] of ids.entries()) {
    if (options.until !== undefined && Date.now() >= options.until) {
      summary.left = ids.length - i;
      break;
    }
    const kind = options.write ? 'job' : 'request';
    const run = () =>
      withOrgContext(db, { orgId, kind }, (tx) => redueOpenReports(tx, scope, today, options));
    let n: number;
    try {
      n = await run();
    } catch (first) {
      if (!options.write) throw first;
      try {
        n = await run();
      } catch (error) {
        summary.failed.push({ orgId, error });
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
 * дд.мм → дд.мм»): ближайший с сегодняшнего дня срок действующего вида по каталогу, который календарь
 * переносит с нерабочего дня. Прототип берёт первый такой отчёт; здесь — каталог платформы, без данных
 * организаций (docs/decisions.md п. Д-9). Переносов в ближайший год нет — примера нет.
 */
export async function dueShiftExample(tx: Tx, today: IsoDate): Promise<DueShiftExample | null> {
  const [types, calendar] = await Promise.all([reportTypeInfos(tx), calendarOf(tx)]);
  const yearAhead = shiftPeriod('Y', today, 1);
  let best: { code: string; example: DueShiftExample } | null = null;
  for (const type of types.values()) {
    if (!type.active || type.oneOff || !type.shiftToWorkday) continue;
    const rule = effectiveRule(type, null, null);
    const current = periodStartOf(rule.period, today);
    // Первый период вида, чей срок ещё впереди и перенесён с нерабочего дня.
    for (let k = -1; k <= 12; k++) {
      const start = shiftPeriod(rule.period, current, k);
      const d = reportDue(rule, { period: rule.period, start }, calendar);
      if (d.due > yearAhead) break;
      if (d.due < today || d.due === d.base) continue;
      const better =
        !best ||
        d.due < best.example.dueDate ||
        (d.due === best.example.dueDate && type.code < best.code);
      if (better) {
        best = {
          code: type.code,
          example: {
            shortName: type.shortName,
            period: rule.period,
            periodStart: start,
            dueBase: d.base,
            dueDate: d.due,
          },
        };
      }
      break;
    }
  }
  return best?.example ?? null;
}
