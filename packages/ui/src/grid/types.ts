import type { GroupAgg, ListColumnType, ListGroup } from '@buhuchet/domain';
import type { ReactNode } from 'react';
import type { IconName } from '../icons';

/**
 * Столбец списка (прототип ui/grid.js, `cfg.cols`): ключ — тот же, что у столбца на сервере (сортировка
 * и фильтры), подпись — из словаря. Значения уже приходят строкой для показа (`text`): деньги, даты и
 * телефоны форматирует экран.
 */
export interface GridColumn<Row> {
  key: string;
  label: string;
  type: ListColumnType;
  /** Ширина по умолчанию, px (`w` прототипа); без неё — 140. */
  width?: number;
  /** Значение строкой: подсказка ячейки, карточка, «—» для пустого. */
  text: (row: Row) => string;
  /** Своя разметка ячейки (метка, аватар); без неё — `text`. */
  cell?: (row: Row) => ReactNode;
  /** Классы ячейки, например моноширинный шрифт логина. */
  className?: string;
  /** Число справа (по умолчанию — у `int` и `money`). */
  numeric?: boolean;
  /** Служебный столбец «Создал», «Создано», «Изменил», «Изменено» (в меню «Столбцы» — «системный»). */
  audit?: 'created' | 'updated';
  /** Сортировка по заголовку; по умолчанию есть. */
  sortable?: boolean;
  /** Фильтр у заголовка (кнопка «Фильтр» и меню столбца); по умолчанию есть (`nofilter` прототипа). */
  filterable?: boolean;
  /** Итог столбца по фильтру из `totals` ответа сервера — строкой для показа. */
  total?: (value: number) => string;
}

/** Страница списка с сервера (`listPageSchema` в `@buhuchet/shared`). */
export interface GridPage<Row> {
  items: readonly Row[];
  total: number;
  page: number;
  totals: Readonly<Record<string, number>>;
  /** Сгруппированный список: группы по всем отфильтрованным записям (итоги считает сервер). */
  groups?: readonly ListGroup[];
  /** Ключи групп каждой строки страницы — по порядку `items`. */
  rowGroups?: readonly (readonly string[])[];
}

/**
 * Значения столбца для фильтра-галочек (`ListValues` в `@buhuchet/shared`): код, подпись как на
 * экране (null — «(Пусто)») и число записей; `more` — значений больше, чем пришло.
 */
export interface GridValues {
  items: readonly { value: string; label: string | null; count: number }[];
  more: boolean;
}

/**
 * Служебные столбцы «Создал», «Изменил», «Создано», «Изменено» (прототип `auditCols`): их добавляет
 * сам список, экран даёт только значения строкой. На сервере у списка — столбцы `createdBy`,
 * `updatedBy`, `createdAt`, `updatedAt`; «Изменил» без правок — тот, кто создал.
 */
export interface GridAudit<Row> {
  createdBy: (row: Row) => string;
  updatedBy: (row: Row) => string;
  createdAt: (row: Row) => string;
  updatedAt: (row: Row) => string;
}

/**
 * Массовое действие над отмеченными строками (прототип `cfg.bulk`, ТЗ «Действия над записью»):
 * кнопка на панели «Выбрано: N». `done()` снимает выбор, когда действие выполнено.
 */
export interface GridBulkAction<Row> {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  run: (rows: readonly Row[], done: () => void) => void;
}

/** Отмеченные строки списка с массовыми действиями (галочки в таблице и карточках). */
export interface GridRowSelection<Row> {
  has: (row: Row) => boolean;
  toggle: (row: Row, on: boolean) => void;
  /** Все строки страницы отмечены — галочка в заголовке стоит. */
  allOnPage: boolean;
  togglePage: (on: boolean) => void;
}

/** Подсветка строки (прототип `rowClass`): заблокированный — приглушённо, просроченный — красным. */
export type GridRowTone = 'muted' | 'overdue' | 'warn';

