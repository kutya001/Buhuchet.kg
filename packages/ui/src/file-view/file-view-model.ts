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
  if (max < 1 || text.length <= max) return text;
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
 * кусок. Ему — перенос между любыми буквами (`break-all`), чтобы строки шли до края; место
 * переноса между кусками окно ставит само (`<wbr>`): знаки препинания `break-all` не разделяет.
 */
export function chunkOfLongWord(parts: readonly string[], i: number): boolean {
  return cutByLimit(parts, i) || cutByLimit(parts, i - 1);
}

/**
 * Знаков текста файла в одном блоке раскладки — не больше. Время раскладки одной строки или абзаца
 * растёт быстрее длины и зависит от содержимого (буквы со знаками между ними, чужая письменность,
 * один знак с тысячами надстрочных): 2 млн знаков одним абзацем — от секунд до минут. Поэтому
 * длинный текст делится на блоки: в каждом браузер раскладывает не больше этого, сколько бы ни
 * было всего и что бы в нём ни было.
 */
export const TEXT_SEGMENT = 8_192;

/**
 * Строк на экране под текст в `chars` знаков — оценка для места под блок, пока он не разложен
 * (`content-visibility`): по `TEXT_LINE_CHARS` знаков в строке, не меньше одной. Место растёт с
 * длиной текста, поэтому в кадр попадает столько блоков, сколько помещается в окно, а не сколько
 * их в файле: при месте в одну строку под блок в 8 000 знаков в первый кадр попадала сотня блоков.
 */
export const TEXT_LINE_CHARS = 100;

export function textLines(chars: number, perLine = TEXT_LINE_CHARS): number {
  return Math.max(1, Math.ceil(chars / Math.max(1, perLine)));
}

/**
 * Блок и строка в узком месте (ячейка таблицы документа шириной в долю `share` бумаги): знаков в
 * блоке и в строке — во столько же раз меньше, но блок — не короче куска текста (`TEXT_CHUNK`).
 * Соседние ячейки видны разом, и без этого в кадр попадало бы по целому блоку из каждого столбца.
 */
export const shareSegment = (share: number): number =>
  Math.max(TEXT_CHUNK, Math.floor(TEXT_SEGMENT * Math.min(1, share)));
export const shareLineChars = (share: number): number =>
  Math.max(1, Math.floor(TEXT_LINE_CHARS * Math.min(1, share)));

/**
 * Наименьшая высота блока с текстом — по числу знаков: строка на каждые `TEXT_MIN_LINE_CHARS`
 * знаков (в ячейке таблицы документа — по её доле ширины, но не меньше `TEXT_MIN_LINE_FLOOR`).
 * Текст из знаков без ширины (U+200E, U+200F, U+061C) после раскладки занимает одну строку,
 * сколько бы знаков в нём ни было: браузер запоминал такую высоту, и при возврате к этому месту
 * в кадр попадала сотня блоков — миллион знаков, 5–6 с. Обычный текст эту высоту не замечает:
 * тысяча знаков в строку не помещается ни на каком экране.
 */
export const TEXT_MIN_LINE_CHARS = 1_000;
export const TEXT_MIN_LINE_FLOOR = 4;
export const shareMinLineChars = (share: number): number =>
  Math.max(TEXT_MIN_LINE_FLOOR, Math.floor(TEXT_MIN_LINE_CHARS * Math.min(1, share)));

/** Строк наименьшей высоты блока в `chars` знаков; 0 — блоку она не нужна (текст в одну строку). */
export function textMinLines(chars: number, perLine = TEXT_MIN_LINE_CHARS): number {
  return chars > perLine ? Math.ceil(chars / perLine) : 0;
}

/**
 * Строк места под блок — не больше: абзац на 2 млн знаков в узкой ячейке просил место в 38 млн px —
 * больше, чем браузер умеет прокручивать.
 */
export const LAZY_MAX_LINES = 50_000;

/** Столбец таблицы документа на экране — не уже, px: таблица шире бумаги прокручивается вбок. */
export const DOC_COL_MIN_PX = 56;

/**
 * Доли ширины столбцов таблицы документа: по ширинам из файла, но столбец — не уже половины равной
 * доли (иначе узкий «№» на телефоне не читается, а столбец шириной 1 из файла не виден вовсе).
 */
export function docColShares(cols: readonly number[]): number[] {
  const width = (w: number) => (Number.isFinite(w) && w > 0 ? w : 0);
  const total = cols.reduce((a, w) => a + width(w), 0);
  if (!(total > 0)) return cols.map(() => 1 / cols.length);
  const least = total / cols.length / 2;
  const raised = cols.map((w) => Math.max(width(w), least));
  const sum = raised.reduce((a, w) => a + w, 0);
  return raised.map((w) => w / sum);
}

/**
 * Доля ширины таблицы документа у каждой её ячейки (по строкам): ячейка встаёт в первый столбец,
 * не занятый объединением по вертикали сверху, как в таблице HTML; `shares` — доли столбцов.
 */
export function docCellShares(
  shares: readonly number[],
  rows: readonly (readonly { span?: number; rowSpan?: number }[])[],
): number[][] {
  // До какой строки (не включая) занят столбец объединением сверху.
  const busy = new Array<number>(shares.length).fill(0);
  return rows.map((row, ri) => {
    let col = 0;
    return row.map((cell) => {
      while (col < shares.length && busy[col]! > ri) col++;
      const end = Math.min(shares.length, col + (cell.span ?? 1));
      const until = ri + (cell.rowSpan ?? 1);
      let w = 0;
      for (let c = col; c < end; c++) {
        busy[c] = Math.max(busy[c]!, until);
        w += shares[c]!;
      }
      col = Math.max(col, end);
      return w;
    });
  });
}

