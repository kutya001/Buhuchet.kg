/**
 * Списки записей (ТЗ «Общие элементы интерфейса» → «Списки записей (UnifiedDataGrid)», прототип
 * ui/grid.js): страницы, сортировка, ключи списков для настроек вида. Сортировку, страницы и
 * фильтры выполняет сервер; эти правила общие для API и экрана.
 */

/** «По 25, 50, 100 или «Все записи»» (ТЗ «Страницы»). */
export const LIST_PAGE_SIZES = [25, 50, 100] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number] | 'all';
export const DEFAULT_PAGE_SIZE: ListPageSize = 25;

/**
 * «Все записи» за один запрос — не больше стольких строк: большой реестр на «Все записи» листается
 * страницами по 5 000, а не грузит в браузер десятки тысяч строк (ТЗ: «большие реестры загружаются
 * с сервера постранично»).
 */
export const ALL_ROWS_LIMIT = 5000;

export function isListPageSize(value: unknown): value is ListPageSize {
  return value === 'all' || (LIST_PAGE_SIZES as readonly unknown[]).includes(value);
}

/** Сколько строк на странице. */
export function pageLimit(size: ListPageSize): number {
  return size === 'all' ? ALL_ROWS_LIMIT : size;
}

/** Число страниц; у пустого списка — одна. */
export function pageCount(total: number, size: ListPageSize): number {
  return Math.max(1, Math.ceil(total / pageLimit(size)));
}

/**
 * Номер страницы в пределах списка (с 1): после удаления записей или смены фильтра страница за
 * концом списка становится последней (прототип refresh: `if(s.page>=pages)s.page=pages-1`).
 */
export function clampPage(page: number, total: number, size: ListPageSize): number {
  const whole = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, whole), pageCount(total, size));
}

/** «Показано 1 – 25 из 140»: номера первой и последней записи страницы; у пустого списка — 0 и 0. */
export function shownRange(
  page: number,
  size: ListPageSize,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const limit = pageLimit(size);
  const current = clampPage(page, total, size);
  return { from: (current - 1) * limit + 1, to: Math.min(total, current * limit) };
}

export type SortDir = 'asc' | 'desc';

export interface ListSort {
  key: string;
  dir: SortDir;
}

/**
 * Клик по заголовку столбца: по возрастанию → по убыванию → без сортировки (ТЗ «Сортировка»,
 * прототип bind, `data-sort`). Клик по другому столбцу начинает с возрастания.
 */
export function nextSort(current: ListSort | null, key: string): ListSort | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
}

/**
 * Тип столбца (прототип grid.js, `type`): от него зависят фильтр, сортировка и вид значения. Деньги —
 * тыйыны, `datetime` — момент, дата фильтра для него — по Бишкеку.
 */
export type ListColumnType = 'text' | 'enum' | 'int' | 'money' | 'date' | 'datetime';

export type ListFilterType = 'text' | 'enum' | 'num' | 'date';

/** Фильтр у столбца — по его типу (ТЗ «Фильтр у каждого столбца по его типу»; прототип ftype). */
export function filterTypeOf(type: ListColumnType): ListFilterType {
  if (type === 'enum') return 'enum';
  if (type === 'date' || type === 'datetime') return 'date';
  if (type === 'int' || type === 'money') return 'num';
  return 'text';
}

/**
 * Значение фильтра столбца (ТЗ «Поиск и фильтры»): текст — подстрока; справочник — отмеченные
 * значения, '' — «(Пусто)»; число — «От» и «До» включительно; дата — `YYYY-MM-DD`, «По дату» —
 * включая весь день.
 */
export type ListFilterValue =
  | { type: 'text'; q: string }
  | { type: 'enum'; vals: string[] }
  | { type: 'num'; from?: number | null; to?: number | null }
  | { type: 'date'; from?: string | null; to?: string | null };

/** Запрос страницы списка: `sort` undefined — по умолчанию списка, null — без сортировки. */
export interface ListQuery {
  sort: ListSort | null | undefined;
  page: number;
  size: ListPageSize;
  filters: Readonly<Record<string, ListFilterValue>>;
}

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по системному столбцу «Создано»
 * (ТЗ «Сортировка»; у расчётных списков без «Создано» своя, её задаёт список).
 */
export const DEFAULT_LIST_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Настройки вида списка у пользователя (ТЗ «Настройки вида»; прототип gsave): вид «Таблица /
 * Карточки», плотность, ширина, показанные и скрытые столбцы (столбца нет ни там, ни там — он
 * появился позже, у него видимость по умолчанию), порядок, ширины в px, сортировка (null —
 * пользователь выключил сортировку, нет поля — по умолчанию) и записей на странице. Схема для API —
 * `ViewSettings` в `@buhuchet/shared`.
 */
export interface GridViewSettings {
  view?: 'table' | 'cards';
  density?: 'normal' | 'compact';
  width?: 'full' | 'center';
  shown?: string[];
  hidden?: string[];
  order?: string[];
  widths?: Record<string, number>;
  sort?: ListSort | null;
  size?: ListPageSize;
}

/**
 * Списки, у которых сохраняются настройки вида пользователя (ТЗ «Настройки вида … запоминаются для
 * каждого пользователя и каждого списка»): ключ — «модуль.вкладка». Новый список добавляет свой ключ
 * сюда — сервер не хранит настройки списков, которых нет.
 */
export const GRID_KEYS = ['staff.list'] as const;
export type GridKey = (typeof GRID_KEYS)[number];

export function isGridKey(value: string): value is GridKey {
  return (GRID_KEYS as readonly string[]).includes(value);
}

/**
 * Форма слова после числа: 1 сотрудник, 2 сотрудника, 5 сотрудников, 11 сотрудников (прототип
 * core/utils.js, plural).
 */
export function pluralForm(n: number): 'one' | 'few' | 'many' {
  const m = Math.abs(Math.trunc(n)) % 100;
  const k = m % 10;
  if (m > 10 && m < 20) return 'many';
  if (k > 1 && k < 5) return 'few';
  return k === 1 ? 'one' : 'many';
}