/** Тексты списка из словаря (компонент своих текстов не пишет). */
export interface GridLabels {
  /** «250 сотрудников». */
  count: (total: number) => string;
  /** Группа кнопок вида: «Вид списка». */
  view: string;
  table: string;
  cards: string;
  /** Кнопка вида на телефоне: «Вид списка: Карточки». */
  viewTo: (name: string) => string;
  /** «Столбцы». */
  columns: string;
  /** Пояснение в меню «Столбцы». */
  columnsHint: string;
  /** Метка служебного столбца: «системный». */
  system: string;
  moveUp: string;
  moveDown: string;
  /** Подсказка у ручки строки: «Перетащите, чтобы поменять порядок». */
  dragHint: string;
  /** Кнопка настроек вида: «Настройки вида», подсказка — «Плотность и ширина». */
  viewOptions: string;
  viewOptionsHint: string;
  densityNormal: string;
  densityCompact: string;
  widthFull: string;
  widthCenter: string;
  resetView: string;
  resetViewSub: string;
  /** Подсказка заголовка: «Сортировать: ФИО». */
  sortBy: (label: string) => string;
  columnWidth: string;
  /** Кнопка «⋯» и меню записи: «Действия». */
  actions: string;
  /** «Показано 1 – 25 из 250». */
  shown: (from: number, to: number, total: number) => string;
  perPage: string;
  allRows: string;
  prev: string;
  next: string;
  loadError: string;
  loadErrorText: string;
  retry: string;
  /** Строка итогов: «Итого по фильтру · 12». */
  totalByFilter: (count: number) => string;
  /** Панель массовых действий: «Выбрано: 3». */
  selected: (count: number) => string;
  clearSelection: string;
  selectAll: string;
  selectRow: string;
  /** Галочка карточки: «Выбрать». */
  selectCard: string;
  /** Подписи служебных столбцов. */
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Строка карточки: «Создал: Алишер Т., 12.03.2026 10:15». */
  createdLine: (text: string) => string;
  updatedLine: (text: string) => string;
  /** «Ничего не найдено»: заголовок, пояснение и «Сбросить фильтры». */
  notFound: string;
  notFoundText: string;
  resetFilters: string;
  /** Кнопка фильтра у заголовка: подсказка «Фильтр», для диктора — «Фильтр: ФИО». */
  filter: string;
  filterOf: (label: string) => string;
  filterContains: string;
  filterFrom: string;
  filterTo: string;
  filterBounds: string;
  filterSince: string;
  filterUntil: string;
  filterBadNumber: string;
  filterFind: string;
  filterAll: string;
  /** Пустое значение в фильтре, группе и чипе: «(Пусто)». */
  empty: string;
  filterLoading: string;
  filterLoadError: string;
  filterMore: (n: number) => string;
  clear: string;
  apply: string;
  groupByColumn: string;
  ungroupColumn: string;
  /** Уведомление: «Не больше двух уровней — второй уровень заменён». */
  groupReplaced: string;
  /** Кнопка «Группировка» и «Группировка (2)». */
  group: string;
  groupN: (n: number) => string;
  groupButtonHint: string;
  groupLevel1: string;
  groupLevel2: string;
  groupNone: string;
  groupAggs: string;
  groupHint: string;
  groupRemove: string;
  /** Итоги в строке группы: «Не считать», «Сумма», «Среднее», «Минимум», «Максимум», «Количество». */
  aggNone: string;
  agg: Readonly<Record<GroupAgg, string>>;
  /** Низ сгруппированного списка: «Групп: 4 · записей: 52». */
  groupsShown: (groups: number, total: number) => string;
  expandAll: string;
  collapseAll: string;
  /** Чипы над списком: «Группировка:», «Поиск:», «от 100», «до 200», «с 01.03.2026», «по …», «+3». */
  chipGroup: string;
  chipSearch: string;
  chipFrom: (v: string) => string;
  chipTo: (v: string) => string;
  chipSince: (v: string) => string;
  chipUntil: (v: string) => string;
  chipMore: (n: number) => string;
  ungroup: string;
  clearSearch: string;
  removeFilter: string;
  resetAll: string;
  /** «В Excel» и подсказка к ней. */
  excel: string;
  excelHint: string;
}
