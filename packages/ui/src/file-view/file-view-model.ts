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

/**
 * Ячейки листа, где есть искомое: [строка, столбец] по порядку строк. Скрытые строки и столбцы
 * не ищутся: их нет на экране, перейти к ним нельзя.
 */
export function sheetHits(sheet: SheetView, q: string): [number, number][] {
  const k = searchKey(q);
  if (!k) return [];
  const hidden = new Set(sheet.hiddenRows);
  const out: [number, number][] = [];
  sheet.rows.forEach((row, r) => {
    if (hidden.has(r)) return;
    row.forEach((cell, c) => {
      if (cell && (sheet.cols[c] ?? 1) > 0 && searchKey(cell.v).includes(k)) out.push([r, c]);
    });
  });
  return out;
}

/** Что рисовать в ячейке с учётом объединений: `span` у первой ячейки, `skip` — у закрытых ею. */
export interface MergeMap {
  span: Map<string, { rows: number; cols: number }>;
  skip: Set<string>;
}

export const cellKey = (r: number, c: number) => `${r}:${c}`;

/**
 * Ячеек под объединениями, которые окно отмечает, — не больше: мест листа в окне не больше
 * 200 000 (`SHEET_MAX_PLACES` домена).
 */
export const MERGE_SKIP_MAX = 200_000;

/**
 * Объединения листа (`drawn` — только по стольким строкам сверху). Объединения из разбора
 * не пересекаются и в пределах листа; здесь ещё общий предел отмеченных ячеек — главный поток
 * страницы не зависает и на чужой модели. Окно считает их один раз на лист.
 */
