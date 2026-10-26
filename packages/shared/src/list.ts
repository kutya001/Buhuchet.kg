import {
  DEFAULT_PAGE_SIZE,
  ENUM_FILTER_STEPS_MAX,
  ENUM_FILTER_VALS_MAX,
  enumSelectionSize,
  GROUP_AGGS,
  isListPageSize,
  MAX_GROUP_LEVELS,
  type GridViewSettings,
  type ListGroup as DomainListGroup,
  type ListQuery,
  type ListSort,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Tyiyn } from './common';

export type { ListQuery } from '@buhuchet/domain';

/**
 * Списки записей (ТЗ «Списки записей (UnifiedDataGrid)»): запрос страницы, фильтры столбцов, ответ со
 * страницей и итогами, настройки вида пользователя. Сортировку, страницы, фильтры и итоги считает
 * сервер: в браузер приходит только текущая страница.
 */

/** Ключ столбца списка, как в коде столбцов: `fullName`, `createdAt`. */
export const ColumnKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);

export const ListPageSizeSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100),
  z.literal('all'),
]);

export const ListSortSchema = z.object({ key: ColumnKey, dir: z.enum(['asc', 'desc']) });

const FILTER_TEXT_MAX = 200;

/**
 * Текст фильтра или поиска: не длиннее 200 знаков и без нулевого символа — PostgreSQL его в тексте
 * не принимает, и запрос упал бы ошибкой сервера вместо «неверный фильтр».
 */
const FilterText = z
  .string()
  .max(FILTER_TEXT_MAX)
  .refine((s) => !s.includes('\u0000'));

/** Граница фильтра «От» / «До»: целое (деньги — в тыйынах), дробное база не сравнит с целым столбцом. */
const FilterNumber = Tyiyn;

/** Дата фильтра: года 0000 в базе нет — такой запрос дал бы ошибку сервера, а не «неверный фильтр». */
const FilterDate = IsoDate.refine((d) => d >= '0001-01-01');

const EnumVals = z.array(FilterText).max(ENUM_FILTER_VALS_MAX);

/**
 * Шаг выбора галочками (`EnumStep` из `@buhuchet/domain`): отметить или снять значения `vals` либо
 * все значения, подпись которых содержит `match` ('' — все).
 */
const EnumStepSchema = z.union([
  z.strictObject({ on: z.boolean(), vals: EnumVals }),
  z.strictObject({ on: z.boolean(), match: FilterText }),
]);

/**
 * Фильтр столбца по его типу (ТЗ «Поиск и фильтры»): текст — по подстроке; справочник и статус —
 * отмеченные значения (пустая строка — «(Пусто)») и шаги «Выбрать все» по «Найти значение»
 * (`enumChecked`); число — «От» и «До» включительно (деньги — в тыйынах); дата — «С даты» и
 * «По дату», последний день входит целиком.
 */
export const ListFilter = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), q: FilterText.trim().min(1) }),
  z
    .object({
      type: z.literal('enum'),
      vals: EnumVals,
      steps: z.array(EnumStepSchema).max(ENUM_FILTER_STEPS_MAX).optional(),
    })
    .refine((f) => enumSelectionSize(f) <= ENUM_FILTER_VALS_MAX),
  z
    .object({
      type: z.literal('num'),
      from: FilterNumber.nullable().optional(),
      to: FilterNumber.nullable().optional(),
    })
    .refine((f) => f.from != null || f.to != null),
  z
    .object({
      type: z.literal('date'),
      from: FilterDate.nullable().optional(),
      to: FilterDate.nullable().optional(),
    })
    .refine((f) => f.from != null || f.to != null),
]);
export type ListFilter = z.infer<typeof ListFilter>;

export const ListFilters = z
  .record(ColumnKey, ListFilter)
  .refine((filters) => Object.keys(filters).length <= 30);
export type ListFilters = z.infer<typeof ListFilters>;

const KEY = '[a-zA-Z][a-zA-Z0-9_]{0,39}';
const COLUMN_LIST_MAX = 100;

/** Ключи столбцов через запятую: `fullName,role,phone`. */
const keyList = (max: number) =>
  z
    .string()
    .regex(new RegExp(`^${KEY}(?:,${KEY}){0,${max - 1}}$`))
    .optional();

/** Итоги в строках групп: столбец → сумма, среднее, минимум, максимум или количество. */
export const ListAggs = z
  .record(ColumnKey, z.enum(GROUP_AGGS))
  .refine((agg) => Object.keys(agg).length <= COLUMN_LIST_MAX);

