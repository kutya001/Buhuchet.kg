import {
  auditActorName,
  dueRuleText,
  RecordChangedError,
  formatText,
  payRuleText,
  paysText,
  type ListQuery,
  type ReportAct,
  type ReportKind,
  type ReportPeriod,
  type Translate,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory, updateWithHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import {
  authorities,
  employees,
  orgReportTypes,
  reportTypeRegimes,
  reportTypes,
  taxRegimes,
} from './schema';
import type { AuditRecord } from './staff';

/*
 * Модуль «Справочники» → «Виды отчётов» (задача 2.02): каталог видов отчётов платформы глазами
 * организации — какие виды подключены и с какими настройками. Всё — в `withOrgContext`: RLS отдаёт
 * только строки `org_report_types` своей организации, каталог общий.
 */

/** Настройки организации по виду отчёта (строка `org_report_types`). */
export interface OrgReportTypeSetting {
  code: string;
  enabled: boolean;
  remindDays: number[];
  needFile: boolean;
  needReceipt: boolean;
  version: number;
}

/**
 * Строка своей организации. RLS и так отдаёт только её; условие в запросе — страховка на случай запроса
 * вне `withOrgContext` и путь к первичному ключу (организация, код вида).
 */
const OWN = eq(orgReportTypes.orgId, sql`app.current_org_id()`);

const settingFields = {
  code: orgReportTypes.reportTypeCode,
  enabled: orgReportTypes.enabled,
  remindDays: orgReportTypes.remindDays,
  needFile: orgReportTypes.needFile,
  needReceipt: orgReportTypes.needReceipt,
  version: orgReportTypes.version,
};

/** Все строки организации — подключённые и отключённые — в порядке каталога. */
export function listOrgReportTypeSettings(tx: Tx): Promise<OrgReportTypeSetting[]> {
  return tx
    .select(settingFields)
    .from(orgReportTypes)
    .innerJoin(reportTypes, eq(reportTypes.code, orgReportTypes.reportTypeCode))
    .where(OWN)
    .orderBy(asc(reportTypes.sortOrder), asc(reportTypes.code));
}

/** Строка организации по виду; null — вид ещё ни разу не подключали. */
export async function getOrgReportTypeSetting(
  tx: Tx,
  code: string,
): Promise<OrgReportTypeSetting | null> {
  const [row] = await tx
    .select(settingFields)
    .from(orgReportTypes)
    .where(and(OWN, eq(orgReportTypes.reportTypeCode, code)));
  return row ?? null;
}

/** Вид отчёта каталога: что нужно для правил подключения и настроек. */
export interface CatalogTypeInfo {
  code: string;
  shortName: string;
  name: string;
  act: ReportAct;
  active: boolean;
}

/** Виды каталога по кодам (неизвестные коды не возвращаются). */
export function catalogTypes(tx: Tx, codes: readonly string[]): Promise<CatalogTypeInfo[]> {
  if (!codes.length) return Promise.resolve([]);
  return tx
    .select({
      code: reportTypes.code,
      shortName: reportTypes.shortName,
      name: reportTypes.name,
      act: reportTypes.act,
      active: reportTypes.active,
    })
    .from(reportTypes)
    .where(inArray(reportTypes.code, [...codes]));
}

export interface OrgReportTypePatch {
  enabled?: boolean;
  remindDays?: number[];
  needFile?: boolean;
  needReceipt?: boolean;
}

/**
 * Подключить вид впервые: строка с настройками по умолчанию (дни — из учётной политики или заданные) и
 * запись «Подключён» в истории. Если строку только что создал другой пользователь (оба подключали вид
 * впервые одновременно) — `RecordChangedError`, как у устаревшей версии.
 */
export async function createOrgReportType(
  tx: Tx,
  code: string,
  values: Required<OrgReportTypePatch>,
): Promise<OrgReportTypeSetting> {
  const [row] = await tx
    .insert(orgReportTypes)
    .values({
      orgId: sql`app.current_org_id()`,
      reportTypeCode: code,
      ...values,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .onConflictDoNothing()
    .returning(settingFields);
  if (!row) throw new RecordChangedError('org_report_type', code, 1);
  await writeHistory(tx, {
    entity: 'org_report_type',
    entityId: code,
    action: 'create',
    changes: Object.entries(values).map(([field, to]) => ({ field, to })),
  });
  return row;
}

/**
 * Изменить строку организации: подключить, отключить, дни напоминаний, файл, квитанция. Устаревшая
 * версия — `RecordChangedError`, изменения — в историю «было → стало».
 */
export async function updateOrgReportType(
  tx: Tx,
  code: string,
  version: number,
  patch: OrgReportTypePatch,
): Promise<OrgReportTypeSetting> {
  const row = await updateWithHistory(tx, {
    table: orgReportTypes,
    entity: 'org_report_type',
    // В транзакции видна только своя организация (RLS), поэтому код вида — ключ строки.
    key: orgReportTypes.reportTypeCode,
    id: code,
    version,
    patch,
  });
  return {
    code: row.reportTypeCode,
    enabled: row.enabled,
    remindDays: row.remindDays,
    needFile: row.needFile,
    needReceipt: row.needReceipt,
    version: row.version,
  };
}

/** Строки организации по кодам, заблокированные до конца транзакции (окно «Выбор налогов»). */
export function lockOrgReportTypes(
  tx: Tx,
  codes: readonly string[],
): Promise<OrgReportTypeSetting[]> {
  if (!codes.length) return Promise.resolve([]);
  return tx
    .select(settingFields)
    .from(orgReportTypes)
    .where(and(OWN, inArray(orgReportTypes.reportTypeCode, [...codes])))
    .for('update');
}

/* ───────────── Список «Виды отчётов» ───────────── */

/** Строка списка «Виды отчётов»: вид каталога и настройки организации (у неподключённого — пусто). */
export interface OrgReportTypeRow {
  code: string;
  name: string;
  shortName: string;
  formCode: string;
  statIndex: string;
  authority: string;
  period: ReportPeriod;
  oneOff: boolean;
  act: ReportAct;
  kind: ReportKind;
  rates: string[];
  regimes: string[];
  due: string;
  pay: string;
  pays: string;
  enabled: boolean;
  remindDays: number[] | null;
  needFile: boolean;
  needReceipt: boolean;
  /** Версия строки организации; null — вид ещё ни разу не подключали. */
  version: number | null;
  /** «Назначено контрагентам»: действующих контрагентов с этим видом (назначения — задача 2.06). */
  assigned: number;
  /** «Создано» — когда организация подключила вид впервые; у неподключавшегося вида — null. */
  audit: AuditRecord | null;
}

const translate =
  (t: ListTexts): Translate =>
  (key, params) =>
    formatText(t(key), params);

/**
 * Сроки словами всех видов каталога (`dueRuleText`, `payRuleText`, `paysText` из @buhuchet/domain —
 * эталон прототипа) — одной таблицей `r(code, due, pay, pays)` для запроса списка: так по ним работают
 * фильтр, сортировка и поиск. Таблица приходит одним параметром JSON.
 */
async function ruleTable(tx: Tx, t: ListTexts): Promise<SQL> {
  const tr = translate(t);
  const names = new Map(
    (await tx.select({ code: authorities.code, name: authorities.name }).from(authorities)).map(
      (a) => [a.code, a.name],
    ),
  );
  const types = await tx
    .select({
      code: reportTypes.code,
      period: reportTypes.period,
      dueDay: reportTypes.dueDay,
      dueAfter: reportTypes.dueAfter,
      dueMonth: reportTypes.dueMonth,
      dueFrom: reportTypes.dueFrom,
      oneOff: reportTypes.oneOff,
      act: reportTypes.act,
      payDay: reportTypes.payDay,
      payAfter: reportTypes.payAfter,
      payMonth: reportTypes.payMonth,
      paySchedule: reportTypes.paySchedule,
      authorityCode: reportTypes.authorityCode,
      payments: reportTypes.payments,
    })
    .from(reportTypes)
    .where(eq(reportTypes.active, true));
  const rows = types.map((x) => ({
    code: x.code,
    due: dueRuleText(x, tr),
    // У вида «Сдача» срока оплаты нет (прототип: `t.sum ? payRuleText(t) : ''`).
    pay: x.act === 'sub' ? '' : payRuleText(x, tr),
    pays: paysText(
      x.payments.map((p) => ({ name: p.name, authority: names.get(p.authority) ?? p.authority })),
      names.get(x.authorityCode) ?? x.authorityCode,
    ),
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(code text, due text, pay text, pays text)`;
}

const RULES = {
  code: sql.raw('"r"."code"'),
  due: sql.raw('"r"."due"'),
  pay: sql.raw('"r"."pay"'),
  pays: sql.raw('"r"."pays"'),
};

const enabled = sql`coalesce(${orgReportTypes.enabled}, false)`;
const yesNo = (flag: SQL) => sql`case when ${flag} then 'yes' else 'no' end`;
const yesNoText = (flag: SQL, t: ListTexts) =>
  sql`case when ${flag} then ${t('dicts.yes')} else ${t('dicts.no')} end`;
const yesFirst = (flag: SQL) => ({ value: sql`case when ${flag} then 0 else 1 end`, text: false });

/** Режимы вида краткими названиями через запятую, в порядке справочника. */
const regimeNames = sql<string>`coalesce((select string_agg(g.name, ', ' order by g.sort_order, g.code)
  from ${reportTypeRegimes} l join ${taxRegimes} g on g.code = l.regime_code
  where l.report_type_code = "report_types"."code" and l.relation = 'applies'), '')`;
const remindText = sql<string>`case when ${enabled} then array_to_string(${orgReportTypes.remindDays}, ', ') else '' end`;
const periodValue = sql<string>`case when ${reportTypes.oneOff} then 'oneoff' else ${reportTypes.period} end`;

/**
 * Столбцы списка «Виды отчётов» — как в прототипе (modules/dicts.js, grid `dict-types`). Подписи кодов
 * («Да», «Сдача + уплата», «Квартал») — тексты словаря в `display`.
 */
export function orgReportTypeColumns(t: ListTexts): ListColumns {
  return {
    on: {
      type: 'enum',
      label: 'dicts.col.on',
      value: yesNo(enabled),
      display: yesNoText(enabled, t),
      sort: yesFirst(enabled),
    },
    name: { type: 'text', label: 'dicts.col.name', value: reportTypes.name },
    act: {
      type: 'enum',
      label: 'dicts.col.act',
      value: reportTypes.act,
      display: sql`case ${reportTypes.act} when 'sub' then ${t('report.act.sub')} when 'pay' then ${t('report.act.pay')} else ${t('report.act.both')} end`,
      // По подписи: «Сдача», «Сдача + уплата», «Уплата».
      sort: {
        value: sql`case ${reportTypes.act} when 'sub' then 1 when 'both' then 2 else 3 end`,
        text: false,
      },
    },
    pays: { type: 'text', label: 'dicts.col.pays', value: RULES.pays },
    file: {
      type: 'enum',
      label: 'dicts.col.file',
      value: yesNo(sql`coalesce(${orgReportTypes.needFile}, false)`),
      display: yesNoText(sql`coalesce(${orgReportTypes.needFile}, false)`, t),
      sort: yesFirst(sql`coalesce(${orgReportTypes.needFile}, false)`),
    },
    receipt: {
      type: 'enum',
      label: 'dicts.col.receipt',
      value: yesNo(sql`coalesce(${orgReportTypes.needReceipt}, false)`),
      display: yesNoText(sql`coalesce(${orgReportTypes.needReceipt}, false)`, t),
      sort: yesFirst(sql`coalesce(${orgReportTypes.needReceipt}, false)`),
    },
    short: { type: 'text', label: 'dicts.col.short', value: reportTypes.shortName },
    code: { type: 'text', label: 'dicts.col.code', value: reportTypes.formCode },
    organ: {
      type: 'enum',
      label: 'dicts.col.organ',
      value: reportTypes.authorityCode,
      display: authorities.name,
      sort: { value: authorities.name, text: true },
    },
    index: { type: 'text', label: 'dicts.col.index', value: reportTypes.statIndex },
    per: {
      type: 'enum',
      label: 'dicts.col.per',
      value: periodValue,
      display: sql`case ${periodValue} when 'oneoff' then ${t('report.period.oneoff')} when 'M' then ${t('report.period.m')} when 'Q' then ${t('report.period.q')} when 'H' then ${t('report.period.h')} else ${t('report.period.y')} end`,
      sort: {
        value: sql`case ${periodValue} when 'M' then 1 when 'Q' then 2 when 'H' then 3 when 'Y' then 4 else 5 end`,
        text: false,
      },
    },
    rule: { type: 'text', label: 'dicts.col.rule', value: RULES.due },
    payrule: { type: 'text', label: 'dicts.col.payrule', value: RULES.pay },
    kind: {
      type: 'enum',
      label: 'dicts.col.kind',
      value: reportTypes.kind,
      display: sql`case ${reportTypes.kind} when 'regime' then ${t('report.kind.regime')} when 'cross' then ${t('report.kind.cross')} else ${t('report.kind.internal')} end`,
      sort: {
        value: sql`case ${reportTypes.kind} when 'regime' then 1 when 'cross' then 2 else 3 end`,
        text: false,
      },
    },
    rates: {
      type: 'text',
      label: 'dicts.col.rates',
      value: sql`array_to_string(${reportTypes.rates}, '; ')`,
    },
    // Назначений пока нет — они появятся с задачей 2.06 («Отчёты: назначения…»).
    used: { type: 'int', label: 'dicts.col.used', value: sql`0` },
    regimes: { type: 'text', label: 'dicts.col.regimes', value: regimeNames },
    days: {
      type: 'text',
      label: 'dicts.col.days',
      value: remindText,
      display: sql`case when ${enabled} then replace(${t('dicts.types.days_text')}, '{days}', ${remindText}) else '' end`,
    },
    // «Создано» и «Изменено» — строки организации: когда вид подключили и кто менял его настройки.
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: orgReportTypes.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: orgReportTypes.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(orgReportTypes.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
}

const NATURAL = [reportTypes.sortOrder, reportTypes.code];

const creator = alias(employees, 'creator');
const updater = alias(employees, 'updater');
const CREATED_BY = auditActorValue(orgReportTypes.createdBy, creator.shortName);

/**
 * Таблицы списка: каталог, орган, строка организации (RLS — только своя), авторы строки и сроки
 * словами. `fields` — любые поля: страница, группы, значения фильтра и выгрузка.
 */
function listFrom(tx: Tx, rules: SQL) {
  return (fields: Record<string, SQL>) =>
    tx
      .select(fields)
      .from(reportTypes)
      .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
      .leftJoin(orgReportTypes, and(OWN, eq(orgReportTypes.reportTypeCode, reportTypes.code)))
      .leftJoin(creator, eq(creator.userId, orgReportTypes.createdBy))
      .leftJoin(updater, eq(updater.userId, orgReportTypes.updatedBy))
      .leftJoin(rules, sql`${RULES.code} = ${reportTypes.code}`)
      .$dynamic();
}

/** Только действующие виды каталога: отключённый платформой вид не подключают (прототип `RT.filter(t => t.active)`). */
const ACTIVE = eq(reportTypes.active, true);

function rowFields(window: ListWindowFields) {
  return {
    code: reportTypes.code,
    name: reportTypes.name,
    shortName: reportTypes.shortName,
    formCode: reportTypes.formCode,
    statIndex: reportTypes.statIndex,
    authority: authorities.name,
    period: reportTypes.period,
    oneOff: reportTypes.oneOff,
    act: reportTypes.act,
    kind: reportTypes.kind,
    rates: reportTypes.rates,
    regimes: sql<string>`${regimeNames}`,
    due: sql<string>`coalesce(${RULES.due}, '')`,
    pay: sql<string>`coalesce(${RULES.pay}, '')`,
    pays: sql<string>`coalesce(${RULES.pays}, '')`,
    enabled: sql<boolean>`${enabled}`,
    remindDays: orgReportTypes.remindDays,
    needFile: sql<boolean>`coalesce(${orgReportTypes.needFile}, false)`,
    needReceipt: sql<boolean>`coalesce(${orgReportTypes.needReceipt}, false)`,
    version: orgReportTypes.version,
    createdAt: orgReportTypes.createdAt,
    createdBy: orgReportTypes.createdBy,
    createdByName: creator.shortName,
    updatedAt: orgReportTypes.updatedAt,
    updatedBy: orgReportTypes.updatedBy,
    updatedByName: updater.shortName,
    ...window,
  };
}

/**
 * Страница списка «Виды отчётов»: весь действующий каталог; по умолчанию, как во всех списках, — от
 * новых к старым по «Создано» (подключённые — сверху, недавно подключённые — первыми), дальше —
 * порядок каталога.
 */
export async function listOrgReportTypesPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
): Promise<ListPageResult<OrgReportTypeRow>> {
  const rules = await ruleTable(tx, t);
  const page = await selectListPage({
    query,
    columns: orgReportTypeColumns(t),
    natural: NATURAL,
    scope: ACTIVE,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select(rowFields(window))
        .from(reportTypes)
        .innerJoin(authorities, eq(authorities.code, reportTypes.authorityCode))
        .leftJoin(orgReportTypes, and(OWN, eq(orgReportTypes.reportTypeCode, reportTypes.code)))
        .leftJoin(creator, eq(creator.userId, orgReportTypes.createdBy))
        .leftJoin(updater, eq(updater.userId, orgReportTypes.updatedBy))
        .leftJoin(rules, sql`${RULES.code} = ${reportTypes.code}`)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: listFrom(tx, rules),
  });
  return {
    ...page,
    rows: page.rows.map(
      ({ createdAt, createdBy, createdByName, updatedAt, updatedBy, updatedByName, ...r }) => ({
        ...r,
        regimes: r.regimes ? r.regimes.split(', ') : [],
        assigned: 0,
        audit:
          createdAt && updatedAt
            ? {
                createdAt,
                createdBy: auditActorName(createdBy, createdByName),
                updatedAt,
                updatedBy: auditActorName(updatedBy, updatedByName),
              }
            : null,
      }),
    ),
  };
}

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export async function listOrgReportTypeValues(tx: Tx, key: string, t: ListTexts, q?: string) {
  return selectListValues({
    columns: orgReportTypeColumns(t),
    key,
    scope: ACTIVE,
    from: listFrom(tx, await ruleTable(tx, t)),
    q,
  });
}

/** Виды отчётов для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export async function exportOrgReportTypes(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
) {
  return selectListExport({
    query,
    columns: orgReportTypeColumns(t),
    keys,
    natural: NATURAL,
    scope: ACTIVE,
    from: listFrom(tx, await ruleTable(tx, t)),
  });
}

/** Подключённых видов у организации — для пустого состояния «Подключите виды отчётов». */
export async function enabledReportTypeCount(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orgReportTypes)
    .innerJoin(reportTypes, eq(reportTypes.code, orgReportTypes.reportTypeCode))
    .where(and(eq(orgReportTypes.enabled, true), ACTIVE));
  return row?.n ?? 0;
}
