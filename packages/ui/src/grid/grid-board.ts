import type { GridViewSettings, ListGroup } from '@buhuchet/domain';
import { effectiveView } from './grid-state';

/**
 * Правила вида «Доска» (канбан; прототип ui/grid.js: `kbKeys`, `kbCol`, `kanbanHtml`, `kbMove`) —
 * чистые функции. Столбцы доски — значения выбранного столбца списка: их, число записей и суммы
 * считает сервер тем же запросом, что и группировку (один уровень); список раскладывает пришедшие
 * записи по столбцам доски.
 */

/** Больше столбцов доска не рисует — просит сузить список (прототип `KB_COLS`). */
export const BOARD_COLUMNS_MAX = 60;
/** В столбце — первые 30 карточек и «Показать ещё» по 30 (прототип `KB_STEP`). */
export const BOARD_STEP = 30;
/** На карточке доски — заголовок и первые пять видимых полей. */
export const BOARD_CARD_FIELDS = 5;
/**
 * Тип данных перетаскиваемой карточки: свой, чтобы идентификатор записи не вставлялся текстом в
 * чужое окно или поле ввода. Сам перенос идёт по состоянию списка, эти данные никто не читает.
 */
export const BOARD_DRAG_TYPE = 'application/x-buhuchet-card';

/** Значение столбца списка, ставшее столбцом доски: ключ группы на сервере и подпись как на экране. */
export interface BoardValue {
  key: string;
  label: string;
}

/**
 * Доска списка (прототип `cfg.kanban`): по каким столбцам списка можно разложить записи, порядок
 * столбцов доски, столбцы, которые видны и пустыми, и перенос карточки в другой столбец.
 */
export interface GridKanban<Row> {
  /** Ключи столбцов списка для «Столбцы: …» — по порядку меню. */
  by: readonly string[];
  /** Столбец по умолчанию. */
  def: string;
  /** Порядок столбцов доски: значения (ключи групп) по порядку; остальные — после них. */
  order?: Readonly<Record<string, readonly string[]>>;
  /** Столбцы доски, которые видны и без записей (статусы, сотрудники). */
  show?: Readonly<Record<string, readonly BoardValue[]>>;
  /**
   * Значения, которые на доске — один столбец: ключ группы с сервера → ключ столбца доски («В работе»
   * у ручной задачи и у отчёта регулярной — один столбец, как в прототипе, где столбец — подпись).
   */
  merge?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Перенос карточки в другой столбец — то же, что действие в меню записи: те же права и окна.
   * Нет — доска только для просмотра (карточки не перетаскиваются, пункта «Перенести…» нет).
   */
  drop?: (row: Row, key: string, to: BoardValue) => void;
}

/** Выбор столбца доски: возможные столбцы списка и столбец по умолчанию. */
export type BoardChoice = Pick<GridKanban<unknown>, 'by' | 'def'>;

/** Столбцы списка, по которым можно разложить доску: только существующие, без повторов. */
export function boardKeys(kanban: BoardChoice, keys: readonly string[]): string[] {
  return kanban.by.filter((k, i, all) => keys.includes(k) && all.indexOf(k) === i);
}

/**
 * Столбец доски: выбор пользователя, иначе по умолчанию, иначе первый из возможных (прототип
 * `kbCol`); null — раскладывать не по чему.
 */
export function boardKey(
  kanban: BoardChoice,
  keys: readonly string[],
  settings: GridViewSettings,
): string | null {
  const allowed = boardKeys(kanban, keys);
  if (settings.kb && allowed.includes(settings.kb)) return settings.kb;
  if (allowed.includes(kanban.def)) return kanban.def;
  return allowed[0] ?? null;
}

/**
 * Столбец, по которому список сейчас разложен доской: вид на этом устройстве — «Доска» и есть по
 * чему раскладывать; иначе null (таблица или карточки). По нему же список просит у сервера группы.
 */
export function activeBoardKey(
  kanban: BoardChoice | undefined,
  keys: readonly string[],
  settings: GridViewSettings,
  phone: boolean,
  fixed?: 'table' | 'cards',
): string | null {
  if (!kanban) return null;
  const key = boardKey(kanban, keys, settings);
  return key !== null && effectiveView(settings, phone, fixed, true) === 'kanban' ? key : null;
}