/**
 * Параметры запроса страницы (GET): `sort` — `fullName.asc`, `createdAt.desc` или `none` (без
 * сортировки; нет параметра — сортировка списка по умолчанию), `page` — с 1, `size` — 25, 50, 100,
 * `all`, `filters` — фильтры столбцов в JSON, `q` — поиск из верхней панели по столбцам `qcols`
 * (видимым на экране; нет — по всем), `group` — столбцы группировки через запятую (до двух), `agg` —
 * итоги групп в JSON. Проверку столбцов делает метод списка: он знает свои.
 */
export const ListQueryParams = z.object({
  sort: z
    .string()
    .regex(/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}\.(?:asc|desc)|none)$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  size: z.enum(['25', '50', '100', 'all']).optional(),
  filters: z.string().max(8000).optional(),
  // Поиск — не длиннее фильтра столбца.
  q: FilterText.optional(),
  qcols: keyList(COLUMN_LIST_MAX),
  group: keyList(MAX_GROUP_LEVELS),
  agg: z.string().max(4000).optional(),
});
export type ListQueryParams = z.infer<typeof ListQueryParams>;

function parseJson<T extends z.ZodType>(
  text: string | undefined,
  schema: T,
): { ok: true; value: z.infer<T> | undefined } | { ok: false } {
  if (!text) return { ok: true, value: undefined };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** Разбор параметров запроса; ошибка — фильтры или итоги не в своём формате. */
export function parseListQuery(
  params: ListQueryParams,
): { ok: true; query: ListQuery } | { ok: false } {
  const filters = parseJson(params.filters, ListFilters);
  const agg = parseJson(params.agg, ListAggs);
  if (!filters.ok || !agg.ok) return { ok: false };
  const size = params.size === 'all' ? 'all' : Number(params.size ?? DEFAULT_PAGE_SIZE);
  const q = params.q?.trim() ?? '';
  const group = params.group ? [...new Set(params.group.split(','))] : [];
  const query: ListQuery = {
    sort: sortParam(params.sort),
    page: params.page ?? 1,
    size: isListPageSize(size) ? size : DEFAULT_PAGE_SIZE,
    filters: filters.value ?? {},
  };
  if (q) query.search = { q, keys: params.qcols ? [...new Set(params.qcols.split(','))] : [] };
  if (group.length) query.group = group;
  if (agg.value && Object.keys(agg.value).length) query.agg = agg.value;
  return { ok: true, query };
}

function sortParam(value: string | undefined): ListSort | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  const at = value.lastIndexOf('.');
  return { key: value.slice(0, at), dir: value.slice(at + 1) === 'desc' ? 'desc' : 'asc' };
}

/** Параметры запроса для клиента API — обратное к `parseListQuery`. */
export function listQueryParams(query: ListQuery): Record<string, string> {
  const params: Record<string, string> = { page: String(query.page), size: String(query.size) };
  if (query.sort !== undefined) {
    params.sort = query.sort ? `${query.sort.key}.${query.sort.dir}` : 'none';
  }
  if (Object.keys(query.filters).length) params.filters = JSON.stringify(query.filters);
  if (query.search?.q.trim()) {
    params.q = query.search.q.trim();
    if (query.search.keys.length) params.qcols = query.search.keys.join(',');
  }
  if (query.group?.length) params.group = query.group.join(',');
  if (query.agg && Object.keys(query.agg).length) params.agg = JSON.stringify(query.agg);
  return params;
}

/**
 * Группа списка (`ListGroup` из `@buhuchet/domain`): значение, подпись как на экране (null —
 * «(Пусто)»), число записей и итоги числовых столбцов; у первого уровня — группы второго.
 */
const ListGroupBase = z.object({
  key: z.string(),
  label: z.string().nullable(),
  count: z.number().int().nonnegative(),
  aggs: z.record(ColumnKey, z.number().nullable()),
});
export const ListGroupSchema = ListGroupBase.extend({ sub: z.array(ListGroupBase).optional() });
export type ListGroupSchema = z.infer<typeof ListGroupSchema>;

type _SameGroup = ListGroupSchema extends DomainListGroup ? true : never;
const _sameGroup: _SameGroup = true;

/**
 * Ответ со страницей: записи текущей страницы, всего записей по фильтру, номер страницы (сервер
 * возвращает последнюю, если запрошенной уже нет), размер и итоги по суммам всех отфильтрованных
 * записей (ТЗ: «итоги считает сервер и отдаёт вместе со страницей»; деньги — в тыйынах).
 */
export function listPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    size: ListPageSizeSchema,
    totals: z.record(ColumnKey, z.number()),
    /** Сгруппированный список: группы по всем отфильтрованным записям с числом записей и итогами. */
    groups: z.array(ListGroupSchema).optional(),
    /** Ключи групп каждой записи страницы (по порядку `items`): первый и второй уровень. */
    rowGroups: z.array(z.array(z.string()).max(MAX_GROUP_LEVELS)).optional(),
  });
}

