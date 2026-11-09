import {
  activeIndicators,
  cellState,
  fillMonth,
  formatMomentRu,
  indicatorEarly,
  indicatorNumberText,
  indicatorStart,
  missingMonths,
  monthLabel,
  monthOf,
  monthRange,
  offSince,
  periodRows,
  type IndicatorType,
  type IsoDate,
  type KpiCellState,
  type ListQuery,
  type ListSort,
  type YearMonth,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import {
  kpiContractorOf,
  kpiContractorRecords,
  loadKpiData,
  loadMonths,
  type KpiContractorRecord,
} from './kpi';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';

/*
 * Списки модуля «Показатели контрагентов» — «За период» и «Не заполнено» (прототип modules/kpi.js:
 * kpiPeriod, kpiMissingTab). Строки считают правила домена по данным организации в области сотрудника, а
 * поиск, фильтры, сортировку, группы и выгрузку делает общий механизм списков: строки уходят в запрос одним
 * параметром (`jsonb_to_recordset`), как у «Справочников платформы».
 */

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена или месяц, проверенный схемой. */
const field = (key: string) => sql.raw(`"r"."${key.replace(/[^a-z0-9_-]/gi, '')}"`);

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

function recordset(rows: readonly Record<string, unknown>[], defs: readonly [string, string][]) {
  const columns = [['id', 'text'], ['n', 'integer'], ...defs]
    .map(([k, type]) => `"${k}" ${type}`)
    .join(', ');
  const json = rows.map((r, n) => ({ ...r, n }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(columns)})`;
}

const NATURAL = [field('n')];

/** Значение числом в сотых и текст, как на экране. */
const numberColumn = (key: string, label: string): ListColumn => ({
  type: 'money',
  label,
  value: field(key),
  display: field(`${key}_t`),
});

/** Короткая подпись месяца в заголовке: «авг 26» (прототип `ymS`). */
const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];
export const monthShort = (m: YearMonth) =>
  `${MONTHS_SHORT[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Месяц в ключе столбца «За период»: `m2026-08`. */
export const monthColumnKey = (m: YearMonth) => `m${m}`;

/* ───────────── «За период» ───────────── */

export const KPI_PERIOD_TOTALS = ['sum', 'avg', 'max', 'min'] as const;
export type KpiPeriodTotal = (typeof KPI_PERIOD_TOTALS)[number];

/** Строка «За период»: контрагент × показатель по месяцам периода. */
export interface KpiPeriodListRow {
  id: string;
  contractorId: string;
  contractorName: string;
  indicatorId: string;
  indicatorName: string;
  unit: string;
  type: IndicatorType;
  indicatorArchived: boolean;
  responsibleName: string | null;
  /** Сотые по месяцам периода; null — пусто. */
  values: (number | null)[];
  /** Месяц требовался, прошёл, а значения нет — ячейка «пусто» подсвечена. */
  empty: boolean[];
  /** Месяц требовался — «пусто», иначе «—». */
  needed: boolean[];
  /** Месяц раньше «с <месяц>»: значение можно внести, но оно необязательно. */
  early: boolean[];
  /** Показатель обязательный: пустая прошедшая ячейка подсвечена. */
  required: boolean;
  /** «с <месяц>» показателя у контрагента: подсказка ячейки раньше него. */
  start: YearMonth;
  /** Сотрудник вносит значения контрагента (таблица как в Excel, прототип `kCanEdit`). */
  editable: boolean;
  need: number;
  count: number;
  totals: Record<KpiPeriodTotal, number | null>;
  offSince: YearMonth | null;
  /** «Изменил»: кто и когда последним менял значения за период. */
  lastBy: string | null;
  lastAt: Date | null;
}

/** Вносит ли сотрудник значения контрагента; без проверки — нет (только просмотр). */
type EditableOf = (c: KpiContractorRecord) => boolean;

/**
 * Строки «За период» в области сотрудника (`scope`): архивные контрагенты тоже — их значения видны.
 * `today` — месяц «идёт сейчас» не подсвечивается пустым; `editable` — вносит ли сотрудник значения.
 */
export async function kpiPeriodRows(
  tx: Tx,
  options: {
    scope: SQL | undefined;
    from: YearMonth;
    to: YearMonth;
    today: IsoDate;
    editable?: EditableOf;
  },
): Promise<{ rows: KpiPeriodListRow[]; months: YearMonth[] }> {
  const months = monthRange(options.from, options.to);
  const list = await kpiContractorRecords(tx, { scope: options.scope, archived: true });
  const ids = list.map((c) => c.id);
  const data = await loadKpiData(tx, { contractorIds: ids, from: options.from, to: options.to });
  const byContractor = new Map(list.map((c) => [c.id, c]));
  const indicatorsById = new Map(data.indicators.map((i) => [i.id, i]));
  const bookById = new Map(data.book.indicators.map((i) => [i.id, i]));
  const current = monthOf(options.today);
  const rows = periodRows(data.book, list.map(kpiContractorOf), months, data.valueOf).map((r) => {
    const c = byContractor.get(r.contractorId)!;
    const i = indicatorsById.get(r.indicatorId)!;
    const bi = bookById.get(r.indicatorId)!;
    const kc = kpiContractorOf(c);
    const target = data.book.target(i.id, c.id);
    const last = months
      .map((m) => data.valueRow(c.id, i.id, m))
      .filter((v) => v !== undefined)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    const t = r.totals;
    return {
      id: `${c.id}|${i.id}`,
      contractorId: c.id,
      contractorName: c.name,
      indicatorId: i.id,
      indicatorName: i.name,
      unit: i.unit,
      type: i.type,
      indicatorArchived: i.archived,
      responsibleName: c.responsibleName,
      values: r.values,
      needed: r.applies,
      empty: months.map((m, j) => r.applies[j]! && r.values[j] === null && m < current),
      early: months.map((m) => indicatorEarly(bi, target, kc, m)),
      required: i.required,
      start: indicatorStart(bi, target, kc),
      editable: options.editable?.(c) ?? false,
      need: r.need,
      count: t.count,
      totals:
        'sum' in t
          ? { sum: t.sum, avg: t.avg, max: t.max, min: t.min }
          : { sum: null, avg: null, max: null, min: null },
      offSince: r.offSince,
      lastBy: last?.updatedBy ?? null,
      lastAt: last?.updatedAt ?? null,
    };
  });
  return { rows, months };
}

function periodColumns(months: readonly YearMonth[]): ListColumns {
  const columns: Record<string, ListColumn> = {
    cp: { type: 'text', label: 'kpi.col.contractor', value: field('cp') },
    ind: { type: 'enum', label: 'kpi.col.indicator', value: field('ind') },
  };
  for (const m of months)
    columns[monthColumnKey(m)] = numberColumn(monthColumnKey(m), monthShort(m));
  for (const k of KPI_PERIOD_TOTALS) columns[k] = numberColumn(k, `kpi.total.${k}`);
  columns.resp = { type: 'enum', label: 'kpi.col.responsible', value: field('resp') };
  columns.unit = { type: 'enum', label: 'kpi.col.unit', value: field('unit') };
  columns.nf = {
    type: 'int',
    label: 'kpi.col.filled_months',
    value: field('nf'),
    display: field('nf_t'),
  };
  columns.fs = {
    type: 'enum',
    label: 'kpi.col.fill_state',
    value: field('fs'),
    display: field('fs_t'),
  };
  columns.ub = { type: 'text', label: 'kpi.col.updated_by', value: field('ub') };
  return columns;
}

const textOf = (type: IndicatorType, value: number | null) =>
  value === null ? '' : indicatorNumberText(type, value);

function periodSource(
  rows: readonly KpiPeriodListRow[],
  months: readonly YearMonth[],
  t: ListTexts,
) {
  const defs: [string, string][] = [
    ['cp', 'text'],
    ['ind', 'text'],
    ...months.flatMap((m): [string, string][] => [
      [monthColumnKey(m), 'bigint'],
      [`${monthColumnKey(m)}_t`, 'text'],
    ]),
    ...KPI_PERIOD_TOTALS.flatMap((k): [string, string][] => [
      [k, 'bigint'],
      [`${k}_t`, 'text'],
    ]),
    ['resp', 'text'],
    ['unit', 'text'],
    ['nf', 'integer'],
    ['nf_t', 'text'],
    ['fs', 'text'],
    ['fs_t', 'text'],
    ['ub', 'text'],
  ];
  const json = rows.map((r) => {
    const out: Record<string, unknown> = {
      id: r.id,
      cp: r.contractorName,
      ind: r.indicatorName,
      resp: r.responsibleName,
      unit: r.unit,
      nf: r.count,
      nf_t: t('kpi.filled_of').replace('{n}', String(r.count)).replace('{of}', String(r.need)),
      fs: r.count >= r.need ? 'full' : 'gaps',
      fs_t: t(r.count >= r.need ? 'kpi.fill_state.full' : 'kpi.fill_state.gaps'),
      ub: r.lastBy && r.lastAt ? `${r.lastBy} · ${formatMomentRu(r.lastAt)}` : null,
    };
    months.forEach((m, j) => {
      out[monthColumnKey(m)] = r.values[j];
      out[`${monthColumnKey(m)}_t`] = textOf(r.type, r.values[j] ?? null);
    });
    for (const k of KPI_PERIOD_TOTALS) {
      const v = r.totals[k];
      out[k] = v === null ? null : Math.round(v);
      out[`${k}_t`] = textOf(r.type, v);
    }
    return out;
  });
  return recordset(json, defs);
}

/** По умолчанию — по контрагенту (ТЗ «по умолчанию сортировка по контрагенту»). */
const PERIOD_SORT: ListSort = { key: 'cp', dir: 'asc' };

export async function listKpiPeriodPage(
  tx: Tx,
  query: ListQuery,
  input: { rows: readonly KpiPeriodListRow[]; months: readonly YearMonth[]; t: ListTexts },
) {
  const source = periodSource(input.rows, input.months, input.t);
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: periodColumns(input.months),
    natural: NATURAL,
    defaultSort: PERIOD_SORT,
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
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export function listKpiPeriodValues(
  tx: Tx,
  key: string,
  input: { rows: readonly KpiPeriodListRow[]; months: readonly YearMonth[]; t: ListTexts },
  q?: string,
) {
  return selectListValues({
    columns: periodColumns(input.months),
    key,
    scope: undefined,
    from: fromOf(tx, periodSource(input.rows, input.months, input.t)),
    q,
  });
}

export function exportKpiPeriod(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  input: { rows: readonly KpiPeriodListRow[]; months: readonly YearMonth[]; t: ListTexts },
) {
  return selectListExport({
    query,
    columns: periodColumns(input.months),
    keys,
    natural: NATURAL,
    defaultSort: PERIOD_SORT,
    scope: undefined,
    from: fromOf(tx, periodSource(input.rows, input.months, input.t)),
  });
}

/* ───────────── «Не заполнено» ───────────── */

/** Ячейка показателя за месяц в строке «Не заполнено» (столбцы показателей, ввод как в Excel). */
export interface KpiMissingCell {
  indicatorId: string;
  state: KpiCellState;
  value: number | null;
  start: YearMonth;
  offSince: YearMonth | null;
}

/** Строка «Не заполнено»: контрагент и месяц с невнесёнными обязательными показателями. */
export interface KpiMissingListRow {
  id: string;
  contractorId: string;
  contractorName: string;
  month: YearMonth;
  /** Невнесённые обязательные показатели — по порядку показателей. */
  missing: { id: string; name: string }[];
  responsibleName: string | null;
  due: IsoDate;
  overdueDays: number;
  /** Статус месяца; строки нет — «Не заполнено». */
  status: 'empty' | 'filled' | 'checked';
  statusAt: Date | null;
  /** Значения действующих показателей за месяц — по порядку `indicators` списка. */
  cells: KpiMissingCell[];
  /** Сотрудник вносит значения контрагента (прототип `kCanEdit`). */
  editable: boolean;
}

/** Действующий показатель — столбец значений «Не заполнено» (прототип `vcol`). */
export interface KpiMissingIndicator {
  id: string;
  name: string;
  type: IndicatorType;
  required: boolean;
}

/** Ключ столбца значений показателя «Не заполнено»: `v` и код показателя без дефисов. */
export const missingValueKey = (indicatorId: string) => `v${indicatorId.replace(/-/g, '')}`;

/**
 * Незаполненные месяцы в области сотрудника (прототип `kMissing`) — по правилам домена `missingMonths`:
 * обязательные показатели, которые ведутся, от «с <месяц>» до текущего месяца заполнения, не дальше 35
 * месяцев назад; разовые, архивные и приостановленные не учитываются. Со строками — действующие
 * показатели (столбцы значений) и значения каждого за месяц строки.
 */
export async function kpiMissingList(
  tx: Tx,
  options: { scope: SQL | undefined; today: IsoDate; editable?: EditableOf },
): Promise<{ rows: KpiMissingListRow[]; indicators: KpiMissingIndicator[] }> {
  const list = await kpiContractorRecords(tx, { scope: options.scope });
  const regular = list.filter((c) => c.kind !== 'oneoff' && c.serviceStatus === 'active');
  const last = fillMonth(options.today);
  const data = await loadKpiData(tx, {
    contractorIds: regular.map((c) => c.id),
    to: last,
    filled: true,
  });
  const names = new Map(data.indicators.map((i) => [i.id, i.name]));
  const records = new Map(data.indicators.map((i) => [i.id, i]));
  const active = activeIndicators(data.book);
  const indicators = active.map((i) => {
    const r = records.get(i.id)!;
    return { id: i.id, name: r.name, type: r.type, required: r.required };
  });
  if (regular.length === 0) return { rows: [], indicators };
  const rows = missingMonths(data.book, regular.map(kpiContractorOf), options.today);
  if (rows.length === 0) return { rows: [], indicators };
  const months = await loadMonths(tx, {
    contractorIds: [...new Set(rows.map((r) => r.contractorId))],
    from: rows.reduce((a, r) => (r.month < a ? r.month : a), last),
    to: last,
  });
  const status = new Map(months.map((m) => [`${m.contractorId}|${m.month}`, m]));
  const byContractor = new Map(regular.map((c) => [c.id, c]));
  return {
    indicators,
    rows: rows.map((r) => {
      const c = byContractor.get(r.contractorId)!;
      const kc = kpiContractorOf(c);
      const s = status.get(`${r.contractorId}|${r.month}`);
      return {
        id: `${r.contractorId}|${r.month}`,
        contractorId: r.contractorId,
        contractorName: c.name,
        month: r.month,
        missing: r.missing.map((id) => ({ id, name: names.get(id) ?? '' })),
        responsibleName: c.responsibleName,
        due: r.due,
        overdueDays: r.overdueDays,
        status: s?.status ?? 'empty',
        statusAt: s?.statusAt ?? null,
        cells: active.map((i) => {
          const target = data.book.target(i.id, c.id);
          return {
            indicatorId: i.id,
            state: cellState(data.book, i, kc, r.month),
            value: data.valueOf(c.id, i.id, r.month),
            start: indicatorStart(i, target, kc),
            offSince: offSince(i, data.book, c.id),
          };
        }),
        editable: options.editable?.(c) ?? false,
      };
    }),
  };
}

/** Строки «Не заполнено» без столбцов значений: индикатор незаполненных и счётчики. */
export async function kpiMissingRows(
  tx: Tx,
  options: { scope: SQL | undefined; today: IsoDate },
): Promise<KpiMissingListRow[]> {
  return (await kpiMissingList(tx, options)).rows;
}

/** Столбцы «Не заполнено»: значения действующих показателей — после месяца (прототип `vcol`). */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-60 — столбцы значений сортируются и фильтруются на сервере.
function missingColumns(indicators: readonly KpiMissingIndicator[]): ListColumns {
  const columns: Record<string, ListColumn> = {
    cp: { type: 'text', label: 'kpi.col.contractor', value: field('cp') },
    m: { type: 'enum', label: 'kpi.col.month', value: field('m'), display: field('m_t') },
  };
  for (const i of indicators) {
    columns[missingValueKey(i.id)] = numberColumn(missingValueKey(i.id), i.name);
  }
  Object.assign(columns, {
    miss: { type: 'text', label: 'kpi.col.missing', value: field('miss') },
    resp: { type: 'enum', label: 'kpi.col.responsible', value: field('resp') },
    due: { type: 'date', label: 'kpi.col.due', value: field('due') },
    over: { type: 'int', label: 'kpi.col.overdue_days', value: field('over') },
    st: { type: 'enum', label: 'kpi.col.month_status', value: field('st'), display: field('st_t') },
  } satisfies ListColumns);
  return columns;
}

/** Строки и столбцы значений «Не заполнено» (`kpiMissingList`) с текстами для списка. */
export interface KpiMissingInput {
  rows: readonly KpiMissingListRow[];
  indicators: readonly KpiMissingIndicator[];
  t: ListTexts;
}

function missingSource({ rows, indicators, t }: KpiMissingInput) {
  const types = new Map(indicators.map((i) => [i.id, i.type]));
  return recordset(
    rows.map((r) => {
      const out: Record<string, unknown> = {
        id: r.id,
        cp: r.contractorName,
        m: r.month,
        m_t: monthLabel(r.month),
        miss: r.missing.map((x) => x.name).join(', '),
        resp: r.responsibleName,
        due: r.due,
        over: r.overdueDays || null,
        st: r.status,
        st_t: t(`status.indicator.${r.status}`),
      };
      for (const c of r.cells) {
        const type = types.get(c.indicatorId);
        if (!type) continue;
        out[missingValueKey(c.indicatorId)] = c.value;
        out[`${missingValueKey(c.indicatorId)}_t`] = textOf(type, c.value);
      }
      return out;
    }),
    [
      ['cp', 'text'],
      ['m', 'text'],
      ['m_t', 'text'],
      ...indicators.flatMap((i): [string, string][] => [
        [missingValueKey(i.id), 'bigint'],
        [`${missingValueKey(i.id)}_t`, 'text'],
      ]),
      ['miss', 'text'],
      ['resp', 'text'],
      ['due', 'date'],
      ['over', 'integer'],
      ['st', 'text'],
      ['st_t', 'text'],
    ],
  );
}

/** По умолчанию — по сроку заполнения, старые сверху (ТЗ). */
const MISSING_SORT: ListSort = { key: 'due', dir: 'asc' };

export async function listKpiMissingPage(tx: Tx, query: ListQuery, input: KpiMissingInput) {
  const source = missingSource(input);
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const page = await selectListPage({
    query,
    columns: missingColumns(input.indicators),
    natural: NATURAL,
    defaultSort: MISSING_SORT,
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
  return { ...page, rows: page.rows.map((r) => byId.get(r.id)!) };
}

export function listKpiMissingValues(tx: Tx, key: string, input: KpiMissingInput, q?: string) {
  return selectListValues({
    columns: missingColumns(input.indicators),
    key,
    scope: undefined,
    from: fromOf(tx, missingSource(input)),
    q,
  });
}

export function exportKpiMissing(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  input: KpiMissingInput,
) {
  return selectListExport({
    query,
    columns: missingColumns(input.indicators),
    keys,
    natural: NATURAL,
    defaultSort: MISSING_SORT,
    scope: undefined,
    from: fromOf(tx, missingSource(input)),
  });
}
