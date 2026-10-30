import {
  assignmentRateText,
  auditActorName,
  formatText,
  OPEN_REPORT_STATUSES,
  rateText,
  rateVariants,
  reportWeek,
  SINGLE_TAX_TYPES,
  type AssignmentRate,
  type IsoDate,
  type ListQuery,
  type ReportAct,
  type ReportPeriod,
  type ReportStatus,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import {
  assignments,
  authorities,
  contractors,
  dueChangeReasons,
  employees,
  reportDueChanges,
  orgSettings,
  ownershipForms,
  productionCalendar,
  reports,
  reportTypes,
  singleTaxRates,
  statusHistory,
  taxOffices,
  taxRegimes,
} from './schema';
import { dateLiteral, textLiteral } from './sql-text';
import type { AuditRecord } from './staff';
import { readStatusHistory, type StatusHistoryItem } from './status';

/*
 * Список «Отчеты для сдачи» на сервере (ТЗ «Отчеты для сдачи» → список; прототип modules/reports.js,
 * reportCols): столбцы, вкладки «На неделе», «Просрочено», «Ожидают подтверждения», «Все отчёты» и
 * быстрый фильтр «Все / Сдать / Уплатить» (задача 2.13). Прежние версии уточнённых отчётов в списке не
 * видны (прототип visReports). Тексты, которые видны в ячейках (подписи периодов, «Что сделать», ставки
 * словами), приходят одной записью `lt` в FROM запроса: так у столбцов нет параметров и по ним работают
 * фильтр, сортировка и группы. Деньги и оплата (2.19), файлы (2.14) добавят свои столбцы.
 */

const responsible = alias(employees, 'report_responsible');
const submitter = alias(employees, 'report_submitter');
const confirmer = alias(employees, 'report_confirmer');
const creator = alias(employees, 'report_creator');
const updater = alias(employees, 'report_updater');
const regime = alias(taxRegimes, 'report_regime');

const translate =
  (t: ListTexts): Translate =>
  (key, params) =>
    formatText(t(key), params);

/** Столбец записи текстов `lt`. */
const lt = (name: string) => sql.raw(`"lt"."${name}"`);

const TEXT_FIELDS = [
  'q_short',
  'h_short',
  'm_full',
  'q_full',
  'h_full',
  'y_full',
  'event_full',
  'event_default',
  'act_sub',
  'act_pay',
  'act_both',
  'version_primary',
  'version_revision',
  'overdue_sub',
  'mark_waiting',
  'mark_confirmed',
  'mark_confirmed_by',
] as const;

/**
 * Запись текстов `lt` для запроса списка: подписи из словаря, названия месяцев и ставки словами на
 * сегодня — строки ЕНС с вариантами (`код:вариант`) и добавляемые строки видов (`вид:ключ`).
 */
async function listTexts(tx: Tx, t: ListTexts, today: IsoDate): Promise<SQL> {
  const tr = translate(t);
  const [rates, types] = await Promise.all([
    tx
      .select({
        code: singleTaxRates.code,
        rate: singleTaxRates.rate,
        rateCashless: singleTaxRates.rateCashless,
        rateCash: singleTaxRates.rateCash,
      })
      .from(singleTaxRates),
    tx
      .select({ code: reportTypes.code, rateAdditions: reportTypes.rateAdditions })
      .from(reportTypes)
      .where(sql`jsonb_array_length(${reportTypes.rateAdditions}) > 0`),
  ]);
  const en: Record<string, string> = {};
  for (const x of rates) {
    const count = Math.max(1, rateVariants(x.rate).length);
    for (let v = 0; v < count; v++) {
      en[`${x.code}:${v}`] = tr('report.rate.en_line', {
        code: x.code,
        rate: rateText(x, rates, { date: today, variant: v, short: true }, tr),
      });
    }
  }
  const adds: Record<string, string> = {};
  for (const type of types) {
    for (const x of type.rateAdditions) {
      adds[`${type.code}:${x.k}`] = rateText(x, rates, { date: today, short: true }, tr);
    }
  }
  const record = {
    q_short: t('report.period.q_short'),
    h_short: t('report.period.h_short'),
    m_full: t('report.period.m_full'),
    q_full: t('report.period.q_full'),
    h_full: t('report.period.h_full'),
    y_full: t('report.period.y_full'),
    event_full: t('report.period.event_full'),
    event_default: t('report.event.default'),
    act_sub: t('report.act.sub'),
    act_pay: t('report.act.pay'),
    act_both: t('report.act.both'),
    version_primary: t('report.version.primary'),
    version_revision: t('report.version.revision'),
    overdue_sub: t('report.overdue.sub'),
    mark_waiting: t('status.report.waiting'),
    mark_confirmed: t('status.report.confirmed'),
    mark_confirmed_by: t('status.mark_confirmed_by'),
    months: Array.from({ length: 12 }, (_, i) => t(`report.month.${i + 1}`)),
    en,
    adds,
  };
  const fields = [
    ...TEXT_FIELDS.map((f) => `${f} text`),
    'months text[]',
    'en jsonb',
    'adds jsonb',
  ];
  return sql`jsonb_to_record(${JSON.stringify(record)}::jsonb) as lt(${sql.raw(fields.join(', '))})`;
}

/** Отчёты со справочными названиями, назначением, ответственным и записью текстов `lt`. */
function fromReports(tx: Tx, fields: object, texts: SQL) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .innerJoin(reportTypes, eq(reportTypes.code, reports.reportTypeCode))
    .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
    .innerJoin(ownershipForms, eq(ownershipForms.code, contractors.formCode))
    .leftJoin(regime, eq(regime.code, contractors.regimeCode))
    .leftJoin(taxOffices, eq(taxOffices.code, contractors.taxOfficeCode))
    .leftJoin(assignments, eq(assignments.id, reports.assignmentId))
    .leftJoin(responsible, eq(responsible.id, reports.responsibleEmployeeId))
    .leftJoin(submitter, eq(submitter.userId, reports.submittedBy))
    .leftJoin(confirmer, eq(confirmer.userId, reports.confirmedBy))
    .leftJoin(creator, eq(creator.userId, reports.createdBy))
    .leftJoin(updater, eq(updater.userId, reports.updatedBy))
    .innerJoin(texts, sql`true`)
    .$dynamic();
}

