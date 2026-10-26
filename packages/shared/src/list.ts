import {
  DEFAULT_PAGE_SIZE,
  isListPageSize,
  type GridViewSettings,
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

/** Граница фильтра «От» / «До»: целое (деньги — в тыйынах), дробное база не сравнит с целым столбцом. */
const FilterNumber = Tyiyn;

/** Дата фильтра: года 0000 в базе нет — такой запрос дал бы ошибку сервера, а не «неверный фильтр». */
const FilterDate = IsoDate.refine((d) => d >= '0001-01-01');

/**
 * Фильтр столбца по его типу (ТЗ «Поиск и фильтры»): текст — по подстроке; справочник и статус —
 * отмеченные значения, пустая строка — «(Пусто)»; число — «От» и «До» включительно (деньги —
 * в тыйынах); дата — «С даты» и «По дату», последний день входит целиком.
 */
export const ListFilter = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), q: z.string().trim().min(1).max(FILTER_TEXT_MAX) }),
  z.object({
    type: z.literal('enum'),
    vals: z.array(z.string().max(FILTER_TEXT_MAX)).max(200),
  }),
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

/**
 * Параметры запроса страницы (GET): `sort` — `fullName.asc`, `createdAt.desc` или `none` (без
 * сортировки; нет параметра — сортировка списка по умолчанию), `page` — с 1, `size` — 25, 50, 100,
 * `all`, `filters` — фильтры столбцов в JSON. Проверку столбцов делает метод списка: он знает свои.
 */
export const ListQueryParams = z.object({
  sort: z
    .string()
    .regex(/^(?:[a-zA-Z][a-zA-Z0-9_]{0,39}\.(?:asc|desc)|none)$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  size: z.enum(['25', '50', '100', 'all']).optional(),
  filters: z.string().max(8000).optional(),
});
export type ListQueryParams = z.infer<typeof ListQueryParams>;

/** Разбор параметров запроса; ошибка — фильтры не в формате `ListFilters`. */
export function parseListQuery(
  params: ListQueryParams,
): { ok: true; query: ListQuery } | { ok: false } {
  let filters: ListQuery['filters'] = {};
  if (params.filters) {
    let raw: unknown;
    try {
      raw = JSON.parse(params.filters);
    } catch {
      return { ok: false };
    }
    const parsed = ListFilters.safeParse(raw);
    if (!parsed.success) return { ok: false };
    filters = parsed.data;
  }
  const size = params.size === 'all' ? 'all' : Number(params.size ?? DEFAULT_PAGE_SIZE);
  return {
    ok: true,
    query: {
      sort: sortParam(params.sort),
      page: params.page ?? 1,
      size: isListPageSize(size) ? size : DEFAULT_PAGE_SIZE,
      filters,
    },
  };
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
  return params;
}

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
  });
}

/** Ключ списка для настроек вида: «модуль.вкладка» (`GRID_KEYS` в `@buhuchet/domain`). */
export const GridKeyParam = z.string().regex(/^[a-z][a-z0-9-]{0,30}\.[a-z][a-z0-9-]{0,30}$/);

const COLUMN_LIST_MAX = 100;

/**
 * Настройки вида списка у пользователя (ТЗ «Настройки вида (столбцы, их порядок, ширины, плотность,
 * сортировка, группировка) запоминаются для каждого пользователя и каждого списка», прототип gsave):
 * вид «Таблица / Карточки», плотность, ширина, показанные и скрытые столбцы (столбец, которого нет
 * ни там, ни там, появился позже — у него видимость по умолчанию), порядок, ширины, сортировка
 * (null — пользователь выключил сортировку) и записей на странице. Страница и фильтры не
 * запоминаются.
 */
export const ViewSettings = z.object({
  view: z.enum(['table', 'cards']).optional(),
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
