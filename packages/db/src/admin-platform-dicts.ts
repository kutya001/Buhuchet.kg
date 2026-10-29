import {
  ADMIN_DICT_COLUMNS,
  ADMIN_DICT_META,
  adminDictDefaultSort,
  auditActorName,
  badBaseTypes,
  badBenefitOffices,
  badBenefitTypes,
  benefitDueRulesProblem,
  dictStatusKey,
  dictValueProblems,
  dueRuleText,
  formatText,
  inactiveLinks,
  maskDigits,
  NEW_REPORT_TYPE,
  nextDictCode,
  payRuleText,
  paysText,
  phoneCodeExample,
  regimeAccountantNote,
  REPORT_TYPE_RULE_FIELDS,
  reportTypeProblems,
  toHistoryValue,
  sameHistoryValue,
  type AdminValueDict,
  type AuthorityContact,
  type BenefitDueOverride,
  type DictUsage,
  type DictValueProblem,
  type HistoryChange,
  type HistoryValue,
  type DueFrom,
  type ListQuery,
  type PayRule,
  type ReportAct,
  type ReportKind,
  type ReportPayment,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { withOrgContext } from './context';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import { orgIds } from './organizations';
import { writePlatformHistory } from './platform-history';
import { activeAssignmentCounts } from './reports';
import {
  authorities,
  banks,
  countryPhoneCodes,
  dueChangeReasons,
  ownershipForms,
  platformAuditLog,
  reportBases,
  reportTypeBases,
  reportTypeRegimes,
  reportTypes,
  singleTaxRates,
  taskCategories,
  taxBenefitDueRules,
  taxBenefitOffices,
  taxBenefitReportTypes,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from './schema';

/*
 * Админка → «Справочники платформы» (задача 2.36; ТЗ «Общие правила для всех справочников»; прототип
 * admin/platform-dicts.js, renderPDicts0): список значений справочника со столбцами «№»,
 * «Используется», «Статус» и служебными, и правка — добавить, изменить, «Выше»/«Ниже», отключить,
 * удалить неиспользуемое. Таблицы справочников роль приложения только читает: пишут функции
 * администратора платформы (`app.admin_dict_*`, миграция 0043) по перечню `app.platform_dict_specs`.
 * Все вызовы — в `withUserContext` администратора; «было → стало» — в историю платформы
 * (`platform_dict`, ключ `<справочник>:<код>`) в той же транзакции.
 */

/** Таблица справочника: общие столбцы справочников платформы (код, название, порядок, служебные). */
type DictTable = PgTable & {
  code: PgColumn;
  name: PgColumn;
  active: PgColumn;
  sortOrder: PgColumn;
  version: PgColumn;
};

const TABLES: Readonly<Record<AdminValueDict, DictTable>> = {
  types: reportTypes,
  bases: reportBases,
  regimes: taxRegimes,
  benefits: taxBenefits,
  forms: ownershipForms,
  phones: countryPhoneCodes,
  organs: authorities,
  ugns: taxOffices,
  banks,
  cats: taskCategories,
  reasons: dueChangeReasons,
};

/**
 * Поля значения сверх кода и названия — как в таблице (`contacts` — массив, `gnsCode` и `validUntil` —
 * null, `byPhone` и `verify` — да или нет); поле-связь — коды связанных значений (`types` основания),
 * «Меняет сроки» статуса — строки сроков (`dueRules`). У вида отчёта ещё числа срока, платежи и
 * график оплаты ([месяц, число]).
 */
export type AdminDictData = Record<
  string,
  | string
  | number
  | boolean
  | null
  | AuthorityContact[]
  | string[]
  | BenefitDueOverride[]
  | ReportPayment[]
  | [number, number][]
>;

/** Отчёты организаций по виду отчёта: всего, несданных и в скольких организациях. */
export interface TypeReportCounts {
  total: number;
  open: number;
  orgs: number;
}

/** Значение справочника в Админке. */
export interface AdminDictValueRecord {
  code: string;
  /** «№» — место в порядке справочника; у справочника без порядка — null. */
  n: number | null;
  name: string;
  data: AdminDictData;
  active: boolean;
  usage: DictUsage;
  /** У вида отчёта в списке — столбцы словами (срок сдачи, «Что уплачивается», орган…). */
  texts?: Record<string, string>;
  /** У вида отчёта — созданные по нему отчёты (для предупреждений окна вида). */
  reports?: TypeReportCounts;
  /** У вида отчёта в списке — «Назначен»: у скольких контрагентов вид назначен сейчас. */
  assigned?: number;
  audit: {
    createdAt: Date | null;
    createdBy: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  };
  version: number;
}

type TableRow = Record<string, unknown> & {
  code: string;
  name: string;
  active: boolean;
  version: number;
  createdAt: Date | null;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

/** Поля правки справочника без названия (`ADMIN_DICT_META.fields`). */
const dataFields = (dict: AdminValueDict) =>
  ADMIN_DICT_META[dict].fields.filter((f) => f !== 'name');

/** Поля-связи справочника: хранятся в таблице связей, не в столбцах значения. */
const linkFields = (dict: AdminValueDict) => ADMIN_DICT_META[dict].links ?? [];
const isLink = (dict: AdminValueDict, f: string) => linkFields(dict).includes(f);
/** «Меняет сроки» статуса: строки своей таблицы, не столбец значения. */
const isDueRules = (dict: AdminValueDict, f: string) =>
  f === 'dueRules' && ADMIN_DICT_META[dict].dueRules === true;
/** Поле значения, которое хранится в столбце его таблицы. */
const isColumn = (dict: AdminValueDict, f: string) => !isLink(dict, f) && !isDueRules(dict, f);

/**
 * Вид отчёта для выбора в окнах основания и статуса и подписи «Виды отчётов»: в порядке каталога; с
 * правилом срока сдачи — для строк «Меняет сроки» статуса.
 */
export interface ReportTypeOption {
  code: string;
  name: string;
  shortName: string;
  kind: ReportKind;
  active: boolean;
  period: ReportPeriod;
  dueDay: number;
  dueAfter: number | null;
  dueMonth: number | null;
  dueFrom: DueFrom;
  act: ReportAct;
  oneOff: boolean;
  periodPerAssignment: boolean;
}

/** Каталог видов отчётов кратко: для выбора видов у основания и статуса и подписей связей. */
export async function reportTypeOptions(tx: Tx): Promise<ReportTypeOption[]> {
  return tx
    .select({
      code: reportTypes.code,
      name: reportTypes.name,
      shortName: reportTypes.shortName,
      kind: reportTypes.kind,
      active: reportTypes.active,
      period: reportTypes.period,
      dueDay: reportTypes.dueDay,
      dueAfter: reportTypes.dueAfter,
      dueMonth: reportTypes.dueMonth,
      dueFrom: reportTypes.dueFrom,
      act: reportTypes.act,
      oneOff: reportTypes.oneOff,
      periodPerAssignment: reportTypes.periodPerAssignment,
    })
    .from(reportTypes)
    .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code));
}

/** Поля-связи и «Меняет сроки» значений: код значения → поле → коды или строки сроков. */
type LinkValues = Map<string, Record<string, string[] | BenefitDueOverride[]>>;

/** Добавить связанное значение в поле значения `code`. */
function pushLink(links: LinkValues, code: string, field: string, value: unknown) {
  const own = links.get(code) ?? {};
  ((own[field] ??= []) as unknown[]).push(value);
  links.set(code, own);
}

/**
 * Поля-связи каждого значения: виды отчётов основания (по полю «Основание» вида; ТЗ «связь с видами
 * правится с любой стороны»), у статуса — «Делает ненужными», «Добавляет» и «Меняет сроки» в порядке
 * каталога видов, «Ставится по УГНС» — в порядке справочника УГНС; у вида отчёта — «Применимые
 * режимы», «Не для режимов» и «Основания» в порядке своих справочников.
 */
async function linkValues(tx: Tx, dict: AdminValueDict): Promise<LinkValues> {
  const links: LinkValues = new Map();
  const byCatalog = [asc(reportTypes.sortOrder), asc(reportTypes.code)];
  if (dict === 'types') {
    const [regimes, bases] = await Promise.all([
      tx
        .select({
          code: reportTypeRegimes.reportTypeCode,
          link: reportTypeRegimes.regimeCode,
          relation: reportTypeRegimes.relation,
        })
        .from(reportTypeRegimes)
        .innerJoin(taxRegimes, eq(taxRegimes.code, reportTypeRegimes.regimeCode))
        .orderBy(asc(taxRegimes.sortOrder), asc(taxRegimes.code)),
      tx
        .select({ code: reportTypeBases.reportTypeCode, link: reportTypeBases.baseCode })
        .from(reportTypeBases)
        .innerJoin(reportBases, eq(reportBases.code, reportTypeBases.baseCode))
        .orderBy(asc(reportBases.sortOrder), asc(reportBases.code)),
    ]);
    for (const r of regimes) {
      pushLink(links, r.code, r.relation === 'applies' ? 'regimes' : 'notForRegimes', r.link);
    }
    for (const r of bases) pushLink(links, r.code, 'bases', r.link);
  }
  if (dict === 'bases') {
    const rows = await tx
      .select({ code: reportTypeBases.baseCode, link: reportTypeBases.reportTypeCode })
      .from(reportTypeBases)
      .innerJoin(reportTypes, eq(reportTypes.code, reportTypeBases.reportTypeCode))
      .orderBy(...byCatalog);
    for (const r of rows) pushLink(links, r.code, 'types', r.link);
  }
  if (dict === 'benefits') {
    const [types, offices, rules] = await Promise.all([
      tx
        .select({
          code: taxBenefitReportTypes.benefitCode,
          link: taxBenefitReportTypes.reportTypeCode,
          effect: taxBenefitReportTypes.effect,
        })
        .from(taxBenefitReportTypes)
        .innerJoin(reportTypes, eq(reportTypes.code, taxBenefitReportTypes.reportTypeCode))
        .orderBy(...byCatalog),
      tx
        .select({ code: taxBenefitOffices.benefitCode, link: taxBenefitOffices.taxOfficeCode })
        .from(taxBenefitOffices)
        .innerJoin(taxOffices, eq(taxOffices.code, taxBenefitOffices.taxOfficeCode))
        .orderBy(asc(taxOffices.sortOrder), asc(taxOffices.code)),
      tx
        .select({
          code: taxBenefitDueRules.benefitCode,
          reportType: taxBenefitDueRules.reportTypeCode,
          dueDay: taxBenefitDueRules.dueDay,
          dueAfter: taxBenefitDueRules.dueAfter,
          dueMonth: taxBenefitDueRules.dueMonth,
          payDay: taxBenefitDueRules.payDay,
          payAfter: taxBenefitDueRules.payAfter,
        })
        .from(taxBenefitDueRules)
        .innerJoin(reportTypes, eq(reportTypes.code, taxBenefitDueRules.reportTypeCode))
        .orderBy(...byCatalog),
    ]);
    for (const r of types) pushLink(links, r.code, r.effect, r.link);
    for (const r of offices) pushLink(links, r.code, 'offices', r.link);
    for (const { code, ...rule } of rules) pushLink(links, code, 'dueRules', rule);
  }
  return links;
}

/**
 * Поле значения из строки таблицы. «Для бухгалтера:» в начале пояснения режима (так оно в наполнении)
 * не показывается и не сохраняется: подпись уже есть у столбца и поля (прототип `accTxt`).
 */
function dataValue(f: string, value: unknown): AdminDictData[string] {
  if (f === 'accountantNote' && typeof value === 'string') return regimeAccountantNote(value);
  return (value ?? null) as AdminDictData[string];
}

/**
 * Сколько раз используется каждое значение (`app.admin_dict_usage`): всего и у контрагентов —
 * ссылками из любых таблиц, в том числе организаций.
 */
export async function adminDictUsage(
  tx: Tx,
  dict: AdminValueDict,
): Promise<Map<string, DictUsage>> {
  const rows = await tx.execute<{ code: string; ref: string; n: number | string }>(
    sql`select code, ref, n from app.admin_dict_usage(${dict})`,
  );
  const usage = new Map<string, DictUsage>();
  const contractors = ADMIN_DICT_META[dict].contractorTable;
  for (const r of rows) {
    const u = usage.get(r.code) ?? { total: 0, contractors: 0 };
    const n = Number(r.n);
    u.total += n;
    if (r.ref === contractors) u.contractors += n;
    usage.set(r.code, u);
  }
  return usage;
}

const NO_USAGE: DictUsage = { total: 0, contractors: 0 };
const NO_REPORTS: TypeReportCounts = { total: 0, open: 0, orgs: 0 };

/**
 * Отчёты организаций по видам отчётов — всего, несданных и в скольких организациях (прототип
 * typeEditDlg: «По этому виду уже создано N отчётов», `spreadTxt`). Отчётов организаций ещё нет —
 * счёт подключит задача отчётов (правило стыков, docs/decisions.md п. Д-6).
 */
async function typeReportCounts(_tx: Tx): Promise<Map<string, TypeReportCounts>> {
  return new Map();
}

/** Все значения справочника в его порядке (`sort_order`, при равных — код), с «№» и «Используется». */
export async function adminDictRecords(tx: Tx, dict: AdminValueDict): Promise<AdminDictValueRecord[]> {
  const table = TABLES[dict];
  const [rows, usage, links, reports] = await Promise.all([
    tx.select().from(table).orderBy(asc(table.sortOrder), asc(table.code)) as unknown as Promise<
      TableRow[]
    >,
    adminDictUsage(tx, dict),
    linkValues(tx, dict),
    dict === 'types' ? typeReportCounts(tx) : null,
  ]);
  const ordered = ADMIN_DICT_META[dict].ordered;
  return rows.map((r, i) => {
    const createdBy = auditActorName(r.createdBy, null);
    return {
      code: r.code,
      n: ordered ? i + 1 : null,
      name: r.name,
      data: Object.fromEntries(
        dataFields(dict).map((f) => [
          f,
          isColumn(dict, f) ? dataValue(f, r[f]) : (links.get(r.code)?.[f] ?? []),
        ]),
      ),
      active: r.active,
      usage: usage.get(r.code) ?? NO_USAGE,
      ...(reports ? { reports: reports.get(r.code) ?? NO_REPORTS } : {}),
      audit: {
        createdAt: r.createdAt,
        createdBy,
        updatedAt: r.updatedAt,
        updatedBy: auditActorName(r.updatedBy, null) ?? createdBy,
      },
      version: r.version,
    };
  });
}

/* ───────────── Список ───────────── */

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

/** Телефоны органа одной строкой: «Колл-центр: 1202; Приёмная: …». */
const contactsText = (value: unknown) =>
  Array.isArray(value)
    ? (value as AuthorityContact[]).map((c) => `${c.label}: ${c.value}`).join('; ')
    : '';

/** Названия для столбцов списка: краткие названия видов отчётов, названия органов и режимов. */
interface ListNames {
  types: ReadonlyMap<string, string>;
  authorities: ReadonlyMap<string, string>;
  regimes: ReadonlyMap<string, string>;
}

async function listNames(tx: Tx, dict: AdminValueDict): Promise<ListNames> {
  const [types, organs, regimes] = await Promise.all([
    dict === 'bases' || dict === 'benefits' ? reportTypeOptions(tx) : [],
    dict === 'types'
      ? tx.select({ code: authorities.code, name: authorities.name }).from(authorities)
      : [],
    dict === 'types'
      ? tx.select({ code: taxRegimes.code, name: taxRegimes.name }).from(taxRegimes)
      : [],
  ]);
  return {
    types: new Map(types.map((x) => [x.code, x.shortName])),
    authorities: new Map(organs.map((x) => [x.code, x.name])),
    regimes: new Map(regimes.map((x) => [x.code, x.name])),
  };
}

/** Поля вида отчёта, из которых считаются столбцы словами. */
interface TypeData extends PayRule {
  authorityCode: string;
  payments: ReportPayment[];
  rates: string[];
  regimes: string[];
  payer: string;
}

const translate =
  (t: ListTexts): Translate =>
  (key, params) =>
    formatText(t(key), params);

/**
 * Столбцы вида отчёта словами — как в прототипе (`adm-types`): «Что сделать», «Что уплачивается»
 * (`paysText`), орган, периодичность, срок сдачи и оплаты (`dueRuleText`, `payRuleText`; у «Сдачи»
 * срока оплаты нет), ставки, режимы и «Для кого».
 */
function typeTexts(x: AdminDictValueRecord, t: Translate, names: ListNames) {
  const d = x.data as unknown as TypeData;
  const organ = (code: string) => names.authorities.get(code) ?? code;
  return {
    act: t(`report.act.${d.act}`),
    pays: paysText(
      d.payments.map((p) => ({ name: p.name, authority: organ(p.authority) })),
      organ(d.authorityCode),
    ),
    authorityCode: organ(d.authorityCode),
    period: t(`report.period.${d.period.toLowerCase() as Lowercase<ReportPeriod>}`),
    rule: dueRuleText(d, t),
    payRule: d.act === 'sub' ? '' : payRuleText(d, t),
    rates: d.rates.join('; '),
    regimes: d.regimes.map((code) => names.regimes.get(code) ?? code).join(', '),
    payer: t(`pdicts.type.payer.${d.payer as 'all' | 'org' | 'ip'}`),
  };
}

/**
 * Строка списка для `jsonb_to_recordset`: тексты столбцов, подписи кодов и служебные поля; поле-связь
 * — краткими названиями связанных видов отчётов (`names`). У вида отчёта — столбцы словами
 * (`typeTexts`).
 */
function listRow(
  dict: AdminValueDict,
  x: AdminDictValueRecord,
  ord: number,
  t: ListTexts,
  names: ListNames,
) {
  const row: Record<string, string | number | null> = {
    id: x.code,
    ord,
    n: x.n,
    code: x.code,
    name: x.name,
    used: x.usage.total,
    contractors: x.usage.contractors,
    active: x.active ? 'on' : 'off',
    active_text: t(dictStatusKey(dict, x.active)),
    created_at: x.audit.createdAt?.toISOString() ?? null,
    updated_at: x.audit.updatedAt.toISOString(),
    created_by: x.audit.createdBy,
    updated_by: x.audit.updatedBy,
  };
  if (dict === 'types') {
    const d = x.data;
    const texts = x.texts ?? {};
    return {
      ...row,
      shortName: d.shortName as string,
      formCode: d.formCode as string,
      act: d.act as string,
      act_text: texts.act ?? '',
      pays: texts.pays ?? '',
      authorityCode: d.authorityCode as string,
      authorityCode_text: texts.authorityCode ?? '',
      period: d.period as string,
      period_text: texts.period ?? '',
      rule: texts.rule ?? '',
      payRule: texts.payRule ?? '',
      kind: d.kind as string,
      kind_text: t(`report.kind.${d.kind as string}`),
      rates: texts.rates ?? '',
      regimes: texts.regimes ?? '',
      payer: d.payer as string,
      payer_text: texts.payer ?? '',
      assigned: x.assigned ?? 0,
    };
  }
  for (const f of dataFields(dict)) {
    const value = x.data[f];
    // «Меняет сроки» и «Ставится по УГНС» — не столбцы списка.
    if (isDueRules(dict, f) || f === 'offices') continue;
    if (f === 'contacts') row[f] = contactsText(value);
    else if (isLink(dict, f))
      row[f] = (value as string[]).map((code) => names.types.get(code) ?? code).join(', ');
    else if (f === 'byPhone' || f === 'verify') row[f] = value ? 'yes' : 'no';
    else if (f === 'validUntil') row[f] = (value as string | null) ?? null;
    else row[f] = (value as string | null) ?? '';
  }
  if (dict === 'forms') row.declarationFor_text = t(`dicts.platform.end.${x.data.declarationFor}`);
  const kind = ADMIN_DICT_META[dict].kind;
  if (kind) row.kind_text = t(`${kind.text}.${x.data.kind as string}`);
  if (dict === 'banks') {
    row.byPhone_text = t(x.data.byPhone ? 'pdicts.bank.by_phone.yes' : 'pdicts.bank.by_phone.no');
  }
  if (dict === 'phones') {
    // «Цифр» и «Пример» — по маске (прототип: «+996 555 123 456»).
    const mask = x.data.mask as string;
    row.dialCode = `+${x.data.dialCode as string}`;
    row.digits = maskDigits(mask);
    row.example = phoneCodeExample(x.data.dialCode as string, mask);
  }
  return row;
}

const RECORD_TYPES: Readonly<Record<string, string>> = {
  validUntil: 'date',
  digits: 'integer',
  ord: 'integer',
  n: 'integer',
  used: 'integer',
  assigned: 'integer',
  contractors: 'integer',
  created_at: 'timestamptz',
  updated_at: 'timestamptz',
};

/** Строки — одним параметром запроса. */
function recordset(rows: readonly Record<string, string | number | null>[]) {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const defs = keys.map((k) => `"${k}" ${RECORD_TYPES[k] ?? 'text'}`).join(', ');
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(${sql.raw(defs || 'id text')})`;
}

/** Столбцы с кодом в значении (фильтр по коду), на экране и в сортировке — подпись (`<ключ>_text`). */
const TEXT_SHOWN = new Set([
  'active',
  'declarationFor',
  'kind',
  'byPhone',
  'act',
  'authorityCode',
  'period',
  'payer',
]);

/** Столбцы списка справочника на сервере — ключи и подписи, как у экрана (`ADMIN_DICT_COLUMNS`). */
export function adminDictListColumns(dict: AdminValueDict): ListColumns {
  const columns: Record<string, ListColumn> = {};
  for (const c of ADMIN_DICT_COLUMNS[dict]) {
    const column: ListColumn = { type: c.type, label: c.label, value: field(c.key) };
    if (TEXT_SHOWN.has(c.key)) {
      column.display = field(`${c.key}_text`);
      column.sort = { value: field(`${c.key}_text`), text: true };
    }
    if (c.key === 'gnsCode' || isLink(dict, c.key)) {
      column.display = sql`coalesce(nullif(${field(c.key)}, ''), '—')`;
    }
    columns[c.key] = column;
  }
  return {
    ...columns,
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: field('created_at') },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: field('updated_at') },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: field('created_by') },
    updatedBy: { type: 'enum', label: 'grid.col.updated_by', value: field('updated_by') },
  };
}

const NATURAL = [field('ord')];

/** Без выбранной сортировки — порядок справочника или регион (как в прототипе), не «Создано». */
const naturalQuery = (dict: AdminValueDict, query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: adminDictDefaultSort(dict) } : query;

/**
 * «Назначен» видов отчётов (прототип `adm-types`): у скольких контрагентов на обслуживании вид назначен
 * сейчас — по всем организациям. Каждая организация — своя транзакция в её контексте
 * (`activeAssignmentCounts` модуля отчётов): обхода RLS у администратора платформы нет.
 */
export async function adminAssignedTypeCounts(db: Db): Promise<Map<string, number>> {
  const total = new Map<string, number>();
  for (const orgId of await orgIds(db)) {
    const counts = await withOrgContext(db, { orgId }, (tx) => activeAssignmentCounts(tx));
    for (const [code, n] of counts) total.set(code, (total.get(code) ?? 0) + n);
  }
  return total;
}

/** Что список берёт не из таблицы справочника: «Назначен» видов отчётов (`adminAssignedTypeCounts`). */
export interface AdminDictListExtras {
  assigned?: ReadonlyMap<string, number>;
}

async function listSource(
  tx: Tx,
  dict: AdminValueDict,
  t: ListTexts,
  extras: AdminDictListExtras = {},
) {
  const [all, names] = await Promise.all([adminDictRecords(tx, dict), listNames(tx, dict)]);
  const tr = translate(t);
  const records =
    dict === 'types'
      ? all.map((x) => ({
          ...x,
          texts: typeTexts(x, tr, names),
          assigned: extras.assigned?.get(x.code) ?? 0,
        }))
      : all;
  const source = recordset(records.map((x, i) => listRow(dict, x, i + 1, t, names)));
  return { records, source };
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

/** Страница списка справочника: поиск, фильтры, сортировка и группы — общим механизмом списков. */
export async function listAdminDictPage(
  tx: Tx,
  dict: AdminValueDict,
  query: ListQuery,
  t: ListTexts,
  extras?: AdminDictListExtras,
) {
  const { records, source } = await listSource(tx, dict, t, extras);
  const byCode = new Map(records.map((x) => [x.code, x]));
  const page = await selectListPage({
    query: naturalQuery(dict, query),
    columns: adminDictListColumns(dict),
    natural: NATURAL,
    defaultSort: adminDictDefaultSort(dict),
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ id: sql<string>`${field('id')}`, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return { ...page, rows: page.rows.map((r) => byCode.get(r.id)!), count: records.length };
}

/** Значения столбца справочника для фильтра-галочек; `q` — «Найти значение». */
export async function listAdminDictValues(
  tx: Tx,
  dict: AdminValueDict,
  key: string,
  t: ListTexts,
  q?: string,
  extras?: AdminDictListExtras,
) {
  const { source } = await listSource(tx, dict, t, extras);
  return selectListValues({
    columns: adminDictListColumns(dict),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** Справочник для выгрузки в Excel: все значения под поиском и фильтрами, столбцы `keys`. */
export async function exportAdminDict(
  tx: Tx,
  dict: AdminValueDict,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  extras?: AdminDictListExtras,
) {
  const { source } = await listSource(tx, dict, t, extras);
  return selectListExport({
    query: naturalQuery(dict, query),
    columns: adminDictListColumns(dict),
    keys,
    natural: NATURAL,
    defaultSort: adminDictDefaultSort(dict),
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/** Одно значение справочника с «№» и «Используется»; нет такого — null. */
export async function getAdminDictValue(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
): Promise<AdminDictValueRecord | null> {
  return (await adminDictRecords(tx, dict)).find((x) => x.code === code) ?? null;
}

/* ───────────── Правка ───────────── */

/** Поля значения из формы: название и поля справочника (`ADMIN_DICT_META.fields`). */
export interface AdminDictInput {
  name: string;
  data: AdminDictData;
}

/**
 * Поля для функции базы: имена столбцов таблицы, строки без пробелов по краям, пустой код ГНС — null,
 * «Переводы по номеру телефона» — да или нет, пустой «Тип» — тип нового значения справочника.
 */
function dbRow(dict: AdminValueDict, input: AdminDictInput): Record<string, unknown> {
  const columns = getTableColumns(TABLES[dict]) as Record<string, PgColumn>;
  const value = (f: string): unknown => {
    if (f === 'name') return input.name.trim();
    const v = input.data[f];
    if (dict === 'types') return typeValue(f, v);
    if (f === 'contacts') {
      return (Array.isArray(v) ? (v as AuthorityContact[]) : [])
        .map((c) => ({ label: c.label.trim(), value: c.value.trim() }))
        .filter((c) => c.label || c.value);
    }
    if (f === 'byPhone' || f === 'verify') return v === true;
    const text = typeof v === 'string' ? v.trim() : '';
    if (f === 'gnsCode' || f === 'validUntil') return text || null;
    if (f === 'kind') return text || ADMIN_DICT_META[dict].kind?.default;
    if (f === 'payer') return text || 'all';
    if (f === 'accountantNote') return regimeAccountantNote(text);
    return text;
  };
  return Object.fromEntries(
    ADMIN_DICT_META[dict].fields
      .filter((f) => isColumn(dict, f))
      .map((f) => [columns[f]!.name, value(f)]),
  );
}

/** Поля вида отчёта — числами, да или нет, списками и строками (без пробелов по краям). */
const TYPE_NUMBERS = new Set(['dueDay', 'dueAfter', 'dueMonth', 'payDay', 'payAfter', 'payMonth']);
const TYPE_FLAGS = new Set(['shiftToWorkday', 'oneOff', 'preselect', 'verify']);
const TYPE_LISTS = new Set(['rates', 'notForEnRates', 'bizSizes']);

/**
 * Поле вида отчёта для столбца: числа срока, «да»/«нет», списки без пустых и повторов, платежи без
 * пробелов по краям, пустой график оплаты — null; пустые «Тип», «Для кого», периодичность, «Срок
 * считается» и «Группа подбора» — как у нового вида.
 */
function typeValue(f: string, v: unknown): unknown {
  if (TYPE_NUMBERS.has(f)) return typeof v === 'number' ? v : null;
  if (TYPE_FLAGS.has(f)) return v === true;
  if (TYPE_LISTS.has(f)) {
    return [
      ...new Set((Array.isArray(v) ? (v as string[]) : []).map((x) => x.trim()).filter(Boolean)),
    ];
  }
  if (f === 'payments') {
    return (Array.isArray(v) ? (v as ReportPayment[]) : []).map((p) => ({
      name: p.name.trim(),
      authority: p.authority,
      kbk: p.kbk.trim(),
    }));
  }
  if (f === 'paySchedule') return Array.isArray(v) && v.length ? v : null;
  const text = typeof v === 'string' ? v.trim() : '';
  if (f in NEW_REPORT_TYPE) return text || NEW_REPORT_TYPE[f as keyof typeof NEW_REPORT_TYPE];
  return text;
}

/** Поля-связи значения для `app.admin_dict_set_links`: коды без повторов. */
const linkRow = (dict: AdminValueDict, input: AdminDictInput): Record<string, string[]> =>
  Object.fromEntries(
    linkFields(dict).map((f) => [f, [...new Set((input.data[f] as string[] | undefined) ?? [])]]),
  );

/** «Меняет сроки» значения для `app.admin_benefit_set_due_rules`: только поля строки срока. */
const dueRulesOf = (input: AdminDictInput): BenefitDueOverride[] =>
  ((input.data.dueRules as BenefitDueOverride[] | undefined) ?? []).map((r) => ({
    reportType: r.reportType,
    dueDay: r.dueDay ?? null,
    dueAfter: r.dueAfter ?? null,
    dueMonth: r.dueMonth ?? null,
    payDay: r.payDay ?? null,
    payAfter: r.payAfter ?? null,
  }));

/** Поля значения для истории: название и поля справочника, как их сохранит база. */
function historyFields(dict: AdminValueDict, input: AdminDictInput): Record<string, HistoryValue> {
  const columns = getTableColumns(TABLES[dict]) as Record<string, PgColumn>;
  const row = dbRow(dict, input);
  const links = linkRow(dict, input);
  const value = (f: string): unknown => {
    if (isLink(dict, f)) return links[f];
    if (isDueRules(dict, f)) return dueRulesOf(input);
    return row[columns[f]!.name];
  };
  return Object.fromEntries(ADMIN_DICT_META[dict].fields.map((f) => [f, toHistoryValue(value(f))]));
}

/**
 * Что не так с полями-связями: у основания — не сквозные действующие виды (`types`); у статуса —
 * отключённые или внутренние виды (`benefit_types`), один вид и в «Делает ненужными», и в
 * «Добавляет» (`both`), отключённое УГНС (`offices`), строка «Меняет сроки» без нового срока
 * (`no_due`) или с видом, которому свой срок не задать (`due_type`). У вида отчёта: у режимного нет
 * режимов (`regimes_required`), у вида с уплатой нет платежа с названием (`payments_required`),
 * отключённый режим или основание (`regimes`, `bases`), один режим и в «Применимых», и в «Не для
 * режимов» (`regimes_both`), отключённый орган (`authority`), получатель платежа не из справочника
 * органов (`payment_authority`), нет такой ставки единого налога (`en_rates`).
 */
export type AdminDictLinkProblem =
  | 'types'
  | 'benefit_types'
  | 'both'
  | 'offices'
  | 'no_due'
  | 'due_type'
  | 'regimes_required'
  | 'payments_required'
  | 'regimes'
  | 'regimes_both'
  | 'bases'
  | 'authority'
  | 'payment_authority'
  | 'en_rates';

type PreparedLinks =
  | { input: AdminDictInput; bad: null }
  | { input: AdminDictInput; bad: { field: string; problem: AdminDictLinkProblem } };

/**
 * Поля-связи в порядке каталога (как их читает список) и проверка: у основания — только сквозные
 * действующие виды отчётов; уже привязанный остаётся (`badBaseTypes`). У статуса — `prepareBenefit`.
 * Не подходит — поле с ошибкой.
 */
async function prepareLinks(
  tx: Tx,
  dict: AdminValueDict,
  input: AdminDictInput,
  before: AdminDictValueRecord | undefined,
): Promise<PreparedLinks> {
  if (dict === 'benefits') return prepareBenefit(tx, input, before);
  if (dict === 'types') return prepareType(tx, input, before);
  if (!linkFields(dict).length) return { input, bad: null };
  const catalog = await reportTypeOptions(tx);
  const order = new Map(catalog.map((x, i) => [x.code, i]));
  const types = linkRow(dict, input).types ?? [];
  const was = (before?.data.types as string[] | undefined) ?? [];
  if (badBaseTypes(types, catalog, was).length) {
    return { input, bad: { field: 'types', problem: 'types' } };
  }
  const sorted = [...types].sort((a, b) => order.get(a)! - order.get(b)!);
  return { input: { ...input, data: { ...input.data, types: sorted } }, bad: null };
}

/**
 * Связи и «Меняет сроки» статуса (прототип benefitDlg): виды отчётов — действующие, кроме внутренних
 * (`badBenefitTypes`), и не в двух полях сразу; УГНС — действующие (`badBenefitOffices`); строки
 * сроков — `benefitDueRulesProblem`. Уже выбранное остаётся, даже если его потом отключили. Виды — в
 * порядке каталога, УГНС — в порядке справочника.
 */
async function prepareBenefit(
  tx: Tx,
  input: AdminDictInput,
  before: AdminDictValueRecord | undefined,
): Promise<PreparedLinks> {
  const [catalog, offices] = await Promise.all([
    reportTypeOptions(tx),
    tx
      .select({ code: taxOffices.code, active: taxOffices.active })
      .from(taxOffices)
      .orderBy(asc(taxOffices.sortOrder), asc(taxOffices.code)),
  ]);
  const links = linkRow('benefits', input);
  const was = (f: string) => (before?.data[f] as string[] | undefined) ?? [];
  const fail = (field: string, problem: AdminDictLinkProblem): PreparedLinks => ({
    input,
    bad: { field, problem },
  });
  for (const f of ['removes', 'adds']) {
    if (badBenefitTypes(links[f]!, catalog, was(f)).length) return fail(f, 'benefit_types');
  }
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-9
  if (links.removes!.some((code) => links.adds!.includes(code))) return fail('adds', 'both');
  if (badBenefitOffices(links.offices!, offices, was('offices')).length) {
    return fail('offices', 'offices');
  }
  const rules = dueRulesOf(input);
  const beforeRules = before ? dueRulesOf(recordInput(before)) : [];
  const problem = benefitDueRulesProblem(rules, catalog, beforeRules);
  if (problem) return fail('dueRules', problem === 'no_due' ? 'no_due' : 'due_type');
  const typeOrder = new Map(catalog.map((x, i) => [x.code, i]));
  const officeOrder = new Map(offices.map((x, i) => [x.code, i]));
  const byType = (a: string, b: string) => typeOrder.get(a)! - typeOrder.get(b)!;
  const data = {
    ...input.data,
    removes: [...links.removes!].sort(byType),
    adds: [...links.adds!].sort(byType),
    offices: [...links.offices!].sort((a, b) => officeOrder.get(a)! - officeOrder.get(b)!),
    dueRules: [...rules].sort((a, b) => byType(a.reportType, b.reportType)),
  };
  return { input: { ...input, data }, bad: null };
}

/**
 * Вид отчёта перед записью (прототип typeEditDlg `te-ok`): у вида «Сдача» нет платежей, своего срока
 * оплаты и графика, «Название даты события» — только у разового. Проверки — `reportTypeProblems`;
 * режимы, основания и орган — действующие (уже выбранное остаётся, `inactiveLinks`); получатель
 * платежа — любой орган справочника (прототип: весь список органов); «Не для ставок ЕН» — коды строк
 * «Ставок единого налога». Режимы и основания — в порядке своих справочников.
 */
async function prepareType(
  tx: Tx,
  input: AdminDictInput,
  before: AdminDictValueRecord | undefined,
): Promise<PreparedLinks> {
  const [regimes, bases, organs, enRates] = await Promise.all([
    tx
      .select({ code: taxRegimes.code, active: taxRegimes.active })
      .from(taxRegimes)
      .orderBy(asc(taxRegimes.sortOrder), asc(taxRegimes.code)),
    tx
      .select({ code: reportBases.code, active: reportBases.active })
      .from(reportBases)
      .orderBy(asc(reportBases.sortOrder), asc(reportBases.code)),
    tx.select({ code: authorities.code, active: authorities.active }).from(authorities),
    tx.select({ code: singleTaxRates.code }).from(singleTaxRates),
  ]);
  const sub = input.data.act === 'sub';
  const data: AdminDictData = {
    ...input.data,
    ...(sub
      ? { payments: [], payDay: null, payAfter: null, payMonth: null, paySchedule: null }
      : {}),
    ...(input.data.oneOff === true ? {} : { eventLabel: '' }),
  };
  const links = linkRow('types', { ...input, data });
  const payments = typeValue('payments', data.payments) as ReportPayment[];
  const fail = (field: string, problem: AdminDictLinkProblem): PreparedLinks => ({
    input,
    bad: { field, problem },
  });
  const [problem] = reportTypeProblems({
    kind: data.kind as ReportKind,
    regimes: links.regimes!,
    act: data.act as ReportAct,
    payments,
  });
  if (problem) return fail(problem.field, problem.problem);
  const was = (f: string) => (before?.data[f] as string[] | undefined) ?? [];
  for (const f of ['regimes', 'notForRegimes']) {
    if (inactiveLinks(links[f]!, regimes, was(f)).length) return fail(f, 'regimes');
  }
  // ОТКЛОНЕНИЕ: docs/deviations.md#Д-10
  if (links.regimes!.some((code) => links.notForRegimes!.includes(code))) {
    return fail('notForRegimes', 'regimes_both');
  }
  if (inactiveLinks(links.bases!, bases, was('bases')).length) return fail('bases', 'bases');
  const organ = String(data.authorityCode ?? '');
  const wasOrgan = before ? [String(before.data.authorityCode)] : [];
  if (inactiveLinks([organ], organs, wasOrgan).length) return fail('authorityCode', 'authority');
  const organCodes = new Set(organs.map((x) => x.code));
  if (payments.some((p) => !organCodes.has(p.authority))) {
    return fail('payments', 'payment_authority');
  }
  const rateCodes = new Set(enRates.map((x) => x.code));
  const notForEn = typeValue('notForEnRates', data.notForEnRates) as string[];
  if (notForEn.some((code) => !rateCodes.has(code))) return fail('notForEnRates', 'en_rates');
  const order = (list: readonly { code: string }[]) => {
    const at = new Map(list.map((x, i) => [x.code, i]));
    return (a: string, b: string) => at.get(a)! - at.get(b)!;
  };
  const sorted = {
    ...data,
    regimes: [...links.regimes!].sort(order(regimes)),
    notForRegimes: [...links.notForRegimes!].sort(order(regimes)),
    bases: [...links.bases!].sort(order(bases)),
  };
  return { input: { ...input, data: sorted }, bad: null };
}

/**
 * Пересчёт сроков несданных отчётов вида после правки правила срока (прототип typeEditDlg: `ruleCh` →
 * `dueOf`, кроме отчётов с ручным сроком): отчётов организаций ещё нет — пересчёт подключит задача
 * отчётов (правило стыков, docs/decisions.md п. Д-6).
 */
async function recalcTypeReportDues(_tx: Tx, _code: string): Promise<number> {
  return 0;
}

/** Записать поля-связи значения (`app.admin_dict_set_links`); у справочника без связей — ничего. */
/**
 * Связи значения — сразу после записи самого значения в той же транзакции. Отказ функции здесь не
 * бывает (права и значение те же, что у только что прошедшей записи), но если он случится — исключение
 * откатывает и запись значения: значение без своих связей и без истории не сохраняется.
 */
async function saveLinks(tx: Tx, dict: AdminValueDict, code: string, input: AdminDictInput) {
  if (linkFields(dict).length) {
    const [row] = await tx.execute<{ ok: boolean | null }>(
      sql`select app.admin_dict_set_links(${dict}, ${code}, ${JSON.stringify(linkRow(dict, input))}::jsonb) as ok`,
    );
    if (row?.ok !== true) throw new Error(`Связи значения ${dict}:${code} не сохранены`);
  }
  if (ADMIN_DICT_META[dict].dueRules) {
    const [row] = await tx.execute<{ ok: boolean | null }>(
      sql`select app.admin_benefit_set_due_rules(${code}, ${JSON.stringify(dueRulesOf(input))}::jsonb) as ok`,
    );
    if (row?.ok !== true) throw new Error(`Сроки статуса ${code} не сохранены`);
  }
}

/**
 * Пересчёт сроков несданных отчётов контрагентов со статусом после правки «Меняет сроки» (прототип
 * `cpRedue`): отчётов организаций ещё нет — пересчёт подключит задача отчётов (правило стыков,
 * docs/decisions.md п. Д-5).
 */
async function recalcBenefitReportDues(_tx: Tx, _code: string): Promise<number> {
  return 0;
}

const recordInput = (x: AdminDictValueRecord): AdminDictInput => ({ name: x.name, data: x.data });

export type AdminDictSaveResult =
  | { ok: true; record: AdminDictValueRecord }
  | { ok: false; reason: 'not_found' | 'changed' | 'fixed' }
  | { ok: false; reason: 'bad_link'; field: string; problem: AdminDictLinkProblem }
  | { ok: false; reason: 'taken'; problems: DictValueProblem[] }
  | { ok: false; reason: 'used'; usage: DictUsage };

const entityId = (dict: AdminValueDict, code: string) => `${dict}:${code}`;

/** Повтор названия или кода ГНС среди значений справочника. */
function problemsOf(
  dict: AdminValueDict,
  code: string,
  input: AdminDictInput,
  records: readonly AdminDictValueRecord[],
): DictValueProblem[] {
  const gns = (x: AdminDictInput) =>
    dict === 'ugns' ? ((x.data.gnsCode as string) ?? null) : null;
  return dictValueProblems(
    { code, name: input.name, gnsCode: gns(input) },
    records.map((x) => ({ code: x.code, name: x.name, gnsCode: gns(recordInput(x)) })),
  );
}

/**
 * «+ Добавить» → «Значение» (прототип valueDlg, ugnsDlg): новое значение действующее, в конце
 * порядка, с кодом `nextDictCode`; повтор названия («Такое значение уже есть») или кода ГНС («Такой
 * код уже есть») — `taken`. Создание и поля — в историю. Загрузка из Excel передаёт новый код из
 * файла (`fileCode`, формат проверен `ioCodeValid`).
 */
export async function adminDictCreate(
  tx: Tx,
  dict: AdminValueDict,
  input: AdminDictInput,
  random: () => string,
  fileCode?: string,
): Promise<AdminDictSaveResult> {
  const records = await adminDictRecords(tx, dict);
  const code =
    fileCode ??
    nextDictCode(
      dict,
      records.map((x) => x.code),
      random,
      input.data.kind === 'wallet' ? 'wallet' : 'bank',
    );
  const problems = problemsOf(dict, code, input, records);
  if (problems.length) return { ok: false, reason: 'taken', problems };
  const links = await prepareLinks(tx, dict, input, undefined);
  if (links.bad) return { ok: false, reason: 'bad_link', ...links.bad };
  input = links.input;
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_insert(${dict}, ${code}, ${JSON.stringify(dbRow(dict, input))}::jsonb) as version`,
  );
  // Пусто — в контексте не администратор: права проверил вызывающий (`requirePlatformAdmin`).
  if (row?.version == null) return { ok: false, reason: 'not_found' };
  await saveLinks(tx, dict, code, input);
  const fields = historyFields(dict, input);
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'create',
    changes: Object.entries(fields)
      .filter(([, to]) => to !== '' && to !== null && !(Array.isArray(to) && !to.length))
      .map(([f, to]) => ({ field: f, to })),
  });
  const created = await getAdminDictValue(tx, dict, code);
  return created ? { ok: true, record: created } : { ok: false, reason: 'not_found' };
}