const statusIn = (statuses: Iterable<string>) =>
  sql`${reports.status} in (${sql.join([...statuses].map(textLiteral), sql`, `)})`;
const OPEN = statusIn(OPEN_REPORT_STATUSES);
const DONE = statusIn(['submitted', 'not_required']);

/**
 * Просрочена сдача (прототип derive: r.overdue): несданный отчёт со сдачей, срок прошёл, контрагент не
 * приостановлен. У архивного несданные за месяцы обслуживания остаются просроченными (ТЗ «Архив»).
 * Просрочку оплаты добавит задача 2.19.
 */
const overdueOf = (today: IsoDate) =>
  sql`(${contractors.serviceStatus} <> 'paused' and ${reports.act} <> 'pay' and ${OPEN} and ${reports.dueDate} < ${dateLiteral(today)})`;

/**
 * Сдача ждёт подтверждения (прототип repWait): сдан, у вида есть сдача, подтверждения нет — только при
 * включённой в учётной политике «Сдача отчётов требует подтверждения».
 */
const waitingOf = (confirm: boolean) =>
  confirm
    ? sql`(${reports.status} = 'submitted' and ${reports.act} <> 'pay' and ${reports.confirmedAt} is null)`
    : sql`false`;

/** День сдачи по Бишкеку (прототип repWaitDays: `subAt || subDate`). */
const SUBMITTED_DAY = sql`coalesce((${reports.submittedAt} at time zone 'Asia/Bishkek')::date, ${reports.submittedOn})`;

/** Быстрый фильтр над списком (ТЗ «Метка «Что нужно сделать»» → «Все / Сдать / Уплатить»). */
export const REPORT_QUICK = ['all', 'sub', 'pay'] as const;
export type ReportQuick = (typeof REPORT_QUICK)[number];

/**
 * «Сдать» — отчёты со сдачей, которые ещё не сданы; «Уплатить» — отчёты с уплатой, где сумма не указана
 * или больше нуля (прототип actQ); «Не требуется» — ни там ни там. Оплаченные из «Уплатить» уберёт
 * задача 2.19 вместе с оплатами.
 */
function quickOf(q: ReportQuick): SQL | undefined {
  if (q === 'sub') return sql`(${reports.act} <> 'pay' and ${OPEN})`;
  if (q === 'pay') {
    return sql`(${reports.act} <> 'sub' and ${reports.status} <> 'not_required' and (${reports.amount} is null or ${reports.amount} > 0))`;
  }
  return undefined;
}

/** «020 · Октябрьский» — код ГНС и краткое название (прототип ugnsLabel). */
const TAX_OFFICE_LABEL = sql<
  string | null
>`case when ${taxOffices.code} is null then null else coalesce(${taxOffices.gnsCode} || ' · ', '') || ${taxOffices.shortName} end`;

const year = sql`extract(year from ${reports.periodStart})::int::text`;
const month = sql`extract(month from ${reports.periodStart})::int`;
const romanQ = sql`(array['I','II','III','IV'])[extract(quarter from ${reports.periodStart})::int]`;
const romanH = sql`(array['I','II'])[case when ${month} <= 6 then 1 else 2 end]`;
const sub2 = (template: SQL, a: [string, SQL], b: [string, SQL]) =>
  sql`replace(replace(${template}, ${textLiteral(`{${a[0]}}`)}, ${a[1]}), ${textLiteral(`{${b[0]}}`)}, ${b[1]})`;

/** Подпись периода (прототип plabel): «10.2026», «III кв. 2026», «I пол. 2026», «2026», «11.2026 · 05.11». */
const PERIOD_LABEL = sql<string>`case
  when ${reports.eventDate} is not null then to_char(${reports.eventDate}, 'MM.YYYY') || ' · ' || to_char(${reports.eventDate}, 'DD.MM')
  when ${reports.period} = 'M' then to_char(${reports.periodStart}, 'MM.YYYY')
  when ${reports.period} = 'Q' then ${sub2(lt('q_short'), ['n', romanQ], ['y', year])}
  when ${reports.period} = 'H' then ${sub2(lt('h_short'), ['n', romanH], ['y', year])}
  else ${year} end`;

