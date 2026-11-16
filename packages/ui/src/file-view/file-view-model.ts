/**
 * Правила окна просмотра файлов (доработки 16.11.2026, блок 5; прототип v126 `ui/file-view.js`):
 * масштаб, листание жестом, поиск на листе и в XML, объединённые ячейки. Чистые функции — с тестами.
 */
import type { SheetView, XmlViewNode } from '@buhuchet/domain';
import { searchFold } from '../search-select';

/** Масштаб картинки: 25–400 %, шаг 25 % (прототип `data-fz`). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

export const zoomNext = (z: number, dir: 1 | -1) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + dir * ZOOM_STEP) * 100) / 100));

/** Поворот на 90° по часовой стрелке. */
export const rotateNext = (deg: number) => (deg + 90) % 360;

/** Жест вбок не короче 70 px и заметно больше, чем по вертикали (прототип: |dy| ≤ 0,6·|dx|). */
export const SWIPE_MIN_PX = 70;

/** Жест по просмотру: +1 — следующий, −1 — предыдущий, 0 — не жест листания. */
export function swipeDirection(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return 0;
  return dx < 0 ? 1 : -1;
}

/** Область сама прокручивается в сторону жеста — листать файлы не надо (прокрутка широкой таблицы). */
export function scrollsToward(
  el: { scrollWidth: number; clientWidth: number; scrollLeft: number },
  dir: 1 | -1,
): boolean {
  if (el.scrollWidth <= el.clientWidth + 2) return false;
  return dir > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 2 : el.scrollLeft > 2;
}

/** Строка поиска: без лишних пробелов, без учёта регистра и «ё/е». */
export const searchKey = (s: string) => searchFold(s.trim());

/** Ячейки листа, где есть искомое: [строка, столбец] по порядку строк. */
export function sheetHits(sheet: SheetView, q: string): [number, number][] {
  const k = searchKey(q);
  if (!k) return [];
  const out: [number, number][] = [];
  sheet.rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell && searchKey(cell.v).includes(k)) out.push([r, c]);
    }),
  );
  return out;
}

/** Что рисовать в ячейке с учётом объединений: `span` у первой ячейки, `skip` — у закрытых ею. */
export interface MergeMap {
  span: Map<string, { rows: number; cols: number }>;
  skip: Set<string>;
}

export const cellKey = (r: number, c: number) => `${r}:${c}`;

export function mergeMap(sheet: SheetView): MergeMap {
  const span = new Map<string, { rows: number; cols: number }>();
  const skip = new Set<string>();
  const hidden = new Set(sheet.hiddenRows);
  const visibleCol = (c: number) => (sheet.cols[c] ?? 1) > 0;
  for (const [r1, c1, r2, c2] of sheet.merges) {
    let rows = 0;
    for (let r = r1; r <= r2; r++) if (!hidden.has(r)) rows++;
    let cols = 0;
    for (let c = c1; c <= c2; c++) if (visibleCol(c)) cols++;
    if (rows < 1 || cols < 1 || (rows === 1 && cols === 1 && r1 === r2 && c1 === c2)) continue;
    span.set(cellKey(r1, c1), { rows, cols });
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) skip.add(cellKey(r, c));
  }
  return { span, skip };
}

/** Путь узла XML для сворачивания и поиска: «0», «0-2», «0-2-1». */
export type XmlPath = string;

/** Узлы XML, где есть искомое (имя, атрибуты или текст), и их предки — чтобы развернуть. */
export function xmlHits(root: XmlViewNode, q: string): { hits: Set<XmlPath>; open: Set<XmlPath> } {
  const k = searchKey(q);
  const hits = new Set<XmlPath>();
  const open = new Set<XmlPath>();
  if (!k) return { hits, open };
  const walk = (n: XmlViewNode, path: XmlPath, up: XmlPath[]) => {
    const own = [n.n, ...n.a.flat(), ...n.c.filter((x): x is string => typeof x === 'string')].join(
      ' ',
    );
    if (searchKey(own).includes(k)) {
      hits.add(path);
      for (const p of up) open.add(p);
    }
    n.c.forEach((x, i) => {
      if (typeof x !== 'string') walk(x, `${path}-${i}`, [...up, path]);
    });
  };
  walk(root, '0', []);
  return { hits, open };
}

/** Все пути веток (узлов с детьми-элементами) — для «Свернуть всё» (корень остаётся открытым). */
export function xmlBranches(root: XmlViewNode): XmlPath[] {
  const out: XmlPath[] = [];
  const walk = (n: XmlViewNode, path: XmlPath) => {
    if (n.c.some((x) => typeof x !== 'string')) {
      if (path !== '0') out.push(path);
      n.c.forEach((x, i) => {
        if (typeof x !== 'string') walk(x, `${path}-${i}`);
      });
    }
  };
  walk(root, '0');
  return out;
}

/** Строк листа рисуется за раз (дальше — по прокрутке), чтобы большой лист открывался сразу. */
export const SHEET_RENDER_STEP = 300;
/** Сколько строк листа нарисовать, чтобы строка `row` (с 0) была видна: кратно `SHEET_RENDER_STEP`. */
export const sheetRowsFor = (row: number) =>
  Math.ceil((row + 1) / SHEET_RENDER_STEP) * SHEET_RENDER_STEP;