/**
 * «Изменить» / «Переименовать» (прототип valueDlg «Новое название увидят все организации, в том числе
 * в старых записях»): записи ссылаются на код, поэтому новое название сразу видно везде. Без изменений —
 * без новой версии и записи в историю; устаревшая версия — `changed`.
 */
export async function adminDictUpdate(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  input: AdminDictInput,
  version: number,
): Promise<AdminDictSaveResult> {
  const records = await adminDictRecords(tx, dict);
  const before = records.find((x) => x.code === code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const links = await prepareLinks(tx, dict, input, before);
  if (links.bad) return { ok: false, reason: 'bad_link', ...links.bad };
  input = links.input;
  const was = historyFields(dict, recordInput(before));
  const now = historyFields(dict, input);
  const changes: HistoryChange[] = ADMIN_DICT_META[dict].fields
    .filter((f) => !sameHistoryValue(was[f] ?? null, now[f] ?? null))
    .map((f) => ({ field: f, from: was[f] ?? null, to: now[f] ?? null }));
  if (!changes.length) return { ok: true, record: before };
  const problems = problemsOf(dict, code, input, records);
  if (problems.length) return { ok: false, reason: 'taken', problems };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_update(${dict}, ${code}, ${JSON.stringify(dbRow(dict, input))}::jsonb, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await saveLinks(tx, dict, code, input);
  // Новые сроки статуса — у несданных отчётов контрагентов с ним; в историю — у скольких (прототип).
  if (changes.some((c) => isDueRules(dict, c.field))) {
    changes.push({ field: 'recalculated', to: await recalcBenefitReportDues(tx, code) });
  }
  // Новое правило срока вида — у его несданных отчётов (прототип: в историю не пишется).
  if (dict === 'types' && changes.some((c) => REPORT_TYPE_RULE_FIELDS.includes(c.field as never))) {
    await recalcTypeReportDues(tx, code);
  }
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes,
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

/**
 * «Отключить» / «Включить»: отключённое не предлагается в новых записях, в старых остаётся. То же
 * состояние — без новой версии.
 */
export async function adminDictSetActive(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  active: boolean,
  version: number,
): Promise<AdminDictSaveResult> {
  const before = await getAdminDictValue(tx, dict, code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if (before.active === active) return { ok: true, record: before };
  // Кыргызстан — код по умолчанию: отключить нельзя (ТЗ «Коды стран телефонов»).
  if (!active && ADMIN_DICT_META[dict].fixed === code) return { ok: false, reason: 'fixed' };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_set_active(${dict}, ${code}, ${active}, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes: [{ field: 'active', from: before.active, to: active }],
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

/**
 * «Выше» (`step` −1) и «Ниже» (1): место с соседним; в историю — «перемещено с № i на № j». У первого
 * «Выше» и у последнего «Ниже» нет (на экране кнопка недоступна) — `not_found`, как и у справочника
 * без порядка.
 */
export async function adminDictMove(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  step: -1 | 1,
  version: number,
): Promise<AdminDictSaveResult> {
  if (!ADMIN_DICT_META[dict].ordered) return { ok: false, reason: 'not_found' };
  const records = await adminDictRecords(tx, dict);
  const before = records.find((x) => x.code === code);
  if (!before?.n) return { ok: false, reason: 'not_found' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  const to = before.n + step;
  if (to < 1 || to > records.length) return { ok: false, reason: 'not_found' };
  const [row] = await tx.execute<{ version: number | null }>(
    sql`select app.admin_dict_move(${dict}, ${code}, ${step}, ${version}) as version`,
  );
  if (row?.version == null) return { ok: false, reason: 'changed' };
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'update',
    changes: [{ field: 'n', from: before.n, to }],
  });
  const after = await getAdminDictValue(tx, dict, code);
  return after ? { ok: true, record: after } : { ok: false, reason: 'not_found' };
}

export type AdminDictDeleteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'changed' | 'undeletable' }
  | { ok: false; reason: 'used'; usage: DictUsage };

/** Ошибка базы «значение используется» (23503): внешний ключ или отказ `app.admin_dict_delete`. */
function isForeignKeyViolation(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause ?? err;
  return (cause as { code?: string })?.code === '23503';
}

/**
 * «Удалить» — только значение, которое нигде не используется (ТЗ: используемое — только отключить);
 * используется — `used` с числом записей. Ссылку могли сохранить между проверкой и удалением — тогда
 * отказ базы, и тоже `used` с новым числом. В историю — что удалено (название, у УГНС — код и кратко).
 */
export async function adminDictDelete(
  tx: Tx,
  dict: AdminValueDict,
  code: string,
  version: number,
): Promise<AdminDictDeleteResult> {
  const before = await getAdminDictValue(tx, dict, code);
  if (!before) return { ok: false, reason: 'not_found' };
  if (ADMIN_DICT_META[dict].undeletable) return { ok: false, reason: 'undeletable' };
  if (before.version !== version) return { ok: false, reason: 'changed' };
  if (before.usage.total > 0) return { ok: false, reason: 'used', usage: before.usage };
  let deleted: boolean | null | undefined;
  try {
    // Точка сохранения: после отказа базы транзакция остаётся рабочей, чтобы пересчитать «Используется».
    deleted = await tx.transaction(async (sp) => {
      const [row] = await sp.execute<{ deleted: boolean | null }>(
        sql`select app.admin_dict_delete(${dict}, ${code}, ${version}) as deleted`,
      );
      return row?.deleted;
    });
  } catch (err) {
    if (!isForeignKeyViolation(err)) throw err;
    const now = await getAdminDictValue(tx, dict, code);
    return { ok: false, reason: 'used', usage: now?.usage ?? before.usage };
  }
  if (!deleted) return { ok: false, reason: 'changed' };
  const fields = historyFields(dict, recordInput(before));
  const kept = dict === 'ugns' ? ['name', 'shortName', 'gnsCode'] : ['name'];
  await writePlatformHistory(tx, {
    entity: 'platform_dict',
    entityId: entityId(dict, code),
    action: 'delete',
    changes: kept.map((f) => ({ field: f, from: fields[f] ?? null })),
  });
  return { ok: true };
}

/**
 * Значение уже есть (уникальный индекс названия или кода ГНС): другой администратор успел сохранить
 * такое же между проверкой и записью. Поле формы — по имени индекса; иначе null.
 */
export function dictValueTakenField(err: unknown): 'name' | 'gnsCode' | null {
  const cause = (err as { cause?: { code?: string; constraint?: string } })?.cause ?? err;
  const db = cause as { code?: string; constraint?: string };
  if (db?.code !== '23505') return null;
  if (db.constraint === 'tax_offices_gns_code_key') return 'gnsCode';
  return db.constraint?.endsWith('_name_key') ? 'name' : null;
}

/* ───────────── История ───────────── */

/** Запись «Истории изменений» справочника: код и подпись значения, что изменилось. */
export interface AdminDictHistoryItem {
  id: string;
  at: Date;
  actor: string | null;
  action: string;
  code: string;
  /** Как значение называлось: название, у УГНС — «код кратко»; у удалённого — из записи удаления. */
  label: string;
  changes: HistoryChange[];
  /** Правка кода страны: вся строка до и после («Кыргызстан +996 XXX XXX XXX»), как в прототипе. */
  summary?: { from: string; to: string };
}

/**
 * Подпись значения: у УГНС — «002 Ленинский р-н, Бишкек» (прототип pdLog), у вида отчёта в правке —
 * краткое название («Виды отчётов: НДС — …»), у остальных — название.
 */
function labelOf(
  dict: AdminValueDict,
  fields: Record<string, HistoryValue | undefined>,
  action = 'create',
): string {
  const text = (v: HistoryValue | undefined) => (typeof v === 'string' ? v : '');
  if (dict === 'ugns')
    return [text(fields.gnsCode), text(fields.shortName)].filter(Boolean).join(' ');
  if (dict === 'types' && action === 'update') return text(fields.shortName) || text(fields.name);
  return text(fields.name);
}

/**
 * «История изменений · N» под справочником (прототип pdHistHtml): последние `limit` записей, сначала
 * новые, и сколько их всего. Подпись у добавления и удаления — из самой записи, у правки — нынешняя.
 */
export async function adminDictHistory(
  tx: Tx,
  dict: AdminValueDict,
  limit: number,
): Promise<{ total: number; items: AdminDictHistoryItem[] }> {
  const where = and(
    eq(platformAuditLog.entity, 'platform_dict'),
    sql`starts_with(${platformAuditLog.entityId}, ${`${dict}:`})`,
  );
  const [rows, [counted], records] = await Promise.all([
    tx
      .select()
      .from(platformAuditLog)
      .where(where)
      .orderBy(desc(platformAuditLog.at), desc(platformAuditLog.id))
      .limit(limit),
    tx.select({ n: count() }).from(platformAuditLog).where(where),
    adminDictRecords(tx, dict),
  ]);
  // Поля значений после каждой записи: от нынешних назад по записям, сначала новые. По ним — подпись
  // записи, какой она была тогда (прототип пишет строку истории сразу), и код страны строкой.
  const state = new Map(records.map((x) => [x.code, historyFields(dict, recordInput(x))]));
  return {
    total: counted?.n ?? 0,
    items: rows.map((r) => {
      const code = r.entityId.slice(dict.length + 1);
      const changes = (r.changes ?? []) as HistoryChange[];
      const own = Object.fromEntries(changes.map((c) => [c.field, c.from ?? c.to]));
      const after = state.get(code);
      const before = after && {
        ...after,
        ...Object.fromEntries(changes.map((c) => [c.field, c.from ?? null])),
      };
      if (before) state.set(code, before);
      const shown =
        dict === 'types' && r.action === 'update' && after && before
          ? joinPayChanges(changes, before, after)
          : changes;
      const line =
        dict === 'phones' && r.action === 'update' && after && before
          ? { from: phoneLine(before), to: phoneLine(after) }
          : null;
      return {
        id: String(r.id),
        at: r.at,
        actor: auditActorName(r.actorUserId, null),
        action: r.action,
        code,
        // Правка полей вида отчёта подписана кратким названием, включение и отключение — названием.
        label:
          (r.action !== 'update'
            ? labelOf(dict, own)
            : after &&
              labelOf(
                dict,
                after,
                changes.some((c) => c.field === 'active') ? undefined : 'update',
              )) || code,
        changes: shown,
        // Только включение/отключение — строка та же, без «было → стало».
        ...(line && line.from !== line.to ? { summary: line } : {}),
      };
    }),
  };
}

const PAY_FIELDS = ['payDay', 'payAfter', 'payMonth'];

/**
 * Срок оплаты вида отчёта в истории — одним полем `pay`, как у прототипа (`TL.pay`): было и стало —
 * правило целиком (с периодичностью и сроком сдачи), словами его пишет экран (`payRuleText`).
 */
function joinPayChanges(
  changes: HistoryChange[],
  before: Record<string, HistoryValue | undefined>,
  after: Record<string, HistoryValue | undefined>,
): HistoryChange[] {
  const at = changes.findIndex((c) => PAY_FIELDS.includes(c.field));
  if (at < 0) return changes;
  const rule = (f: Record<string, HistoryValue | undefined>): HistoryValue => ({
    period: f.period ?? null,
    dueFrom: f.dueFrom ?? null,
    dueDay: f.dueDay ?? null,
    dueAfter: f.dueAfter ?? null,
    dueMonth: f.dueMonth ?? null,
    oneOff: f.oneOff ?? false,
    act: f.act ?? null,
    payDay: f.payDay ?? null,
    payAfter: f.payAfter ?? null,
    payMonth: f.payMonth ?? null,
  });
  const rest = changes.filter((c) => !PAY_FIELDS.includes(c.field));
  rest.splice(at, 0, { field: 'pay', from: rule(before), to: rule(after) });
  return rest;
}

/**
 * Код страны одной строкой, как пишет историю прототип (phoneCodeDlg): «Кыргызстан +996 XXX XXX XXX».
 */
function phoneLine(fields: Record<string, HistoryValue | undefined>): string {
  const text = (v: HistoryValue | undefined) => (typeof v === 'string' ? v : '');
  return `${text(fields.name)} +${text(fields.dialCode)} ${text(fields.mask)}`;
}