/**
 * Куски подряд — блоками до `seg` знаков: номера кусков, с которых начинается блок (первый — 0).
 * Кусок длиннее `seg` — один в блоке (его делит на блоки тот, кто его рисует).
 */
export function segmentStarts(lengths: readonly number[], seg = TEXT_SEGMENT): number[] {
  const starts = [0];
  let sum = 0;
  lengths.forEach((n, i) => {
    if (i > 0 && sum + n > seg) {
      starts.push(i);
      sum = 0;
    }
    sum += n;
  });
  return starts;
}

/**
 * Шрифт содержимого файла (лист, бумага документа, слайд) — системный, без шрифта сайта: тот
 * подключён частями, и русский текст менял бы шрифт на каждом пробеле.
 */
export const FILE_FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

/** Знаков ячейки листа на экране — не больше (как Excel); полный текст — в подсказке. */
export const SHEET_CELL_SHOW = 1_024;
export const sheetCellText = (v: string, show = SHEET_CELL_SHOW) =>
  v.length > show ? v.slice(0, show) : v;
/** Высота ячейки с переносом — не больше, px (предел высоты строки Excel — 409 пт). */
export const SHEET_WRAP_MAX_PX = 545;

/** Самый узкий знак на листе (точка, «i», «l» при 12,5 px) — не уже, px; строка ячейки — не ниже. */
export const SHEET_GLYPH_MIN_PX = 3;
export const SHEET_LINE_PX = 16;

/**
 * Сколько знаков ячейки шириной `width` px может быть видно: без переноса — одна строка до края
 * ячейки, с переносом — строки до `SHEET_WRAP_MAX_PX`. Остальное на экране не видно, и раскладывать
 * его незачем; полный текст — в подсказке.
 */
export function sheetCellFit(width: number, wrap: boolean): number {
  const line = Math.floor(Math.max(0, width) / SHEET_GLYPH_MIN_PX) + 2;
  const lines = wrap ? Math.ceil(SHEET_WRAP_MAX_PX / SHEET_LINE_PX) : 1;
  return Math.min(SHEET_CELL_SHOW, line * lines);
}

/**
 * Знаков одной строки листа на экране — не больше: строку браузер раскладывает за один кадр, а в
 * ней до 256 ячеек по 1 024 знака. В строке длиннее ячейки показывают поровну (`sheetRowPlan`).
 */
export const SHEET_ROW_CHARS = 16_384;
/**
 * Строка листа с текстом длиннее — «тяжёлая»: её ячейки браузер раскладывает, только когда они у
 * экрана (и по горизонтали), иначе экран таких строк — это десятки кадров по секунде.
 */
export const SHEET_ROW_LAZY = 2_048;

export interface SheetRowPlan {
  /** Сколько знаков показывает ячейка столбца (по номеру столбца листа). */
  show: number[];
  /** Ячейки строки раскладываются у экрана. */
  lazy: boolean;
}

/** Что показывает строка листа; `widthOf(c)` — ширина ячейки столбца `c` на экране, px. */
export function sheetRowPlan(
  row: SheetView['rows'][number],
  widthOf: (c: number) => number,
): SheetRowPlan {
  let size = 0;
  let filled = 0;
  const show = row.map((cell, c) => {
    if (!cell || !cell.v) return 0;
    const n = Math.min(cell.v.length, sheetCellFit(widthOf(c), cell.wrap === true));
    filled++;
    size += n;
    return n;
  });
  if (size <= SHEET_ROW_CHARS) return { show, lazy: size > SHEET_ROW_LAZY };
  const each = Math.max(1, Math.floor(SHEET_ROW_CHARS / filled));
  return { show: show.map((n) => Math.min(n, each)), lazy: true };
}

/** Высота места под ячейку с переносом, пока она не разложена: по числу знаков и ширине, px. */
export function sheetWrapPx(chars: number, width: number): number {
  const perLine = Math.max(1, Math.floor((width - 14) / 7));
  return Math.min(SHEET_WRAP_MAX_PX, Math.max(1, Math.ceil(chars / perLine)) * SHEET_LINE_PX);
}

/**
 * Наименьшая высота ячейки с переносом из «тяжёлой» строки, px: строка на каждые столько знаков,
 * сколько самых узких помещается в ширину ячейки (как в `sheetCellFit`); 0 — не нужна. Ячейка из
 * знаков без ширины иначе сжимается в одну строку, и экран таких строк — миллион знаков за кадр.
 * Обычный текст выше этого всегда.
 */
export function sheetWrapMinPx(chars: number, width: number): number {
  const line = Math.floor(Math.max(0, width) / SHEET_GLYPH_MIN_PX) + 2;
  const lines = Math.ceil(chars / line);
  return lines > 1 ? Math.min(SHEET_WRAP_MAX_PX, lines * SHEET_LINE_PX) : 0;
}

/**
 * Шаг отрисовки листа (дальше — по прокрутке или к найденному, следующей задачей): видимых строк —
 * до `SHEET_RENDER_STEP`, мест «строки × видимые столбцы» — до `SHEET_STEP_PLACES`, знаков
 * на экране — до `SHEET_STEP_CHARS` (столько браузер раскладывает за кадр и на тексте, где шрифт
 * меняется на каждом знаке). Так и большой, и широкий лист открывается сразу.
 */
export const SHEET_RENDER_STEP = 300;
export const SHEET_STEP_PLACES = 25_000;
export const SHEET_STEP_CHARS = 16_384;

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
    size = Math.min(size, SHEET_ROW_CHARS);
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