/** Период полностью (прототип phuman): «Октябрь 2026», «III квартал 2026», «2026 год», «… · дата ввоза 05.11.2026». */
const monthName = sql`${lt('months')}[${month}]`;
const PERIOD_FULL = sql<string>`case
  when ${reports.eventDate} is not null then replace(replace(replace(${lt('event_full')}, '{period}', ${sub2(lt('m_full'), ['month', monthName], ['y', year])}), '{event}', lower(left(coalesce(nullif(${reportTypes.eventLabel}, ''), ${lt('event_default')}), 1)) || substr(coalesce(nullif(${reportTypes.eventLabel}, ''), ${lt('event_default')}), 2)), '{date}', to_char(${reports.eventDate}, 'DD.MM.YYYY'))
  when ${reports.period} = 'M' then ${sub2(lt('m_full'), ['month', monthName], ['y', year])}
  when ${reports.period} = 'Q' then ${sub2(lt('q_full'), ['n', romanQ], ['y', year])}
  when ${reports.period} = 'H' then ${sub2(lt('h_full'), ['n', romanH], ['y', year])}
  else replace(${lt('y_full')}, '{y}', ${year}) end`;

/** Ключ периода для фильтра и сортировки: первое число и дата события. */
const PERIOD_KEY = sql<string>`${reports.periodStart}::text || coalesce(' ' || ${reports.eventDate}::text, '')`;

/** Ставка назначения коротко (прототип aRateTxt, short): «ЕНС-04 · 4 / 6 %», «12 %; 1 / 2 %». */
const enKey = sql`(e.x ->> 'code') || ':' || coalesce(e.x ->> 'variant', '0')`;
const RATE = sql<string | null>`case
  when ${assignments.reportTypeCode} in (${sql.join(SINGLE_TAX_TYPES.map(textLiteral), sql`, `)})
    then (select string_agg(${lt('en')} ->> ${enKey}, '; ' order by e.ord) from jsonb_array_elements(${assignments.enRates}) with ordinality e(x, ord) where ${lt('en')} ->> ${enKey} is not null)
  else concat_ws('; ', ${assignments.rate}, (select string_agg(${lt('adds')} ->> (${assignments.reportTypeCode} || ':' || u.k), '; ' order by u.o) from unnest(${assignments.rateAdditions}) with ordinality u(k, o) where ${lt('adds')} ->> (${assignments.reportTypeCode} || ':' || u.k) is not null)) end`;

/** Что уплачивается (прототип paysTxt): платежи вида, орган — если платежей несколько или он другой. */
const PAYS = sql<string>`case when ${reports.act} = 'sub' then '' else coalesce((select string_agg(p.x ->> 'name' || case when coalesce(p.x ->> 'authority', '') <> '' and (jsonb_array_length(${reportTypes.payments}) > 1 or p.x ->> 'authority' <> ${reportTypes.authorityCode}) then ' (' || coalesce((select a.name from ${authorities} a where a.code = p.x ->> 'authority'), p.x ->> 'authority') || ')' else '' end, '; ' order by p.ord) from jsonb_array_elements(${reportTypes.payments}) with ordinality p(x, ord)), '') end`;

const STATUS_ORDER = sql`case ${reports.status} when 'todo' then 0 when 'in_progress' then 1 when 'needs_fix' then 2 when 'submitted' then 3 else 4 end`;
const CREATED_BY = auditActorValue(reports.createdBy, creator.shortName);

/**
 * Столбцы списка отчётов (прототип reportCols): ключи — как у столбцов экрана. У вида «Уплата» нет
 * статуса сдачи и даты сдачи, у вида «Сдача» — суммы и срока оплаты (в ячейке «—»).
 */
