import {
  ALL_VALUES_DICTS,
  auditActorName,
  calendarYear,
  formatDateRu,
  ORG_DICT_COLUMNS,
  ORG_DICT_NATURAL_ORDER,
  ORG_DICT_WINDOW_IDS,
  orgDictGroups,
  orgDictIdOfKey,
  regimeAccountantNote,
  scaleStatuses,
  type AllValuesDict,
  type DictGroupDef,
  type ListQuery,
  type ListSort,
  type OrgDictGroup,
  type OrgDictId,
  type OrgDictWindowId,
} from '@buhuchet/domain';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Db, Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumn,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';
import {
  listAuthorities,
  listBanks,
  listDueChangeReasons,
  listOwnershipForms,
  listReportBases,
  listSingleTaxRates,
  listTaxBenefits,
  listTaxOffices,
  listTaxRegimes,
  productionCalendarEntries,
} from './platform-dicts';
import {
  authorities,
  banks,
  dueChangeReasons,
  gkedItems,
  ownershipForms,
  platformReference,
  productionCalendar,
  reportBases,
  reportTypes,
  taxBenefits,
  taxOffices,
  taxRegimes,
} from './schema';
import { phoneCodeList } from './staff';
import { listTaxes } from './taxes';

/*
 * «Справочники» → «Справочники платформы» глазами организации (задача 2.03; ТЗ «Справочники платформы —
 * только просмотр»; прототип modules/dicts.js и dict-guide.js `orgDictDefs`): плитки по группам, окно
 * справочника со списком значений и «Поиск по всем значениям». Справочники общие, организация их только
 * читает. Строки собираются из своих таблиц и разделов `platform_reference` и уходят в запрос списка
 * одним параметром (`jsonb_to_recordset`): поиск, фильтры, сортировка и выгрузка — общим механизмом
 * списков (`selectListPage`).
 */

/** Строка окна справочника: `id` — значение (код), остальное — тексты столбцов. */
type Row = Record<string, string>;

const text = z.string().catch('');
const Item = z.object({ name: text, code: text, active: z.boolean().catch(true) });
const Items = z.object({ items: z.array(z.unknown()).catch([]) });

async function referencePayload(db: Db | Tx, key: string): Promise<unknown> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, key));
  return row?.payload ?? null;
}

/** Действующие значения справочника раздела `dictionaries` (категории задач). */
async function referenceItems(db: Db | Tx, dict: 'cats') {
  const payload = await referencePayload(db, 'dictionaries');
  const section = (payload as Record<string, unknown> | null)?.[dict];
  return Items.parse(section ?? {}).items.flatMap((x) => {
    const item = Item.safeParse(x);
    return item.success && item.data.active && item.data.name ? [item.data] : [];
  });
}

/** Объект «ключ → текст» из `platform_reference` (statusNotes, templateNotes, messageTemplates). */
async function referenceTexts(db: Db | Tx, key: string): Promise<[string, string][]> {
  const payload = await referencePayload(db, key);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.entries(payload).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : []));
}

const Groups = z.array(
  z.object({
    group: z.string(),
    tabs: z.array(z.object({ tab: z.string(), key: text, about: text, usedIn: text })).catch([]),
  }),
);

/** Группы справочников платформы (раздел `dictGroups`); раздел, который не разобрать, — пусто. */
export async function platformDictGroupDefs(db: Db | Tx): Promise<DictGroupDef[]> {
  const parsed = Groups.safeParse(await referencePayload(db, 'dictGroups'));
  return parsed.success ? parsed.data : [];
}

/**
 * Порядок шаблонов сообщений, как в справочнике (refDB `templateNotes`): набор шаблонов задаёт система,
 * а jsonb порядок ключей не хранит. Новый шаблон без места здесь — в конце.
 */
const TEMPLATE_ORDER = [
  'waTax',
  'waFee',
  'tgBefore',
  'tgToday',
  'tgOver',
  'tgPay',
  'tgWeek',
  'tgCode',
  'tgTask',
  'tgConfWait',
  'tgFix',
  'waPage',
];