export function mergeMap(sheet: SheetView, drawn = Number.POSITIVE_INFINITY): MergeMap {
  const span = new Map<string, { rows: number; cols: number }>();
  const skip = new Set<string>();
  const hidden = new Set(sheet.hiddenRows);
  const visibleCol = (c: number) => (sheet.cols[c] ?? 1) > 0;
  // Строк ниже данных листа окно не рисует — и не просматривает.
  const last = Math.min(drawn, sheet.rows.length);
  for (const [r1, c1, r2full, c2] of sheet.merges) {
    if (r1 >= last) continue;
    const r2 = Math.min(r2full, last - 1);
    // Не поместилось в предел — пропущено только оно: следующие объединения листа на месте.
    if (skip.size + (r2 - r1 + 1) * (c2 - c1 + 1) > MERGE_SKIP_MAX) continue;
    let rows = 0;
    for (let r = r1; r <= r2; r++) if (!hidden.has(r)) rows++;
    let cols = 0;
    for (let c = c1; c <= c2; c++) if (visibleCol(c)) cols++;
    if (rows < 1 || cols < 1 || (rows === 1 && cols === 1 && r1 === r2full && c1 === c2)) continue;
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

/**
 * Ветки глубже — свёрнуты, пока их не развернули: глубокое дерево из чужого файла не раскладывается
 * целиком при открытии (у обычного XML столько уровней не бывает).
 */
export const XML_OPEN_DEPTH = 32;
/** Уровень узла по пути: корень «0» — 0. */
export const xmlDepth = (p: XmlPath) => p.split('-').length - 1;
/** Свёрнута ли ветка: по уровню, переключению пользователя (`toggled`) и найденному (`open`). */
export const xmlClosed = (p: XmlPath, toggled: ReadonlySet<XmlPath>, open: ReadonlySet<XmlPath>) =>
  !open.has(p) && xmlDepth(p) >= XML_OPEN_DEPTH !== toggled.has(p);

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

/**
 * Текст на экране — кусками не длиннее: каждый кусок — свой текстовый узел. Один длинный кусок
 * браузер раскладывает тем дольше, чем чаще в нём меняется шрифт (кириллица и пробел сайта — из
 * разных частей шрифта; эмодзи и чужая письменность — всегда), время растёт как «смены × строки».
 */
export const TEXT_CHUNK = 128;

/** Пробел или табуляция — место, где браузер и сам переносит строку. */
function firstGap(s: string): number {
  const space = s.indexOf(' ');
  const tab = s.indexOf('\t');
  return space < 0 ? tab : tab < 0 ? space : Math.min(space, tab);
}

const lastGap = (s: string): number => Math.max(s.lastIndexOf(' '), s.lastIndexOf('\t'));

/**
 * Текст кусками до `max` знаков: режется после пробела (или табуляции), а без пробела — по пределу,
 * но не внутри пары UTF-16. После куска, отрезанного по пределу, идёт длинное «слово»: следующий
 * кусок кончается на его первом пробеле. Пробел ищется только в своём куске: поиск назад по всей
 * строке на тексте без пробелов — квадрат от длины (2 млн знаков — секунды на каждую перерисовку).
 */
export function textChunks(text: string, max = TEXT_CHUNK): string | string[] {
  if (text.length <= max) return text;
  const out: string[] = [];
  let from = 0;
  let word = false;
  while (from < text.length) {
    const piece = text.slice(from, from + max);
    const gap = word ? firstGap(piece) : lastGap(piece);
    let cut: number;
    if (word && gap >= 0) {
      cut = from + gap + 1;
      word = false;
    } else if (text.length - from <= max) {
      cut = text.length;
      word = false;
    } else if (gap >= 0) {
      cut = from + gap + 1;
    } else {
      cut = from + max;
      const last = text.charCodeAt(cut - 1);
      if (last >= 0xd800 && last <= 0xdbff && cut - 1 > from) cut--;
      word = true;
    }
    out.push(text.slice(from, cut));
    from = cut;
  }
  return out;
}

/** Кусок отрезан по пределу, а не по пробелу. */
function cutByLimit(parts: readonly string[], i: number): boolean {
  const part = parts[i] ?? '';
  return i >= 0 && i < parts.length - 1 && !part.endsWith(' ') && !part.endsWith('\t');
}

/**
 * Кусок из `textChunks` — часть длинного «слова»: он сам отрезан по пределу или продолжает такой
 * кусок. Ему нужен перенос по любому знаку (`break-all`): слово без мест переноса браузер переносит
 * по `overflow-wrap` за квадрат от длины (2 млн русских букв подряд — около минуты одним кадром).
 */
export function chunkOfLongWord(parts: readonly string[], i: number): boolean {
  return cutByLimit(parts, i) || cutByLimit(parts, i - 1);
}

/**
 * Куски текста одного абзаца (Word, слайд), по которым идёт «слово» длиннее `max` знаков: соседние
 * куски без пробела между ними для браузера — одно слово, как бы коротки они ни были. Таким кускам
 * тоже нужен перенос по любому знаку. Картинка в строке — место переноса: вместо неё — пробел.
 */
export function longWordRuns(texts: readonly string[], max = TEXT_CHUNK): Set<number> {
  const out = new Set<number>();
  let start = 0;
  let streak = 0;
  let marked = 0;
  texts.forEach((t, i) => {
    const first = firstGap(t);
    // Сколько знаков слова в этом куске; кусок, начатый с пробела, в слово не входит.
    const reach = first < 0 ? t.length : first;
    const to = reach > 0 ? i : i - 1;
    if (to > start && streak + reach > max) {
      for (let k = Math.max(start, marked); k <= to; k++) out.add(k);
      marked = to + 1;
    }
    if (first < 0) streak += t.length;
    else {
      start = i;
      streak = t.length - lastGap(t) - 1;
    }
  });
  return out;
}

/**
 * Шрифт содержимого файла (лист, бумага документа, слайд) — системный, без шрифта сайта: тот
 * подключён частями, и русский текст менял бы шрифт на каждом пробеле.
 */
export const FILE_FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

/** Знаков ячейки листа на экране — не больше (как Excel); полный текст — в подсказке. */
export const SHEET_CELL_SHOW = 1_024;
export const sheetCellText = (v: string) =>
  v.length > SHEET_CELL_SHOW ? v.slice(0, SHEET_CELL_SHOW) : v;
/** Высота ячейки с переносом — не больше, px (предел высоты строки Excel — 409 пт). */
export const SHEET_WRAP_MAX_PX = 545;

/**
 * Шаг отрисовки листа (дальше — по прокрутке или к найденному, следующей задачей): видимых строк —
 * до `SHEET_RENDER_STEP`, мест «строки × видимые столбцы» — до `SHEET_STEP_PLACES`, знаков
 * на экране — до `SHEET_STEP_CHARS`. Так и большой, и широкий лист открывается сразу.
 */
export const SHEET_RENDER_STEP = 300;
export const SHEET_STEP_PLACES = 25_000;
export const SHEET_STEP_CHARS = 200_000;

/**
 * До какой строки (не включая) рисовать шаг, начатый со строки `from`; `width` — видимых столбцов.
 * В шаге — хоть одна видимая строка, если она ещё есть: рисование всегда идёт вперёд.
 */
export function sheetStepEnd(
  sheet: SheetView,
  from: number,
  width: number,
  hidden: ReadonlySet<number>,
): number {
  let rows = 0;
  let places = 0;
  let chars = 0;
  let r = from;
  for (; r < sheet.rows.length; r++) {
    if (hidden.has(r)) continue;
    let size = 0;
    for (const cell of sheet.rows[r]!) if (cell) size += Math.min(cell.v.length, SHEET_CELL_SHOW);
    if (
      rows > 0 &&
      (rows >= SHEET_RENDER_STEP ||
        places + width > SHEET_STEP_PLACES ||
        chars + size > SHEET_STEP_CHARS)
    )
      break;
    rows++;
    places += width;
    chars += size;
  }
  return r;
}

/** Найденные ячейки по строкам: строка → столбцы (строке без найденного — ничего). */
export function hitsByRow(hits: readonly [number, number][]): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const [r, c] of hits) {
    let s = m.get(r);
    if (!s) m.set(r, (s = new Set()));
    s.add(c);
  }
  return m;
}
