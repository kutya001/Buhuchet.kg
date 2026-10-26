import {
  formatSom,
  groupAggOf,
  isNumericColumn,
  MAX_GROUP_LEVELS,
  type GridViewSettings,
  type GroupAgg,
  type ListColumnType,
  type ListGroup,
} from '@buhuchet/domain';

/**
 * Правила группировки (прототип ui/grid.js: `gcols`, `groupTree`, `aggOf`, `aggTxt`, строка группы в
 * tableHtml) — чистые функции. Группы, число записей и итоги считает сервер; список раскладывает
 * пришедшие строки по группам и помнит, какие группы свёрнуты.
 */

/** Столбцы группировки: из настроек вида, только существующие, без повторов, не больше двух. */
export function effectiveGroup(keys: readonly string[], settings: GridViewSettings): string[] {
  const group = (settings.group ?? []).filter(
    (k, i, all) => keys.includes(k) && all.indexOf(k) === i,
  );
  return group.slice(0, MAX_GROUP_LEVELS);
}

/** Группировка в настройках вида; пустая — поле убирается, как будто её не выбирали. */
export function withGroup(settings: GridViewSettings, group: readonly string[]): GridViewSettings {
  const next = { ...settings };
  if (group.length) next.group = [...group];
  else delete next.group;
  return next;
}

/**
 * Итоги в строке группы, которые считает сервер: у видимых числовых столбцов — выбор пользователя или
 * сумма по умолчанию (`groupAggOf`); «Не считать» — без итога.
 */
export function groupAggs(
  columns: readonly { key: string; type: ListColumnType }[],
  visible: readonly string[],
  settings: GridViewSettings,
): Record<string, GroupAgg> {
  const aggs: Record<string, GroupAgg> = {};
  for (const c of columns) {
    if (!visible.includes(c.key) || !isNumericColumn(c.type)) continue;
    const how = groupAggOf(c.type, settings.agg?.[c.key]);
    if (how) aggs[c.key] = how;
  }
  return aggs;
}

/** Группа на экране: путь (`›ключ` и `›ключ›ключ`) — для сворачивания, строки страницы — внутри. */
export interface GroupNode<Row> {
  path: string;
  level: number;
  group: ListGroup;
  rows: Row[];
  sub?: GroupNode<Row>[];
}

/**
 * Дерево групп для показа: группы с сервера по порядку, строки страницы — по ключам групп строки
 * (`rowGroups`); у двухуровневой группировки строки лежат во вложенных группах.
 */
export function groupTree<Row>(
  groups: readonly ListGroup[],
  rows: readonly Row[],
  rowGroups: readonly (readonly string[])[],
): GroupNode<Row>[] {
  const byPath = new Map<string, Row[]>();
  rows.forEach((row, i) => {
    const keys = rowGroups[i] ?? [];
    const path = keys.map((k) => `›${k}`).join('');
    const list = byPath.get(path) ?? [];
    list.push(row);
    byPath.set(path, list);
  });
  const build = (list: readonly ListGroup[], level: number, parent: string): GroupNode<Row>[] =>
    list.map((group) => {
      const path = `${parent}›${group.key}`;
      const node: GroupNode<Row> = { path, level, group, rows: byPath.get(path) ?? [] };
      if (group.sub) node.sub = build(group.sub, level + 1, path);
      return node;
    });
  return build(groups, 0, '');
}

/** Пути всех групп — «Свернуть все». */
export function groupPaths<Row>(tree: readonly GroupNode<Row>[]): string[] {
  return tree.flatMap((n) => [n.path, ...(n.sub ? groupPaths(n.sub) : [])]);
}

/**
 * Итог группы строкой (прототип `aggTxt`): количество и итоги счётчика — целым числом, деньги и
 * среднее — с копейками «1 250,50»; итога нет — «—».
 */
export function aggText(type: ListColumnType, how: GroupAgg, value: number | null): string {
  if (value === null) return '—';
  if (how === 'count' || (type === 'int' && how !== 'avg')) return String(Math.round(value));
  if (type === 'money') return formatSom(Math.round(value));
  return formatSom(Math.round(value * 100));
}

/**
 * Сколько первых столбцов занимает название группы (прототип: до первого числового столбца, хотя бы
 * один): итоги числовых столбцов стоят под своими столбцами.
 */
export function groupLabelSpan(columns: readonly { type: ListColumnType }[]): number {
  const first = columns.findIndex((c) => isNumericColumn(c.type));
  return Math.max(1, first < 0 ? columns.length : first);
}