/** Год календаря — текущий по Бишкеку (прототип `holidayRows(+TODAY.slice(0, 4))`). */
const yearOf = (today: string) => Number(today.slice(0, 4));

/** Дни календаря года: у рабочей субботы без названия — «Рабочая суббота» (прототип holidayRows). */
async function calendarRows(db: Db | Tx, t: ListTexts, today: string) {
  return calendarYear(await productionCalendarEntries(db), yearOf(today)).map((d) => ({
    id: `${d.date}|${d.kind}`,
    d: d.date,
    name: d.name || t('dicts.platform.calendar.workday'),
    kind: d.kind,
    kind_text: t(`dicts.platform.calendar.${d.kind}`),
  }));
}

/** Строки окна справочника — столбцы как в прототипе (`orgDictDefs`), только действующие значения. */
const WINDOW_ROWS: Record<
  OrgDictWindowId,
  (db: Db | Tx, t: ListTexts, today: string) => Promise<Row[]>
> = {
  taxes: async (db) =>
    (await listTaxes(db)).map((x) => ({
      id: x.code,
      code: x.code,
      name: x.name,
      verify: x.verify ? '1' : '',
      about: x.guide.about,
      period: x.period,
    })),
  en_rates: async (db) =>
    (await listSingleTaxRates(db)).map((x) => ({
      id: x.code,
      code: x.code,
      rate: x.rate,
      activity: x.activity,
      explain: x.explanation,
    })),
  bases: async (db) =>
    (await listReportBases(db)).map((x) => ({ id: x.code, name: x.name, desc: x.description })),
  regimes: async (db) =>
    (await listTaxRegimes(db)).map((x) => ({
      id: x.code,
      name: x.name,
      full: x.fullName,
      acc: regimeAccountantNote(x.accountantNote),
    })),
  benefits: async (db) =>
    (await listTaxBenefits(db)).map((x) => ({ id: x.code, name: x.name, gives: x.gives })),
  gked: async (db) =>
    (
      await db
        .select({ code: gkedItems.code, name: gkedItems.name })
        .from(gkedItems)
        .where(and(eq(gkedItems.level, 'subclass'), eq(gkedItems.active, true)))
        .orderBy(asc(gkedItems.sortOrder), asc(gkedItems.code))
    ).map((x) => ({ id: x.code, code: x.code, name: x.name })),
  forms: async (db, t) =>
    (await listOwnershipForms(db)).map((x) => ({
      id: x.code,
      name: x.name,
      full: x.fullName,
      end: x.declarationFor,
      end_text: t(`dicts.platform.end.${x.declarationFor}`),
      note: x.note,
    })),
  phones: async (db) =>
    (await phoneCodeList(db))
      .filter((x) => x.active)
      .map((x) => ({
        id: x.cc,
        name: `${x.flag} ${x.name}`.trim(),
        code: `+${x.code}`,
        mask: x.mask,
      })),
  organs: async (db) =>
    (await listAuthorities(db)).map((x) => ({
      id: x.code,
      name: x.name,
      note: x.description,
      contacts: x.contacts.map((c) => `${c.label}: ${c.value}`).join('; '),
    })),
  ugns: async (db) =>
    (await listTaxOffices(db)).map((x) => ({
      id: x.code,
      code: x.gnsCode || '—',
      name: x.name,
      city: x.region,
    })),
  banks: async (db) =>
    (await listBanks(db)).map((x) => ({ id: x.code, name: x.name, code: x.code })),
  calendar: calendarRows,
  // Пояснения статусов отчёта — по названию статуса; порядок — шкала сдачи (в jsonb порядок ключей
  // раздела не хранится).
  statuses: async (db, t) => {
    const notes = new Map(await referenceTexts(db, 'statusNotes'));
    return scaleStatuses('report').map((code) => {
      const name = t(`status.report.${code}`);
      return { id: code, name, note: notes.get(name) ?? '' };
    });
  },
  cats: async (db, t) => [
    ...(await referenceItems(db, 'cats')).map((x) => ({
      id: `cat|${x.code || x.name}`,
      kind: 'cat',
      kind_text: t('dicts.platform.cats.cat'),
      code: x.code,
      name: x.name,
    })),
    ...(await listDueChangeReasons(db)).map((x) => ({
      id: `reason|${x.code}`,
      kind: 'reason',
      kind_text: t('dicts.platform.cats.reason'),
      code: x.code,
      name: x.name,
    })),
  ],
  templates: async (db) => {
    const texts = new Map(await referenceTexts(db, 'messageTemplates'));
    const order = (key: string) => {
      const i = TEMPLATE_ORDER.indexOf(key);
      return i < 0 ? TEMPLATE_ORDER.length : i;
    };
    return (await referenceTexts(db, 'templateNotes'))
      .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
      .map(([key, note]) => ({ id: key, name: note, text: texts.get(key) ?? '' }));
  },
};

