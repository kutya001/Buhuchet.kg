import { MENU_MODULE_IDS, type MenuModuleId } from '../org/modules';

/**
 * Списки записей (ТЗ «Общие элементы интерфейса» → «Списки записей (UnifiedDataGrid)», прототип
 * ui/grid.js): страницы, сортировка, поиск, группировка, ключи списков для настроек вида.
 * Сортировку, страницы, фильтры, поиск и итоги групп выполняет сервер; эти правила общие для API и
 * экрана.
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
// ОТКЛОНЕНИЕ: docs/deviations.md#30 — в прототипе «Все записи» без предела; решение заказчика — А.
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

/**
 * Поиск из верхней панели (ТЗ «Общий поиск», «Поиск и фильтры»): текст и столбцы, которые видны на
 * экране, — ищется по тому, что видно. Без столбцов — по всем столбцам списка.
 */
export interface ListSearch {
  q: string;
  keys: readonly string[];
}

/**
 * Запрос страницы списка: `sort` undefined — по умолчанию списка, null — без сортировки; `group` —
 * столбцы группировки (до двух), `agg` — итог в строке группы у числовых столбцов.
 */
export interface ListQuery {
  sort: ListSort | null | undefined;
  page: number;
  size: ListPageSize;
  filters: Readonly<Record<string, ListFilterValue>>;
  search?: ListSearch;
  group?: readonly string[];
  agg?: Readonly<Record<string, GroupAgg>>;
}

/** Строк в выгрузке в Excel — не больше стольких за раз (годовые отчёты большой организации — около 8 000). */
export const EXPORT_ROWS_LIMIT = 50_000;

/** Целое с разрядами через неразрывный пробел: «50 000» (как суммы `formatSom`, без копеек). */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/** В сгруппированном списке страниц по 25 нет: все записи по 5 000 за раз, как «Все записи». */
export function listPageSize(query: Pick<ListQuery, 'size' | 'group'>): ListPageSize {
  return query.group?.length ? 'all' : query.size;
}

/**
 * Текст для поиска (прототип `norm`): без учёта регистра, «ё» = «е», неразрывный пробел — обычный.
 */
export function searchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\u00a0/g, ' ');
}

