import type { ListColumnType } from '@buhuchet/domain';
import type { ReactNode } from 'react';

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
  /** Итог столбца по фильтру из `totals` ответа сервера — строкой для показа. */
  total?: (value: number) => string;
}

/** Страница списка с сервера (`listPageSchema` в `@buhuchet/shared`). */
export interface GridPage<Row> {
  items: readonly Row[];
  total: number;
  page: number;
  totals: Readonly<Record<string, number>>;
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
  /** Строка карточки: «Создал: Алишер Т., 12.03.2026 10:15». */
  createdLine: (text: string) => string;
  updatedLine: (text: string) => string;
}