/** Столбцы-справочники с кодом значения: на экране и в поиске — текст `<ключ>_text`. */
const CODED: Partial<Record<OrgDictWindowId, readonly string[]>> = {
  forms: ['end'],
  calendar: ['kind'],
  cats: ['kind'],
};

/** Поля строки сверх столбцов: пометка «сверить» у налога. */
const EXTRA: Partial<Record<OrgDictWindowId, readonly string[]>> = { taxes: ['verify'] };

/** Столбец строки из `jsonb_to_recordset`: ключи — постоянные имена столбцов, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

function windowColumns(id: OrgDictWindowId): ListColumns {
  const coded = new Set(CODED[id] ?? []);
  return Object.fromEntries(
    ORG_DICT_COLUMNS[id].map((c): [string, ListColumn] => [
      c.key,
      {
        type: c.type,
        label: `dicts.platform.col.${id}.${c.key}`,
        value: field(c.key),
        ...(coded.has(c.key)
          ? { display: field(`${c.key}_text`), sort: { value: field(`${c.key}_text`), text: true } }
          : {}),
      },
    ]),
  );
}

/** Строки — одним параметром запроса; `n` — порядок справочника. */
function recordset(
  rows: readonly Record<string, string | null>[],
  keys: readonly { key: string; type: string }[],
) {
  const defs = ['id text', 'n integer', ...keys.map((k) => `"${k.key}" ${k.type}`)].join(', ');
  const json = rows.map((r, n) => ({ ...r, n }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(defs)})`;
}

function windowRecordset(id: OrgDictWindowId, rows: readonly Row[]) {
  const keys = [
    ...ORG_DICT_COLUMNS[id].map((c) => ({ key: c.key, type: c.type === 'date' ? 'date' : 'text' })),
    ...(CODED[id] ?? []).map((key) => ({ key: `${key}_text`, type: 'text' })),
    ...(EXTRA[id] ?? []).map((key) => ({ key, type: 'text' })),
  ];
  return recordset(rows, keys);
}

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

const NATURAL = [field('n')];

// ОТКЛОНЕНИЕ: docs/deviations.md#48 — как в прототипе, не по «Создано» из ТЗ «Списки».
/** Сортировка по умолчанию: по первому столбцу; статусы и шаблоны — в порядке справочника. */
function windowSort(id: OrgDictWindowId): ListSort | null {
  return ORG_DICT_NATURAL_ORDER.has(id) ? null : { key: ORG_DICT_COLUMNS[id][0]!.key, dir: 'asc' };
}

/** Без выбранной сортировки справочник в своём порядке — сортировка «нет», а не общая по «Создано». */
const naturalQuery = (id: OrgDictWindowId, query: ListQuery): ListQuery =>
  query.sort === undefined ? { ...query, sort: windowSort(id) } : query;

/** Строка окна справочника на экране: код значения и тексты столбцов (дата — `YYYY-MM-DD`). */
export interface PlatformDictRow {
  id: string;
  values: Record<string, string>;
}

function rowFields(id: OrgDictWindowId, columns: ListColumns) {
  const fields: Record<string, SQL> = { id: sql`${field('id')}` };
  for (const c of ORG_DICT_COLUMNS[id]) {
    const column = columns[c.key]!;
    fields[c.key] =
      c.type === 'date'
        ? sql`to_char(${field(c.key)}, 'YYYY-MM-DD')`
        : sql`coalesce(${column.display ?? column.value}, '')`;
  }
  for (const key of EXTRA[id] ?? []) fields[key] = sql`coalesce(${field(key)}, '')`;
  return fields;
}

/** Окно справочника: страница списка значений (поиск, фильтры, сортировка, группировка). */
export async function listPlatformDictPage(
  tx: Tx,
  id: OrgDictWindowId,
  query: ListQuery,
  t: ListTexts,
  today: string,
) {
  const source = windowRecordset(id, await WINDOW_ROWS[id](tx, t, today));
  const columns = windowColumns(id);
  const page = await selectListPage({
    query: naturalQuery(id, query),
    columns,
    natural: NATURAL,
    defaultSort: windowSort(id),
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...rowFields(id, columns), ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (Record<string, string> & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: fromOf(tx, source),
  });
  return {
    ...page,
    rows: page.rows.map(({ id: code, ...values }): PlatformDictRow => ({ id: code!, values })),
  };
}

/** Значения столбца окна справочника для фильтра-галочек; `q` — «Найти значение». */
export async function listPlatformDictValues(
  tx: Tx,
  id: OrgDictWindowId,
  key: string,
  t: ListTexts,
  today: string,
  q?: string,
) {
  const source = windowRecordset(id, await WINDOW_ROWS[id](tx, t, today));
  return selectListValues({
    columns: windowColumns(id),
    key,
    scope: undefined,
    from: fromOf(tx, source),
    q,
  });
}

/** Значения справочника для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys`. */
export async function exportPlatformDict(
  tx: Tx,
  id: OrgDictWindowId,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  today: string,
) {
  const source = windowRecordset(id, await WINDOW_ROWS[id](tx, t, today));
  return selectListExport({
    query: naturalQuery(id, query),
    columns: windowColumns(id),
    keys,
    natural: NATURAL,
    defaultSort: windowSort(id),
    scope: undefined,
    from: fromOf(tx, source),
  });
}

/** Число значений справочника для плитки; у ГКЭД — подклассы, без выборки строк. */
async function windowCount(
  db: Db | Tx,
  id: OrgDictWindowId,
  t: ListTexts,
  today: string,
): Promise<number> {
  if (id !== 'gked') return (await WINDOW_ROWS[id](db, t, today)).length;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(gkedItems)
    .where(and(eq(gkedItems.level, 'subclass'), eq(gkedItems.active, true)));
  return row?.n ?? 0;
}

/**
 * Плитки «Справочников платформы» по группам (прототип `orgDictGroups`): справочники групп по порядку
 * без служебных, «Ставки единого налога» — после «Налогов и ставок», число действующих значений.
 */
export async function platformDictTiles(
  db: Db | Tx,
  t: ListTexts,
  today: string,
): Promise<OrgDictGroup[]> {
  const counts = Object.fromEntries(
    await Promise.all(
      ORG_DICT_WINDOW_IDS.map(async (id) => [id, await windowCount(db, id, t, today)] as const),
    ),
  ) as Record<OrgDictId, number>;
  const [types] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reportTypes)
    .where(eq(reportTypes.active, true));
  counts.types = types?.n ?? 0;
  return orgDictGroups(await platformDictGroupDefs(db), counts, {
    tab: t('dicts.platform.en_rates'),
    about: t('dicts.platform.en_rates_about'),
    usedIn: t('dicts.platform.en_rates_used'),
  });
}