export function reportListColumns(
  t: ListTexts,
  options: { today: IsoDate; confirm: boolean },
): ListColumns {
  const statusText = sql`case ${reports.status} ${sql.join(
    ['todo', 'in_progress', 'submitted', 'needs_fix', 'not_required'].map(
      (s) => sql`when ${textLiteral(s)} then ${t(`status.report.${s}`)}`,
    ),
    sql` `,
  )} end`;
  const overdue = overdueOf(options.today);
  const waiting = waitingOf(options.confirm);
  const marked = options.confirm
    ? sql`(${reports.status} = 'submitted' and ${reports.act} <> 'pay')`
    : sql`false`;
  return {
    cp: { type: 'text', label: 'report.col.cp', value: contractors.name },
    inn: { type: 'text', label: 'report.col.inn', value: contractors.inn, compact: true },
    taxOffice: {
      type: 'enum',
      label: 'report.col.tax_office',
      value: contractors.taxOfficeCode,
      display: TAX_OFFICE_LABEL,
      sort: { value: TAX_OFFICE_LABEL, text: true },
    },
    // Значение — краткое название, как в прототипе (`val: T[r.t].short`): «1-Т» месячный и годовой —
    // одно значение фильтра и одна группа.
    type: {
      type: 'enum',
      label: 'report.col.type',
      value: reportTypes.shortName,
      sort: { value: reportTypes.shortName, text: true },
    },
    act: {
      type: 'enum',
      label: 'report.col.act',
      value: reports.act,
      display: sql`case ${reports.act} when 'sub' then ${lt('act_sub')} when 'pay' then ${lt('act_pay')} else ${lt('act_both')} end`,
      sort: {
        value: sql`case ${reports.act} when 'sub' then 1 when 'both' then 2 else 3 end`,
        text: false,
      },
    },
    rate: { type: 'enum', label: 'report.col.rate', value: RATE },
    organ: {
      type: 'enum',
      label: 'report.col.organ',
      value: reportTypes.authorityCode,
      display: authorities.name,
      sort: { value: authorities.name, text: true },
    },
    period: {
      type: 'enum',
      label: 'report.col.period',
      value: PERIOD_KEY,
      display: PERIOD_LABEL,
      sort: { value: PERIOD_KEY, text: false },
    },
    due: { type: 'date', label: 'report.col.due', value: reports.dueDate },
    days: {
      type: 'int',
      label: 'report.col.days',
      value: sql`case when ${DONE} then null else ${reports.dueDate} - ${dateLiteral(options.today)} end`,
    },
    status: {
      type: 'enum',
      label: 'report.col.status',
      value: sql`case when ${reports.act} = 'pay' then null else ${reports.status} end`,
      display: sql`case when ${reports.act} = 'pay' then null else ${statusText} end`,
      sort: { value: STATUS_ORDER, text: false },
    },
    // «Ждёт, дней» и «Сдал» — во вкладке «Ожидают подтверждения» (прототип reportCols, o.waiting).
    wait: {
      type: 'int',
      label: 'report.col.wait',
      value: sql`case when ${waiting} then ${dateLiteral(options.today)} - ${SUBMITTED_DAY} end`,
    },
    submittedBy: {
      type: 'enum',
      label: 'report.col.submitted_by',
      value: sql`coalesce(${submitter.id}, ${reports.responsibleEmployeeId})`,
      display: sql`coalesce(${submitter.shortName}, ${responsible.shortName})`,
      sort: { value: sql`coalesce(${submitter.shortName}, ${responsible.shortName})`, text: true },
    },
    submitted: {
      type: 'date',
      label: 'report.col.submitted',
      value: sql`case when ${reports.act} = 'pay' then null else ${reports.submittedOn} end`,
    },
    amount: {
      type: 'money',
      label: 'report.col.amount',
      value: sql`case when ${reports.act} = 'sub' then null else ${reports.amount} end`,
      total: true,
    },
    payDue: {
      type: 'date',
      label: 'report.col.pay_due',
      value: sql`case when ${reports.act} = 'sub' then null else ${reports.payDue} end`,
    },
    overdue: {
      type: 'enum',
      label: 'report.col.overdue',
      value: sql`case when ${overdue} then 'sub' end`,
      display: sql`case when ${overdue} then ${lt('overdue_sub')} end`,
    },
    pays: { type: 'text', label: 'report.col.pays', value: PAYS },
    responsible: {
      type: 'enum',
      label: 'report.col.responsible',
      value: reports.responsibleEmployeeId,
      display: responsible.shortName,
      sort: { value: responsible.shortName, text: true },
    },
    formCode: { type: 'text', label: 'report.col.form_code', value: reportTypes.formCode },
    // Текстом, как в прототипе (`type: 'text'`): фильтр — по части слова, «III квартал».
    periodFull: {
      type: 'text',
      label: 'report.col.period_full',
      value: PERIOD_FULL,
      sort: { value: PERIOD_KEY, text: false },
    },
    dueBase: { type: 'date', label: 'report.col.due_base', value: reports.dueBase },
    // «Подтверждение» и «Дата подтверждения» — при подтверждении сдачи в учётной политике.
    confirm: {
      type: 'enum',
      label: 'report.col.confirm',
      // «Ждёт подтверждения» или «Подтвердил <кто>» (прототип repConfTxt): у каждого подтвердившего — своё значение.
      value: sql`case when ${marked} then case when ${reports.confirmedAt} is null then 'waiting' else coalesce(${confirmer.id}::text, 'confirmed') end end`,
      display: sql`case when ${marked} then case when ${reports.confirmedAt} is null then ${lt('mark_waiting')} when ${confirmer.id} is null then ${lt('mark_confirmed')} else replace(${lt('mark_confirmed_by')}, '{who}', ${confirmer.shortName}) end end`,
    },
    confirmedOn: {
      type: 'date',
      label: 'report.col.confirmed_on',
      value: sql`case when ${marked} then (${reports.confirmedAt} at time zone 'Asia/Bishkek')::date end`,
    },
    version: {
      type: 'enum',
      label: 'report.col.version',
      value: sql`${reports.revision}::text`,
      display: sql`case when ${reports.revision} = 0 then ${lt('version_primary')} else replace(${lt('version_revision')}, '{n}', ${reports.revision}::text) end`,
      sort: { value: reports.revision, text: false },
    },
    ownership: {
      type: 'enum',
      label: 'report.col.ownership',
      value: contractors.formCode,
      display: ownershipForms.name,
      sort: { value: ownershipForms.name, text: true },
    },
    regime: {
      type: 'enum',
      label: 'report.col.regime',
      value: contractors.regimeCode,
      display: regime.name,
      sort: { value: regime.name, text: true },
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: reports.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: reports.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(reports.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
}

/** Вкладки списка (прототип repTabs). */
export const REPORT_TABS = ['week', 'overdue', 'waiting', 'all'] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

/**
 * Кто что видит во вкладке «Ожидают подтверждения» (прототип repWaitList): включено ли подтверждение
 * сдачи и чьи отчёты — у сотрудника без права «Подтверждать сдачу отчётов» только те, где он
 * ответственный (`own` — его номер), иначе все в области.
 */
export interface ReportWaitingView {
  confirm: boolean;
  own: string | null;
}

export interface ReportListOptions {
  t: ListTexts;
  today: IsoDate;
  /** Область «Свои контрагенты» (`reportScope`). */
  scope: SQL | undefined;
  tab: ReportTab;
  /** Быстрый фильтр «Все / Сдать / Уплатить». */
  quick: ReportQuick;
  waiting: ReportWaitingView;
}

/**
 * Область «Свои» в отчётах (решение заказчика 27.10.2026, docs/deviations.md п. А-2, вариант В): отчёты
 * контрагентов, за которыми закреплён сотрудник, и отчёты, где он сам ответственный (Соцфонд ведёт
 * другой бухгалтер). Условие — над отчётами вместе с контрагентом.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#А-2 — в ТЗ «свои» — только контрагенты сотрудника, в прототипе (visReports) — только отчёты, где он ответственный.
export function reportScope(ownEmployeeId: string | null): SQL | undefined {
  return ownEmployeeId
    ? or(
        eq(contractors.responsibleEmployeeId, ownEmployeeId),
        eq(reports.responsibleEmployeeId, ownEmployeeId),
      )
    : undefined;
}

/** «На этой неделе» (прототип inWeek): несданные со сдачей, срок на неделе, контрагент не приостановлен. */
function weekCondition(today: IsoDate): SQL {
  const { from, to } = reportWeek(today);
  return sql`(${contractors.serviceStatus} <> 'paused' and ${reports.act} <> 'pay' and ${OPEN} and ${reports.dueDate} between ${dateLiteral(from)} and ${dateLiteral(to)})`;
}

/** «Ожидают подтверждения» в области сотрудника (прототип repWaitList). */
function waitingCondition(w: ReportWaitingView): SQL {
  const own = w.own ? eq(reports.responsibleEmployeeId, w.own) : undefined;
  return and(waitingOf(w.confirm), own)!;
}

function tabCondition(o: Pick<ReportListOptions, 'tab' | 'today' | 'waiting'>): SQL | undefined {
  if (o.tab === 'week') return weekCondition(o.today);
  if (o.tab === 'overdue') return overdueOf(o.today);
  if (o.tab === 'waiting') return waitingCondition(o.waiting);
  return undefined;
}

function listScope(
  o: Pick<ReportListOptions, 'scope' | 'tab' | 'today' | 'quick' | 'waiting'>,
): SQL | undefined {
  return and(eq(reports.superseded, false), o.scope, tabCondition(o), quickOf(o.quick));
}

/** Строка списка отчётов. */
export interface ReportRow {
  id: string;
  contractor: { id: string; name: string; inn: string };
  taxOffice: string | null;
  type: { code: string; name: string; shortName: string };
  act: ReportAct;
  rate: string | null;
  organ: string;
  period: ReportPeriod;
  periodStart: IsoDate;
  eventDate: IsoDate | null;
  periodLabel: string;
  periodFull: string;
  revision: number;
  dueDate: IsoDate;
  dueBase: IsoDate;
  dueManual: boolean;
  /**
   * Срок перенесён с нерабочего дня (не вручную): название праздника срока по закону, у выходного —
   * пустая строка (прототип dueHtml, holidayName); без переноса — null.
   */
  dueHoliday: string | null;
  /** Дней до срока; у сданных и «Не требуется» — пусто. */
  days: number | null;
  overdue: boolean;
  status: ReportStatus;
  submittedOn: IsoDate | null;
  /** Когда и кто отметил «Сдан»; у отмеченных при назначении момента и сотрудника нет. */
  submittedAt: Date | null;
  submittedBy: { id: string; shortName: string } | null;
  /** Сколько дней сдача ждёт подтверждения (прототип repWaitDays); подтверждённый и несданный — пусто. */
  waitDays: number | null;
  /** Подтверждение сдачи старшим бухгалтером (отметка на шаге «Сдан», задача 2.14). */
  confirmedAt: Date | null;
  confirmedBy: { id: string; shortName: string } | null;
  /** Последняя смена статуса из «Истории статусов»: под шкалой в строке — когда и кем. */
  lastStatus: { at: Date; by: string | null } | null;
  amount: number | null;
  amountAuto: boolean;
  payDue: IsoDate | null;
  pays: string;
  responsible: { id: string; shortName: string } | null;
  formCode: string;
  ownershipForm: string;
  regime: string | null;
  audit: AuditRecord;
  version: number;
}

/** Праздник или перенос выходного на дату срока по закону — на эту дату или «каждый год» (прототип holidayName). */
const DUE_HOLIDAY = sql<
  string | null
>`case when ${reports.dueDate} <> ${reports.dueBase} and not ${reports.dueManual} then coalesce((select h.name from ${productionCalendar} h where h.kind in ('holiday', 'transfer') and h.day in (${reports.dueBase}::text, to_char(${reports.dueBase}, 'MM-DD')) order by length(h.day) desc limit 1), '') end`;

/** Последняя смена статуса отчёта: поле записи «Истории статусов». */
const lastStatus = (field: SQL) =>
  sql`(select ${field} from ${statusHistory} where ${statusHistory.orgId} = ${reports.orgId} and ${statusHistory.scale} = 'report' and ${statusHistory.entityId} = ${reports.id} order by ${statusHistory.at} desc, ${statusHistory.id} desc limit 1)`;
const LAST_STATUS_AT = lastStatus(sql`${statusHistory.at}`);
const LAST_STATUS_USER = lastStatus(sql`${statusHistory.actorUserId}`);
const LAST_STATUS_NAME = lastStatus(
  sql`(select e.short_name from ${employees} e where e.user_id = ${statusHistory.actorUserId})`,
);

function rowFields(today: IsoDate) {
  return {
    id: reports.id,
    contractorId: reports.contractorId,
    contractorName: contractors.name,
    inn: contractors.inn,
    taxOffice: TAX_OFFICE_LABEL,
    typeCode: reports.reportTypeCode,
    typeName: reportTypes.name,
    typeShort: reportTypes.shortName,
    act: reports.act,
    rate: RATE,
    organ: authorities.name,
    period: reports.period,
    periodStart: reports.periodStart,
    eventDate: reports.eventDate,
    periodLabel: PERIOD_LABEL,
    periodFull: PERIOD_FULL,
    revision: reports.revision,
    dueDate: reports.dueDate,
    dueBase: reports.dueBase,
    dueManual: reports.dueManual,
    dueHoliday: DUE_HOLIDAY,
    days: sql<
      number | null
    >`case when ${DONE} then null else ${reports.dueDate} - ${dateLiteral(today)} end`,
    overdue: sql<boolean>`${overdueOf(today)}`,
    status: reports.status,
    submittedOn: reports.submittedOn,
    submittedAt: reports.submittedAt,
    submitterId: submitter.id,
    submitterName: submitter.shortName,
    waitDays: sql<
      number | null
    >`case when ${reports.status} = 'submitted' and ${reports.act} <> 'pay' and ${reports.confirmedAt} is null then ${dateLiteral(today)} - ${SUBMITTED_DAY} end`,
    confirmedAt: reports.confirmedAt,
    confirmerId: confirmer.id,
    confirmerName: confirmer.shortName,
    statusAt: LAST_STATUS_AT,
    statusUser: LAST_STATUS_USER,
    statusName: LAST_STATUS_NAME,
    amount: reports.amount,
    amountAuto: reports.amountAuto,
    payDue: reports.payDue,
    pays: PAYS,
    responsibleId: reports.responsibleEmployeeId,
    responsibleName: responsible.shortName,
    formCode: reportTypes.formCode,
    ownershipForm: ownershipForms.name,
    regime: regime.name,
    createdAt: reports.createdAt,
    createdBy: reports.createdBy,
    createdByName: creator.shortName,
    updatedAt: reports.updatedAt,
    updatedBy: reports.updatedBy,
    updatedByName: updater.shortName,
    version: reports.version,
  };
}

type RowData = Record<keyof ReturnType<typeof rowFields>, unknown>;

/** Момент из строки запроса: в подзапросе `sql` он приходит строкой, а не `Date`. */
const momentOf = (v: unknown): Date | null => (v == null ? null : new Date(v as string | Date));

const personOf = (id: unknown, name: unknown) =>
  id ? { id: id as string, shortName: (name as string | null) ?? '' } : null;

function toRow(r: RowData): ReportRow {
  const responsibleId = r.responsibleId as string | null;
  const amount = r.amount as number | string | null;
  return {
    id: r.id as string,
    contractor: {
      id: r.contractorId as string,
      name: r.contractorName as string,
      inn: r.inn as string,
    },
    taxOffice: r.taxOffice as string | null,
    type: {
      code: r.typeCode as string,
      name: r.typeName as string,
      shortName: r.typeShort as string,
    },
    act: r.act as ReportAct,
    rate: (r.rate as string | null) || null,
    organ: r.organ as string,
    period: r.period as ReportPeriod,
    periodStart: r.periodStart as IsoDate,
    eventDate: r.eventDate as IsoDate | null,
    periodLabel: r.periodLabel as string,
    periodFull: r.periodFull as string,
    revision: Number(r.revision),
    dueDate: r.dueDate as IsoDate,
    dueBase: r.dueBase as IsoDate,
    dueManual: Boolean(r.dueManual),
    dueHoliday: (r.dueHoliday as string | null) ?? null,
    days: r.days == null ? null : Number(r.days),
    overdue: Boolean(r.overdue),
    status: r.status as ReportStatus,
    submittedOn: r.submittedOn as IsoDate | null,
    submittedAt: momentOf(r.submittedAt),
    submittedBy: personOf(r.submitterId, r.submitterName),
    waitDays: r.waitDays == null ? null : Number(r.waitDays),
    confirmedAt: momentOf(r.confirmedAt),
    confirmedBy: personOf(r.confirmerId, r.confirmerName),
    lastStatus: r.statusAt
      ? {
          at: momentOf(r.statusAt)!,
          by: auditActorName(r.statusUser as string | null, r.statusName as string | null),
        }
      : null,
    amount: amount == null ? null : Number(amount),
    amountAuto: Boolean(r.amountAuto),
    payDue: r.payDue as IsoDate | null,
    pays: (r.pays as string | null) ?? '',
    responsible: responsibleId
      ? { id: responsibleId, shortName: (r.responsibleName as string | null) ?? '' }
      : null,
    formCode: r.formCode as string,
    ownershipForm: r.ownershipForm as string,
    regime: r.regime as string | null,
    audit: {
      createdAt: r.createdAt as Date,
      createdBy: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
      updatedAt: r.updatedAt as Date,
      updatedBy: auditActorName(r.updatedBy as string | null, r.updatedByName as string | null),
    },
    version: r.version as number,
  };
}

const REPORT_NATURAL = [reports.dueDate, reports.id];

const columnsOf = (o: ReportListOptions) =>
  reportListColumns(o.t, { today: o.today, confirm: o.waiting.confirm });
/** Как на экране (ТЗ «Списки записей», прототип defSort): от новых к старым по «Создано». */
const DEFAULT_SORT = { key: 'createdAt', dir: 'desc' } as const;

const listFrom =
  (tx: Tx, texts: SQL): ListFrom =>
  (fields) =>
    fromReports(tx, fields, texts);

/** Страница списка отчётов: по умолчанию — по сроку сдачи (прототип repGrid: sort due). */
export async function listReportsPage(
  tx: Tx,
  query: ListQuery,
  o: ReportListOptions,
): Promise<ListPageResult<ReportRow>> {
  const texts = await listTexts(tx, o.t, o.today);
  const fields = rowFields(o.today);
  const page = await selectListPage({
    query,
    columns: columnsOf(o),
    natural: REPORT_NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: listScope(o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromReports(tx, { ...fields, ...window } as typeof fields & ListWindowFields, texts)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (RowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: listFrom(tx, texts),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r as RowData)) };
}

/** Значения столбца для фильтра-галочек — в той же области и вкладке. */
export async function listReportValues(tx: Tx, key: string, o: ReportListOptions, q?: string) {
  const texts = await listTexts(tx, o.t, o.today);
  return selectListValues({
    columns: columnsOf(o),
    key,
    scope: listScope(o),
    from: listFrom(tx, texts),
    q,
  });
}

/** Отчёты для выгрузки в Excel: все под поиском и фильтрами. */
export async function exportReports(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: ReportListOptions,
) {
  const texts = await listTexts(tx, o.t, o.today);
  return selectListExport({
    query,
    columns: columnsOf(o),
    keys,
    natural: REPORT_NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: listScope(o),
    from: listFrom(tx, texts),
  });
}

/**
 * Подтверждение сдачи в учётной политике: включено ли (вкладка «Ожидают подтверждения», отметки на
 * шаге «Сдан») и через сколько дней ожидания напоминать старшим бухгалтерам.
 */
export async function reportConfirmPolicy(
  tx: Tx,
  orgId: string,
): Promise<{ confirm: boolean; waitDays: number }> {
  const [r] = await tx
    .select({ confirm: orgSettings.reportConfirm, waitDays: orgSettings.confirmWaitDays })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId));
  return { confirm: r?.confirm ?? false, waitDays: r?.waitDays ?? 3 };
}

/** Числа быстрого фильтра «Все / Сдать / Уплатить» одной вкладки. */
export interface ReportQuickCounts {
  all: number;
  sub: number;
  pay: number;
}

/** Счётчики вкладок, плашек и быстрого фильтра (прототип counts, renderReports). */
export interface ReportSummary {
  overdue: number;
  week: number;
  waiting: number;
  /** «Сдано в этом месяце»: сданные со сдачей, дата сдачи — в текущем месяце. */
  submittedMonth: number;
  /** «К уплате за <месяц>»: суммы больше нуля со сроком оплаты в текущем месяце, тыйыны. */
  toPayMonth: number;
  /** Быстрый фильтр каждой вкладки — без фильтров и поиска списка (прототип: `base()`). */
  quick: Record<ReportTab, ReportQuickCounts>;
  /** В организации ещё нет ни одного отчёта (прототип ui/empty.js, `firstEmpty`). */
  empty: boolean;
}

/**
 * Счётчики вкладок и плашек в области сотрудника (прототип counts, renderReports): просрочено, на этой
 * неделе, ожидают подтверждения, «Сдано в этом месяце», «К уплате за <месяц>» и числа быстрого
 * фильтра на каждой вкладке — одним проходом по отчётам.
 */
export async function reportSummary(
  tx: Tx,
  o: { scope: SQL | undefined; today: IsoDate; waiting: ReportWaitingView },
): Promise<ReportSummary> {
  const month = o.today.slice(0, 7);
  const from = dateLiteral(`${month}-01`);
  const to = sql`(${from} + interval '1 month' - interval '1 day')::date`;
  const count = (where: SQL | undefined) =>
    sql<number>`count(*) filter (where ${where ?? sql`true`})`.mapWith(Number);
  const tabs = Object.fromEntries(
    REPORT_TABS.flatMap((tab) => {
      const base = tabCondition({ tab, today: o.today, waiting: o.waiting });
      return REPORT_QUICK.map((q) => [`${tab}_${q}`, count(and(base, quickOf(q)))]);
    }),
  );
  const [row] = await tx
    .select({
      ...tabs,
      submitted: count(
        sql`${reports.status} = 'submitted' and ${reports.act} <> 'pay' and ${reports.submittedOn} between ${from} and ${to}`,
      ),
      toPay:
        sql<number>`coalesce(sum(${reports.amount}) filter (where ${reports.act} <> 'sub' and ${reports.amount} > 0 and ${reports.payDue} between ${from} and ${to}), 0)`.mapWith(
          Number,
        ),
      empty: sql<boolean>`not exists (select 1 from ${reports})`,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .where(and(eq(reports.superseded, false), o.scope));
  const r = (row ?? {}) as Record<string, unknown>;
  const n = (key: string) => Number(r[key] ?? 0);
  const quick = Object.fromEntries(
    REPORT_TABS.map((tab) => [
      tab,
      { all: n(`${tab}_all`), sub: n(`${tab}_sub`), pay: n(`${tab}_pay`) },
    ]),
  ) as Record<ReportTab, ReportQuickCounts>;
  return {
    overdue: quick.overdue.all,
    week: quick.week.all,
    waiting: quick.waiting.all,
    submittedMonth: n('submitted'),
    toPayMonth: n('toPay'),
    quick,
    empty: Boolean(r.empty),
  };
}

/** Одна строка списка по id (карточка берёт поля строки и добавляет своё); null — нет или вне области. */
export async function getReportRow(
  tx: Tx,
  id: string,
  o: { t: ListTexts; today: IsoDate; scope: SQL | undefined },
): Promise<ReportRow | null> {
  const texts = await listTexts(tx, o.t, o.today);
  const [row] = await fromReports(tx, rowFields(o.today), texts).where(
    and(eq(reports.id, id), o.scope),
  );
  return row ? toRow(row as RowData) : null;
}

/** Изменение срока в карточке: было → стало, причина из справочника, комментарий, кто и когда. */
export interface ReportDueChange {
  at: Date;
  fromDue: IsoDate | null;
  toDue: IsoDate;
  reason: string;
  comment: string;
  actor: string | null;
}

/** Карточка отчёта: поля строки, назначение, изменения срока, «История статусов» и версии периода. */
export interface ReportCard extends ReportRow {
  assignment: {
    id: string;
    rateText: string;
    fixedAmount: number | null;
    note: string;
    endedOn: IsoDate | null;
  } | null;
  dueChanges: ReportDueChange[];
  statusHistory: StatusHistoryItem[];
  /** Все версии того же периода (первичный и уточнённые), сначала последняя. */
  versions: {
    id: string;
    revision: number;
    status: ReportStatus;
    dueDate: IsoDate;
    superseded: boolean;
  }[];
  superseded: boolean;
}

const dueActor = alias(employees, 'due_actor');

/**
 * Карточка отчёта (прототип modules/report-card.js): всё из строки списка, ставка назначения
 * полностью, журнал изменений срока, «История статусов» и версии периода; null — нет или вне области.
 * Прежние версии уточнённых открываются по ссылке из карточки.
 */
export async function getReportCard(
  tx: Tx,
  id: string,
  o: { t: ListTexts; today: IsoDate; scope: SQL | undefined },
): Promise<ReportCard | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const texts = await listTexts(tx, o.t, o.today);
  const [row] = await fromReports(
    tx,
    {
      ...rowFields(o.today),
      superseded: reports.superseded,
      assignmentId: assignments.id,
      assignmentType: assignments.reportTypeCode,
      assignmentRate: assignments.rate,
      assignmentEnRates: assignments.enRates,
      assignmentAdditions: assignments.rateAdditions,
      assignmentFixed: assignments.fixedAmount,
      assignmentNote: assignments.note,
      assignmentEnded: assignments.endedOn,
    },
    texts,
  ).where(and(eq(reports.id, id), o.scope));
  if (!row) return null;
  const base = toRow(row as RowData);
  const [dueChanges, statusHistory, versions, rates, [type]] = await Promise.all([
    tx
      .select({
        at: reportDueChanges.createdAt,
        fromDue: reportDueChanges.fromDue,
        toDue: reportDueChanges.toDue,
        reason: dueChangeReasons.name,
        comment: reportDueChanges.comment,
        actorUserId: reportDueChanges.createdBy,
        actorName: dueActor.shortName,
      })
      .from(reportDueChanges)
      .innerJoin(dueChangeReasons, eq(dueChangeReasons.code, reportDueChanges.reasonCode))
      .leftJoin(dueActor, eq(dueActor.userId, reportDueChanges.createdBy))
      .where(eq(reportDueChanges.reportId, id))
      .orderBy(asc(reportDueChanges.createdAt), asc(reportDueChanges.id)),
    readStatusHistory(tx, 'report', id),
    tx
      .select({
        id: reports.id,
        revision: reports.revision,
        status: reports.status,
        dueDate: reports.dueDate,
        superseded: reports.superseded,
      })
      .from(reports)
      // Версии — в той же области: прежнюю версию видит ответственный за неё, новую уже могли передать.
      .innerJoin(contractors, eq(contractors.id, reports.contractorId))
      .where(
        and(
          o.scope,
          eq(reports.contractorId, base.contractor.id),
          eq(reports.reportTypeCode, base.type.code),
          eq(reports.periodStart, base.periodStart),
          base.eventDate
            ? eq(reports.eventDate, base.eventDate)
            : sql`${reports.eventDate} is null`,
        ),
      )
      .orderBy(desc(reports.revision)),
    tx
      .select({
        code: singleTaxRates.code,
        rate: singleTaxRates.rate,
        rateCashless: singleTaxRates.rateCashless,
        rateCash: singleTaxRates.rateCash,
      })
      .from(singleTaxRates),
    tx
      .select({ rateAdditions: reportTypes.rateAdditions })
      .from(reportTypes)
      .where(eq(reportTypes.code, base.type.code)),
  ]);
  const r = row as Record<string, unknown>;
  const assignmentId = r.assignmentId as string | null;
  return {
    ...base,
    superseded: Boolean(r.superseded),
    assignment: assignmentId
      ? {
          id: assignmentId,
          // Ставка по датам — та, что действует на начало периода (прототип rateOf: r.pkey).
          rateText: assignmentRateText(
            {
              reportTypeCode: r.assignmentType as string,
              rate: r.assignmentRate as string | null,
              enRates: (r.assignmentEnRates as AssignmentRate['enRates']) ?? [],
              rateAdditions: (r.assignmentAdditions as string[]) ?? [],
            },
            { rateAdditions: type?.rateAdditions ?? [] },
            rates,
            { date: base.periodStart },
            translate(o.t),
          ),
          fixedAmount: r.assignmentFixed == null ? null : Number(r.assignmentFixed),
          note: (r.assignmentNote as string) ?? '',
          endedOn: r.assignmentEnded as IsoDate | null,
        }
      : null,
    dueChanges: dueChanges.map(({ actorUserId, actorName, ...c }) => ({
      ...c,
      actor: auditActorName(actorUserId, actorName),
    })),
    statusHistory,
    versions,
  };
}
