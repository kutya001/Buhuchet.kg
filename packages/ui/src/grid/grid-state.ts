import {
  DEFAULT_PAGE_SIZE,
  nextSort,
  type GridViewSettings,
  type ListPageSize,
  type ListSort,
} from '@buhuchet/domain';

/**
 * Правила вида списка (прототип ui/grid.js: `cols`, `vis`, `defHidden`, `colsPop`, сортировка по
 * заголовку, перетаскивание и ширина столбцов) — чистые функции над настройками вида пользователя
 * (`GridViewSettings`). Экран хранит настройки на сервере и передаёт их списку пропсом.
 */

/** Ширина столбца: перетаскиванием границы — не уже 70 px (прототип `Math.max(70, …)`). */
export const MIN_COLUMN_WIDTH = 70;
export const MAX_COLUMN_WIDTH = 1200;
export const DEFAULT_COLUMN_WIDTH = 140;

export interface ColumnShape {
  key: string;
  width?: number;
}

/**
 * Порядок столбцов: сохранённый порядок пользователя; столбец, которого в нём нет (появился позже), —
 * на своё место по умолчанию (прототип `cols()`).
 */
export function orderedKeys(keys: readonly string[], saved?: readonly string[]): string[] {
  const order = (saved ?? []).filter((k, i, all) => keys.includes(k) && all.indexOf(k) === i);
  keys.forEach((k, i) => {
    if (!order.includes(k)) order.splice(i, 0, k);
  });
  return order;
}

/**
 * Скрыт ли столбец: явный выбор пользователя, иначе — видимость по умолчанию (ТЗ «по умолчанию
 * видны только основные столбцы, остальные скрыты и включаются в меню «Столбцы»»).
 */
export function isHidden(
  key: string,
  settings: GridViewSettings,
  defaultVisible: readonly string[],
): boolean {
  if (settings.hidden?.includes(key)) return true;
  if (settings.shown?.includes(key)) return false;
  return !defaultVisible.includes(key);
}

/** Видимые столбцы по порядку; если скрыты все — первый (прототип `vis()`). */
export function visibleKeys(
  keys: readonly string[],
  settings: GridViewSettings,
  defaultVisible: readonly string[],
): string[] {
  const ordered = orderedKeys(keys, settings.order);
  const visible = ordered.filter((k) => !isHidden(k, settings, defaultVisible));
  return visible.length ? visible : ordered.slice(0, 1);
}

/**
 * Показать или скрыть столбец в меню «Столбцы»; последний видимый скрыть нельзя. Сохраняется выбор
 * по всем столбцам списка — столбец, добавленный позже, получит видимость по умолчанию.
 */
export function setColumnVisible(
  keys: readonly string[],
  settings: GridViewSettings,
  defaultVisible: readonly string[],
  key: string,
  visible: boolean,
): GridViewSettings {
  if (!keys.includes(key)) return settings;
  const current = new Set(visibleKeys(keys, settings, defaultVisible));
  if (visible) current.add(key);
  else if (current.has(key) && current.size === 1) return settings;
  else current.delete(key);
  return {
    ...settings,
    shown: keys.filter((k) => current.has(k)),
    hidden: keys.filter((k) => !current.has(k)),
  };
}

/**
 * Столбец на место `to` в полном порядке: стрелки «Выше» / «Ниже» и перетаскивание строки в меню
 * «Столбцы» (прототип colsPop, `move`).
 */
export function moveColumn(
  keys: readonly string[],
  settings: GridViewSettings,
  key: string,
  to: number,
): GridViewSettings {
  const order = orderedKeys(keys, settings.order);
  const from = order.indexOf(key);
  const target = Math.max(0, Math.min(order.length - 1, to));
  if (from < 0 || target === from) return settings;
  order.splice(from, 1);
  order.splice(target, 0, key);
  return { ...settings, order };
}

/** Заголовок `key` перетащили на заголовок `onto`: встаёт перед ним (прототип `th.ondrop`). */
export function dropColumn(
  keys: readonly string[],
  settings: GridViewSettings,
  key: string,
  onto: string,
): GridViewSettings {
  if (key === onto) return settings;
  const order = orderedKeys(keys, settings.order);
  if (!order.includes(key) || !order.includes(onto)) return settings;
  order.splice(order.indexOf(key), 1);
  order.splice(order.indexOf(onto), 0, key);
  return { ...settings, order };
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

export function columnWidth(column: ColumnShape, settings: GridViewSettings): number {
  return settings.widths?.[column.key] ?? column.width ?? DEFAULT_COLUMN_WIDTH;
}

export function setColumnWidth(
  settings: GridViewSettings,
  key: string,
  width: number,
): GridViewSettings {
  return { ...settings, widths: { ...settings.widths, [key]: clampWidth(width) } };
}

/**
 * Сортировка списка: выбор пользователя (null — выключил), иначе по умолчанию; столбца сортировки
 * уже нет — по умолчанию.
 */
export function effectiveSort(
  settings: GridViewSettings,
  defaultSort: ListSort | null,
  keys: readonly string[],
): ListSort | null {
  const sort = settings.sort === undefined ? defaultSort : settings.sort;
  if (sort && !keys.includes(sort.key)) return defaultSort;
  return sort;
}

/** Клик по заголовку: по возрастанию → по убыванию → без сортировки; выбор запоминается. */
export function toggleSort(
  settings: GridViewSettings,
  defaultSort: ListSort | null,
  keys: readonly string[],
  key: string,
): GridViewSettings {
  return { ...settings, sort: nextSort(effectiveSort(settings, defaultSort, keys), key) };
}

export function pageSizeOf(settings: GridViewSettings): ListPageSize {
  return settings.size ?? DEFAULT_PAGE_SIZE;
}

/**
 * Вид списка: закреплённый модулем, выбранный пользователем или по умолчанию — «Таблица» на ПК,
 * «Карточки» на телефоне (ТЗ «Вид»). Выбор запоминается отдельно для ПК и телефона: таблица,
 * выбранная на ПК, не открывается на телефоне вместо карточек.
 */
export function effectiveView(
  settings: GridViewSettings,
  phone: boolean,
  fixed?: 'table' | 'cards',
): 'table' | 'cards' {
  return fixed ?? (phone ? settings.phoneView : settings.view) ?? (phone ? 'cards' : 'table');
}

/** Выбор «Таблица / Карточки» на этом устройстве (ПК или телефон). */
export function setView(
  settings: GridViewSettings,
  phone: boolean,
  view: 'table' | 'cards',
): GridViewSettings {
  return phone ? { ...settings, phoneView: view } : { ...settings, view };
}