/* ───────────── «Поиск по всем значениям» ───────────── */

/** Кто и когда менял значение (у разделов `platform_reference` — нет). */
interface Audit {
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

type AuditTable = PgTable & {
  createdBy: PgColumn;
  updatedBy: PgColumn;
  updatedAt: PgColumn;
};

/** «Изменено», «Создал», «Изменил» значений таблицы по коду; автор без сотрудника — администратор платформы. */
async function auditOf(
  db: Db | Tx,
  table: AuditTable,
  code: PgColumn,
): Promise<Map<string, Audit>> {
  const rows = await db
    .select({
      code: sql<string>`${code}`,
      updatedAt: sql<string | null>`${table.updatedAt}`,
      createdBy: sql<string | null>`${table.createdBy}`,
      updatedBy: sql<string | null>`${table.updatedBy}`,
    })
    .from(table);
  return new Map(
    rows.map((r) => [
      r.code,
      {
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
        createdBy: auditActorName(r.createdBy, null),
        updatedBy: auditActorName(r.updatedBy, null),
      },
    ]),
  );
}

interface ValueRow extends Audit {
  id: string;
  d: AllValuesDict;
  d_text: string;
  name: string;
}

const NO_AUDIT: Audit = { updatedAt: null, createdBy: null, updatedBy: null };

/** Значения одного справочника для «Поиска по всем значениям» (прототип: d — справочник, name — значение). */
async function valueRows(
  db: Db | Tx,
  d: AllValuesDict,
  t: ListTexts,
  today: string,
): Promise<ValueRow[]> {
  const title = t(`dicts.platform.dict.${d}`);
  const make = (id: string, name: string, audit: Audit = NO_AUDIT): ValueRow => ({
    id: `${d}|${id}`,
    d,
    d_text: title,
    name,
    ...audit,
  });
  const named = async (
    items: Promise<{ code: string; name: string }[]>,
    table: AuditTable & { code: PgColumn },
  ): Promise<ValueRow[]> => {
    const [list, audit] = await Promise.all([items, auditOf(db, table, table.code)]);
    return list.map((x) => make(x.code, x.name, audit.get(x.code)));
  };
  switch (d) {
    case 'regimes':
      return named(listTaxRegimes(db), taxRegimes);
    case 'forms':
      return named(listOwnershipForms(db), ownershipForms);
    case 'organs':
      return named(listAuthorities(db), authorities);
    case 'benefits':
      return named(listTaxBenefits(db), taxBenefits);
    case 'reasons':
      return named(listDueChangeReasons(db), dueChangeReasons);
    case 'ugns':
      return named(listTaxOffices(db), taxOffices);
    case 'bases':
      return named(listReportBases(db), reportBases);
    case 'banks':
      return named(listBanks(db), banks);
    case 'cats':
      return (await referenceItems(db, d)).map((x) => make(x.code || x.name, x.name));
    case 'phones':
      return (await phoneCodeList(db))
        .filter((x) => x.active)
        .map((x) => make(x.cc, `${x.flag} ${x.name} +${x.code} · ${x.mask}`.trim()));
    case 'calendar': {
      const audit = await auditOf(db, productionCalendar, productionCalendar.day);
      const entries = await productionCalendarEntries(db);
      const everyYear = new Set(entries.filter((e) => /^\d\d-\d\d$/.test(e.day)).map((e) => e.day));
      return (await calendarRows(db, t, today)).map((x) => {
        const key = everyYear.has(x.d.slice(5)) && x.kind === 'holiday' ? x.d.slice(5) : x.d;
        return make(x.id, `${formatDateRu(x.d)} — ${x.name}`, audit.get(key));
      });
    }
  }
}

const ALL_VALUE_COLUMNS: ListColumns = {
  d: {
    type: 'enum',
    label: 'dicts.platform.col.all.d',
    value: field('d'),
    display: field('d_text'),
    sort: { value: field('d_text'), text: true },
  },
  name: { type: 'text', label: 'dicts.platform.col.all.name', value: field('name') },
  // ОТКЛОНЕНИЕ: docs/deviations.md#48 — даты появления значения у справочников платформы нет,
  // «Создано» пусто (в прототипе — `_ca` значения).
  createdAt: { type: 'datetime', label: 'grid.col.created_at', value: sql`null::timestamptz` },
  updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: field('updated_at') },
  createdBy: { type: 'enum', label: 'grid.col.created_by', value: field('created_by') },
  updatedBy: { type: 'enum', label: 'grid.col.updated_by', value: field('updated_by') },
};