/**
 * Значения столбца для фильтра-галочек (прототип filterPop: значения с числом записей, «(Пусто)»):
 * значение (код), подпись как на экране (null — пусто) и сколько записей с ним во всём списке.
 * `q` — «Найти значение»: только значения, подпись которых его содержит (`matchesValue`), — поиск по
 * всем значениям, а не по пришедшим (ТЗ «Поиск и фильтры»). `total` — сколько всего подходящих
 * значений, `more` — их больше, чем пришло.
 */
export const ListValuesQuery = z.object({
  col: ColumnKey,
  q: FilterText.optional(),
});
export const ListValues = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  total: z.number().int().nonnegative(),
  more: z.boolean(),
});
export type ListValues = z.infer<typeof ListValues>;

/**
 * Выгрузка в Excel (ТЗ «Экспорт в Excel всех отфильтрованных записей; файл формируется на сервере»):
 * те же поиск, фильтры и сортировка, что у страницы, и видимые столбцы по порядку экрана (`cols`).
 */
export const ListExportParams = ListQueryParams.extend({
  cols: z.string().regex(new RegExp(`^${KEY}(?:,${KEY}){0,${COLUMN_LIST_MAX - 1}}$`)),
});
export type ListExportParams = z.infer<typeof ListExportParams>;

/**
 * Ключ настроек вида: список «модуль.вкладка» (`GRID_KEYS` в `@buhuchet/domain`) или «Статистика»
 * модуля `stats.<модуль>` (`isViewKey`).
 */
export const GridKeyParam = z.string().regex(/^[a-z][a-z0-9-]{0,30}\.[a-z][a-z0-9-]{0,30}$/);

/**
 * Настройки вида списка у пользователя (ТЗ «Настройки вида (столбцы, их порядок, ширины, плотность,
 * сортировка, группировка) запоминаются для каждого пользователя и каждого списка», прототип gsave):
 * вид «Таблица / Карточки» на ПК и на телефоне (по умолчанию у них разный вид, поэтому и выбор у
 * каждого свой), плотность, ширина, показанные и скрытые столбцы (столбец, которого нет
 * ни там, ни там, появился позже — у него видимость по умолчанию), порядок, ширины, сортировка
 * (null — пользователь выключил сортировку), записей на странице, группировка и итоги групп; у
 * «Статистики» модуля (`stats.<модуль>`) — показана ли она на ПК и на телефоне. Страница, фильтры и
 * поиск не запоминаются.
 */
export const ViewSettings = z.object({
  view: z.enum(['table', 'cards']).optional(),
  phoneView: z.enum(['table', 'cards']).optional(),
  density: z.enum(['normal', 'compact']).optional(),
  width: z.enum(['full', 'center']).optional(),
  shown: z.array(ColumnKey).max(COLUMN_LIST_MAX).optional(),
  hidden: z.array(ColumnKey).max(COLUMN_LIST_MAX).optional(),
  order: z.array(ColumnKey).max(COLUMN_LIST_MAX).optional(),
  widths: z
    .record(ColumnKey, z.number().int().min(70).max(1200))
    .refine((w) => Object.keys(w).length <= COLUMN_LIST_MAX)
    .optional(),
  sort: ListSortSchema.nullable().optional(),
  size: ListPageSizeSchema.optional(),
  group: z.array(ColumnKey).max(MAX_GROUP_LEVELS).optional(),
  agg: z
    .record(ColumnKey, z.enum([...GROUP_AGGS, 'none']))
    .refine((agg) => Object.keys(agg).length <= COLUMN_LIST_MAX)
    .optional(),
  stats: z.boolean().optional(),
  phoneStats: z.boolean().optional(),
});
export type ViewSettings = z.infer<typeof ViewSettings>;

// Схема даёт тот же тип, что `GridViewSettings` из @buhuchet/domain: иначе здесь ошибка типов.
type _SameSettings = ViewSettings extends GridViewSettings ? true : never;
const _sameSettings: _SameSettings = true;

/** Все сохранённые настройки вида пользователя: по ключу списка. */
export const ViewSettingsMap = z.object({ items: z.record(z.string(), ViewSettings) });
export type ViewSettingsMap = z.infer<typeof ViewSettingsMap>;

/** Настройки вида одного списка; null — «Сбросить вид», всё по умолчанию. */
export const ViewSettingsResponse = z.object({ settings: ViewSettings.nullable() });
export type ViewSettingsResponse = z.infer<typeof ViewSettingsResponse>;