/** Столбец доски на экране. */
export interface BoardColumn<Row> {
  key: string;
  /** null — «(Пусто)». */
  label: string | null;
  /** Записей по всему отфильтрованному списку (считает сервер). */
  count: number;
  /** Итоги столбца с сервера (сумма «К уплате»). */
  aggs: Readonly<Record<string, number | null>>;
  /** Пришедшие записи столбца — по порядку списка. */
  rows: Row[];
}

/**
 * Столбцы доски (прототип `kanbanHtml`): группы первого уровня с сервера и их записи; к ним — столбцы,
 * которые видны и пустыми (кроме поиска и значений, снятых фильтром этого столбца); порядок — как
 * задан доской, остальные — по подписи, «(Пусто)» — последним. Слитые значения (`merge`) — один столбец: число записей и суммы складываются. `cut` —
 * сколько столбцов всего, если показаны не все.
 */
export function boardColumns<Row>(options: {
  groups: readonly ListGroup[];
  rows: readonly Row[];
  rowGroups: readonly (readonly string[])[];
  order?: readonly string[];
  show?: readonly BoardValue[];
  /** Группы сервера, которые на доске — один столбец: ключ группы → ключ столбца. */
  merge?: Readonly<Record<string, string>>;
  /** Идёт поиск: пустые столбцы не добавляются. */
  searching?: boolean;
  /** Значение проходит фильтр столбца доски; нет фильтра — не передаётся. */
  allowed?: (value: BoardValue) => boolean;
}): { columns: BoardColumn<Row>[]; cut: number } {
  const { groups, rows, rowGroups, order = [], show = [], searching = false, allowed } = options;
  const merge = options.merge;
  // Ключ группы приходит с сервера: читаем только собственные свойства (не `constructor` и подобные).
  const keyOf = (key: string) => (merge && Object.hasOwn(merge, key) ? merge[key]! : key);
  const byKey = new Map<string, BoardColumn<Row>>();
  for (const g of groups) {
    const key = keyOf(g.key);
    const had = byKey.get(key);
    if (had) {
      had.count += g.count;
      had.aggs = sumAggs(had.aggs, g.aggs);
    } else {
      byKey.set(key, { key, label: g.label, count: g.count, aggs: g.aggs, rows: [] });
    }
  }
  rows.forEach((row, i) => byKey.get(keyOf(rowGroups[i]?.[0] ?? ''))?.rows.push(row));
  if (!searching) {
    for (const v of show) {
      if (byKey.has(v.key) || (allowed && !allowed(v))) continue;
      byKey.set(v.key, { key: v.key, label: v.label, count: 0, aggs: {}, rows: [] });
    }
  }
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const place = (key: string) => {
    const at = order.indexOf(key);
    return at < 0 ? order.length : at;
  };
  // Как в прототипе: заданный порядок, остальные — по подписи, «(Пусто)» — последним.
  const sorted = [...byKey.values()].sort(
    (a, b) =>
      place(a.key) - place(b.key) ||
      (a.key === '' ? 1 : b.key === '' ? -1 : collator.compare(a.label ?? '', b.label ?? '')),
  );
  const cut = sorted.length > BOARD_COLUMNS_MAX ? sorted.length : 0;
  return { columns: cut ? sorted.slice(0, BOARD_COLUMNS_MAX) : sorted, cut };
}

/** Итоги слитых столбцов: суммы складываются; итога нет у обоих — нет и у столбца. */
function sumAggs(
  a: Readonly<Record<string, number | null>>,
  b: Readonly<Record<string, number | null>>,
): Record<string, number | null> {
  const sum: Record<string, number | null> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const had = sum[key] ?? null;
    sum[key] = had === null && value === null ? null : (had ?? 0) + (value ?? 0);
  }
  return sum;
}

/** Сколько карточек столбца показано: первые 30 и по 30 за каждое «Показать ещё». */
export function boardLimit(more: Readonly<Record<string, number>>, key: string): number {
  return Object.hasOwn(more, key) ? more[key]! : BOARD_STEP;
}

/** «Показать ещё N из M»: сколько откроет нажатие и сколько карточек ещё не показано. */
export function boardMore(loaded: number, limit: number): { next: number; left: number } | null {
  const left = loaded - limit;
  return left > 0 ? { next: Math.min(BOARD_STEP, left), left } : null;
}

/** Столбцы, в которые карточку можно перенести: все, кроме её собственного. */
export function boardTargets<Row>(
  columns: readonly BoardColumn<Row>[],
  current: string,
): BoardColumn<Row>[] {
  return columns.filter((c) => c.key !== current);
}