const ALL_VALUES_SORT: ListSort = { key: 'd', dir: 'asc' };

async function allValuesRecordset(db: Db | Tx, t: ListTexts, today: string) {
  const rows = (await Promise.all(ALL_VALUES_DICTS.map((d) => valueRows(db, d, t, today)))).flat();
  return recordset(
    rows.map((r) => ({
      id: r.id,
      d: r.d,
      d_text: r.d_text,
      name: r.name,
      updated_at: r.updatedAt,
      created_by: r.createdBy,
      updated_by: r.updatedBy,
    })),
    [
      { key: 'd', type: 'text' },
      { key: 'd_text', type: 'text' },
      { key: 'name', type: 'text' },
      { key: 'updated_at', type: 'timestamptz' },
      { key: 'created_by', type: 'text' },
      { key: 'updated_by', type: 'text' },
    ],
  );
}

/** Строка «Поиска по всем значениям»: справочник (код и название), значение, кто и когда менял. */
export interface PlatformValueRow {
  id: string;
  dict: AllValuesDict;
  dictName: string;
  name: string;
  audit: Audit;
}

/** «Поиск по всем значениям»: страница общей таблицы «Справочник — значение». */
export async function listPlatformValuesPage(
  tx: Tx,
  query: ListQuery,
  t: ListTexts,
  today: string,
) {
  const source = await allValuesRecordset(tx, t, today);
  const page = await selectListPage({
    query,
    columns: ALL_VALUE_COLUMNS,
    natural: NATURAL,
    defaultSort: ALL_VALUES_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          id: sql<string>`${field('id')}`,
          dict: sql<AllValuesDict>`${field('d')}`,
          dictName: sql<string>`${field('d_text')}`,
          name: sql<string>`${field('name')}`,
          updatedAt: sql<string | null>`${field('updated_at')}`,
          createdBy: sql<string | null>`${field('created_by')}`,
          updatedBy: sql<string | null>`${field('updated_by')}`,
          ...window,
        })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
  return {
    ...page,
    rows: page.rows.map(({ updatedAt, createdBy, updatedBy, ...r }): PlatformValueRow => ({
      ...r,
      audit: {
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        createdBy,
        updatedBy,
      },
    })),
  };
}