/** Знаки, которые поиск пропускает (прототип `strip`): пробелы, дефисы, скобки, «+», точки, запятые… */
export const SEARCH_SKIP_CHARS = /[\s\-()+.,№«»"]/g;

/** Сжатый поиск (без пробелов и знаков) — только с трёх оставшихся символов, иначе находит всё подряд. */
export const SEARCH_COMPACT_MIN = 3;

export function compactSearchText(value: string): string {
  return searchText(value).replace(SEARCH_SKIP_CHARS, '');
}

/**
 * Подходит ли текст ячейки под поиск (прототип compute): подстрока без учёта регистра и «ё»; а с
 * трёх значащих символов — ещё и без пробелов, дефисов и скобок с обеих сторон, поэтому «0555
 * 123456» находит «+996 555 123 456», а «1250,50» — «1 250,50». Эталон для поиска на сервере.
 */
export function matchesSearch(text: string, q: string): boolean {
  const needle = searchText(q.trim());
  if (!needle) return true;
  if (searchText(text).includes(needle)) return true;
  const compact = compactSearchText(q);
  return compact.length >= SEARCH_COMPACT_MIN && compactSearchText(text).includes(compact);
}

/** Не больше двух уровней группировки (ТЗ «Группировка»). */
export const MAX_GROUP_LEVELS = 2;

/** Итог числового столбца в строке группы (ТЗ «Группировка»; прототип `AGG_L`). */
export const GROUP_AGGS = ['sum', 'avg', 'min', 'max', 'count'] as const;
export type GroupAgg = (typeof GROUP_AGGS)[number];

/** Выбор итога в окне «Группировка»: итог или «Не считать». */
export type GroupAggChoice = GroupAgg | 'none';

export function isNumericColumn(type: ListColumnType): boolean {
  return type === 'int' || type === 'money';
}

/**
 * Итог столбца в строке группы: у числовых — выбор пользователя («Не считать» — нет итога), иначе
 * сумма (ТЗ: «сумма (по умолчанию)»; docs/deviations.md, п. 33, решение А — у всех числовых, прототип
 * поправят); у остальных итога нет.
 */
export function groupAggOf(type: ListColumnType, saved?: GroupAggChoice): GroupAgg | null {
  if (!isNumericColumn(type) || saved === 'none') return null;
  return saved ?? 'sum';
}

/**
 * «Группировать по этому столбцу» / «Убрать группировку по этому столбцу» в меню столбца (прототип
 * filterPop, `gf-grp`): столбец в группировке — уходит из неё; уровней меньше двух — становится
 * следующим; оба заняты — заменяет второй (`replaced`: «Не больше двух уровней — второй уровень
 * заменён»).
 */
export function toggleGroupLevel(
  group: readonly string[],
  key: string,
): { group: string[]; replaced: boolean } {
  if (group.includes(key)) return { group: group.filter((k) => k !== key), replaced: false };
  if (group.length < MAX_GROUP_LEVELS) return { group: [...group, key], replaced: false };
  return { group: [group[0]!, key], replaced: true };
}

/** Уровни из окна «Группировка» (прототип groupPop): без пустых и повторов, второй — только при первом. */
export function groupLevels(first: string, second: string): string[] {
  if (!first) return [];
  return second && second !== first ? [first, second] : [first];
}

/**
 * Группа сгруппированного списка (ТЗ «Группировка»: название, число записей, итоги; итоги считает
 * сервер): `key` — значение столбца строкой ('' — пусто; у момента — день по Бишкеку), `label` — как
 * на экране (null — «(Пусто)»), `aggs` — итоги числовых столбцов, `sub` — группы второго уровня.
 */
export interface ListGroup {
  key: string;
  label: string | null;
  count: number;
  aggs: Record<string, number | null>;
  sub?: ListGroup[];
}

/**
 * Сортировка по умолчанию во всех списках — от новых к старым по системному столбцу «Создано»
 * (ТЗ «Сортировка»; у расчётных списков без «Создано» своя, её задаёт список).
 */
export const DEFAULT_LIST_SORT: ListSort = { key: 'createdAt', dir: 'desc' };

/**
 * Настройки вида списка у пользователя (ТЗ «Настройки вида»; прототип gsave): вид «Таблица /
 * Карточки» — отдельно на ПК (`view`) и на телефоне (`phoneView`), плотность, ширина, показанные и скрытые столбцы (столбца нет ни там, ни там — он
 * появился позже, у него видимость по умолчанию), порядок, ширины в px, сортировка (null —
 * пользователь выключил сортировку, нет поля — по умолчанию), записей на странице, группировка
 * (до двух столбцов) и итоги групп (`agg`). У страницы модуля (`statsViewKey`) — только «Статистика»:
 * показана ли она на ПК (`stats`) и на телефоне (`phoneStats`). Схема для API — `ViewSettings` в
 * `@buhuchet/shared`.
 */
export interface GridViewSettings {
  group?: string[];
  agg?: Record<string, GroupAggChoice>;
  stats?: boolean;
  phoneStats?: boolean;
  view?: 'table' | 'cards';
  phoneView?: 'table' | 'cards';
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
 * Ключ «Статистики» модуля в настройках вида: плашки-итоги скрываются и показываются для каждого
 * пользователя и каждого модуля отдельно (ТЗ «Статистика модуля»).
 */
export type StatsViewKey = `stats.${MenuModuleId}`;

export function statsViewKey(moduleId: MenuModuleId): StatsViewKey {
  return `stats.${moduleId}`;
}

/** Ключ настроек вида, которые хранит сервер: список или «Статистика» модуля. */
export type ViewKey = GridKey | StatsViewKey;

export function isViewKey(value: string): value is ViewKey {
  if (isGridKey(value)) return true;
  return MENU_MODULE_IDS.some((id) => value === statsViewKey(id));
}

/**
 * Показана ли «Статистика» модуля: выбор пользователя на этом устройстве, иначе — на ПК показана, на
 * телефоне скрыта (ТЗ «По умолчанию статистика показана на ПК и скрыта на телефоне»).
 */
export function statsShown(settings: GridViewSettings, phone: boolean): boolean {
  return (phone ? settings.phoneStats : settings.stats) ?? !phone;
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