/** Значения столбца «Поиска по всем значениям» для фильтра-галочек. */
export async function listPlatformValueValues(
  tx: Tx,
  key: string,
  t: ListTexts,
  today: string,
  q?: string,
) {
  return selectListValues({
    columns: ALL_VALUE_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, await allValuesRecordset(tx, t, today)),
    q,
  });
}

/** «Поиск по всем значениям» для выгрузки в Excel. */
export async function exportPlatformValues(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  t: ListTexts,
  today: string,
) {
  return selectListExport({
    query,
    columns: ALL_VALUE_COLUMNS,
    keys,
    natural: NATURAL,
    defaultSort: ALL_VALUES_SORT,
    scope: undefined,
    from: fromOf(tx, await allValuesRecordset(tx, t, today)),
  });
}

/** Название справочника, как на плитке (для заголовка файла Excel). */
export async function platformDictTitle(
  db: Db | Tx,
  id: OrgDictWindowId,
  t: ListTexts,
): Promise<string> {
  if (id === 'en_rates') return t('dicts.platform.en_rates');
  const tab = (await platformDictGroupDefs(db))
    .flatMap((g) => g.tabs)
    .find((x) => orgDictIdOfKey(x.key) === id)?.tab;
  return tab ?? t('tab.dicts.platform');
}
