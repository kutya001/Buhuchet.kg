/**
 * Документ Word (DOCX) в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): текст с
 * заголовками, списками, таблицами и картинками, без разбивки на страницы. Ссылки показываются
 * текстом (не открываются), внешние картинки и связанные файлы не загружаются, макросы не читаются.
 */
import { emuToPx, ImageBag, readRels, type Rel, type ViewImage } from './ooxml';
import {
  attrOf,
  childEl,
  childEls,
  findEl,
  localName,
  parseXmlTree,
  prefixedAttr,
  ViewError,
  type XEl,
} from './xml';
import type { Zip } from './zip';

/** Абзацев и таблиц документа в окне — не больше. */
export const DOC_MAX_BLOCKS = 10_000;
/** Кусков текста и картинок во всех абзацах — не больше: окно рисует каждый. */
export const DOC_MAX_RUNS = 200_000;
/** Номер начала списка — не больше. */
export const DOC_MAX_LIST_START = 100_000;
/** Шаблон номера списка из файла длиннее (предел Word) — не берётся; номер пункта — до 64 знаков. */
export const DOC_MAX_LIST_TEMPLATE = 255;
export const DOC_MAX_LABEL = 64;
/**
 * Знаков текста во всём документе — не больше (как у текстового файла): окно раскладывает документ
 * целиком.
 */
export const DOC_MAX_CHARS = 2_000_000;
/**
 * Знаков текста в одной таблице документа (со вложенными) — не больше: таблицу окно раскладывает
 * целиком, по частям её не разложить. Остальные строки таблицы не показываются.
 */
export const DOC_MAX_TABLE_CHARS = 500_000;
/** Перенос строки `<w:br/>` в счёте знаков документа — как строка в 64 знака. */
export const DOC_BREAK_CHARS = 64;
/**
 * Строк и ячеек всех таблиц документа вместе — не больше: пустая `<w:tc/>` не тратит ни абзаца,
 * ни знака, а окно рисует каждую ячейку.
 */
export const DOC_MAX_CELLS = 50_000;
/**
 * Столбцов сетки в строке таблицы — не больше (у Word — до 63): ячейка шире остатка сужается, лишние
 * ячейки строки не берутся. Иначе строка из тысяч ячеек с `gridSpan` вешает раскладку страницы.
 */
export const DOC_MAX_GRID = 63;

export interface DocRun {
  t: string;
  b?: true;
  i?: true;
  u?: true;
  s?: true;
  /** Размер шрифта, пт. */
  sz?: number;
  color?: string;
  /** Картинка: ключ в `images` и размер в px. */
  img?: string;
  w?: number;
  h?: number;
}

export interface DocPara {
  k: 'p';
  /** Заголовок: 0 — «Название», 1–6 — уровни. */
  h?: number;
  al?: 'c' | 'r' | 'j';
  /** Пункт списка: уровень и номер или маркер. */
  li?: { lvl: number; label: string };
  runs: DocRun[];
}

export interface DocCell {
  blocks: DocBlock[];
  span?: number;
  rowSpan?: number;
}

export interface DocTable {
  k: 't';
  rows: DocCell[][];
}

export type DocBlock = DocPara | DocTable;

export interface DocView {
  kind: 'doc';
  blocks: DocBlock[];
  images: Record<string, ViewImage>;
  cut: boolean;
}

interface StyleInfo {
  h?: number;
  b?: boolean;
  num?: { numId: string; ilvl: number };
}

function parseDocStyles(src: string | null): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  if (!src) return out;
  const root = parseXmlTree(src, 500_000).root;
  const raw = new Map<string, { based?: string; info: StyleInfo }>();
  for (const s of childEls(root ?? undefined, 'style')) {
    const id = attrOf(s, 'styleId');
    if (!id) continue;
    const name = (attrOf(childEl(s, 'name'), 'val') ?? '').toLowerCase();
    const info: StyleInfo = {};
    const m = /^heading (\d)$/.exec(name);
    if (m) info.h = Math.min(6, Number(m[1]));
    else if (name === 'title') info.h = 0;
    const ol = attrOf(childEl(childEl(s, 'pPr'), 'outlineLvl'), 'val');
    const olN = Number(ol);
    if (info.h === undefined && Number.isInteger(olN) && olN >= 0 && olN < 9)
      info.h = Math.min(6, olN + 1);
    const b = childEl(childEl(s, 'rPr'), 'b');
    if (b) info.b = attrOf(b, 'val') !== '0' && attrOf(b, 'val') !== 'false';
    const np = childEl(childEl(s, 'pPr'), 'numPr');
    if (np)
      info.num = {
        numId: attrOf(childEl(np, 'numId'), 'val') ?? '0',
        ilvl: Number(attrOf(childEl(np, 'ilvl'), 'val') ?? 0),
      };
    const based = attrOf(childEl(s, 'basedOn'), 'val');
    raw.set(id, based ? { based, info } : { info });
  }
  // Наследование basedOn (не глубже 10 шагов).
  for (const [id, r] of raw) {
    const info: StyleInfo = { ...r.info };
    let p = r.based;
    for (let k = 0; p && k < 10; k++) {
      const up = raw.get(p);
      if (!up) break;
      if (info.h === undefined && up.info.h !== undefined) info.h = up.info.h;
      if (info.b === undefined && up.info.b !== undefined) info.b = up.info.b;
      if (!info.num && up.info.num) info.num = up.info.num;
      p = up.based;
    }
    out.set(id, info);
  }
  return out;
}

interface NumLevel {
  fmt: string;
  text: string;
  start: number;
}

function parseNumbering(src: string | null): Map<string, { abs: string; lvls: NumLevel[] }> {
  const out = new Map<string, { abs: string; lvls: NumLevel[] }>();
  if (!src) return out;
  const root = parseXmlTree(src, 500_000).root;
  const abs = new Map<string, NumLevel[]>();
  for (const a of childEls(root ?? undefined, 'abstractNum')) {
    const lvls: NumLevel[] = [];
    for (const l of childEls(a, 'lvl')) {
      const i = Number(attrOf(l, 'ilvl') ?? 0);
      if (!Number.isInteger(i) || i < 0 || i > 8) continue;
      lvls[i] = {
        fmt: attrOf(childEl(l, 'numFmt'), 'val') ?? 'decimal',
        text: lvlTemplate(attrOf(childEl(l, 'lvlText'), 'val') ?? ''),
        // Номер начала — из файла, в разумных пределах: римские цифры для 10¹² — строка в миллиард знаков.
        start: Math.min(
          Math.max(Number(attrOf(childEl(l, 'start'), 'val') ?? 1) || 0, 0),
          DOC_MAX_LIST_START,
        ),
      };
    }
    abs.set(attrOf(a, 'abstractNumId') ?? '', lvls);
  }
  for (const n of childEls(root ?? undefined, 'num')) {
    const absId = attrOf(childEl(n, 'abstractNumId'), 'val') ?? '';
    out.set(attrOf(n, 'numId') ?? '', { abs: absId, lvls: abs.get(absId) ?? [] });
  }
  return out;
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];
const roman = (n: number) => {
  let s = '';
  for (const [v, r] of ROMAN)
    while (n >= v) {
      s += r;
      n -= v;
    }
  return s;
};
const RU = 'абвгдежзиклмнопрстуфхцчшщэюя';
const letters = (n: number, abc: string) => {
  let s = '';
  while (n > 0) {
    s = abc[(n - 1) % abc.length] + s;
    n = Math.floor((n - 1) / abc.length);
  }
  return s;
};

/** Номер пункта списка по формату Word. */
export function numberText(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter':
      return letters(n, 'abcdefghijklmnopqrstuvwxyz');
    case 'upperLetter':
      return letters(n, 'abcdefghijklmnopqrstuvwxyz').toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    case 'russianLower':
      return letters(n, RU);
    case 'russianUpper':
      return letters(n, RU).toUpperCase();
    case 'decimalZero':
      return String(n).padStart(2, '0');
    case 'none':
      return '';
    default:
      return String(n);
  }
}

/** Шаблон номера из файла: длиннее предела — пустой (номера нет), а не строка в миллионы знаков. */
const lvlTemplate = (t: string) => (t.length > DOC_MAX_LIST_TEMPLATE ? '' : t);

class Numberer {
  private counters = new Map<string, number[]>();
  constructor(private readonly nums: Map<string, { abs: string; lvls: NumLevel[] }>) {}
  label(numId: string, ilvl: number): string | null {
    const num = this.nums.get(numId);
    if (!num || numId === '0') return null;
    const lvl = num.lvls[ilvl];
    if (!lvl) return null;
    if (lvl.fmt === 'bullet')
      return /^[\w\d]/.test(lvl.text) ? lvl.text.slice(0, DOC_MAX_LABEL) : '•';
    const c = this.counters.get(num.abs) ?? [];
    for (let i = 0; i < ilvl; i++) if (c[i] === undefined) c[i] = num.lvls[i]?.start ?? 1;
    c[ilvl] = c[ilvl] === undefined ? lvl.start : c[ilvl]! + 1;
    c.length = ilvl + 1;
    this.counters.set(num.abs, c);
    return lvl.text
      .replace(/%([1-9])/g, (_m, d: string) => {
        const i = Number(d) - 1;
        return numberText(c[i] ?? num.lvls[i]?.start ?? 1, num.lvls[i]?.fmt ?? 'decimal');
      })
      .slice(0, DOC_MAX_LABEL);
  }
}

const on = (el: XEl | undefined) =>
  !!el && !['0', 'false', 'none'].includes(attrOf(el, 'val') ?? '');

interface Ctx {
  styles: Map<string, StyleInfo>;
  numberer: Numberer;
  rels: Map<string, Rel>;
  bag: ImageBag;
  count: number;
  /** Кусков текста и картинок уже в модели. */
  runs: number;
  /** Знаков текста уже в модели. */
  chars: number;
  /** Строк и ячеек таблиц уже в модели. */
  cells: number;
  /** Глубина таблицы, которая сейчас разбирается (0 — вне таблицы). */
  tableDepth: number;
  /** Знаков текста в таблице верхнего уровня, которая сейчас разбирается. */
  tableChars: number;
  /** Таблица верхнего уровня набрала `DOC_MAX_TABLE_CHARS`: её строки больше не берутся. */
  tableFull: boolean;
  cut: boolean;
}

/**
 * Ещё один кусок в модель: после `DOC_MAX_RUNS` кусков или `DOC_MAX_CHARS` знаков — нет, документ
 * показан не целиком; в таблице — ещё и после `DOC_MAX_TABLE_CHARS` знаков этой таблицы.
 */
function take(ctx: Ctx, chars = 0): boolean {
  if (ctx.runs >= DOC_MAX_RUNS || ctx.chars + chars > DOC_MAX_CHARS) {
    ctx.cut = true;
    return false;
  }
  if (ctx.tableDepth > 0) {
    if (ctx.tableFull || ctx.tableChars + chars > DOC_MAX_TABLE_CHARS) {
      ctx.tableFull = true;
      ctx.cut = true;
      return false;
    }
    ctx.tableChars += chars;
  }
  ctx.runs++;
  ctx.chars += chars;
  return true;
}

async function runsOf(el: XEl, ctx: Ctx, out: DocRun[], base: Partial<DocRun>): Promise<void> {
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    const n = localName(k.name);
    if (n === 'r') {
      const rp = childEl(k, 'rPr');
      const fmt: Partial<DocRun> = { ...base };
      if (rp) {
        const b = childEl(rp, 'b');
        if (b) {
          if (on(b)) fmt.b = true;
          else delete fmt.b;
        }
        if (on(childEl(rp, 'i'))) fmt.i = true;
        if (on(childEl(rp, 'u'))) fmt.u = true;
        if (on(childEl(rp, 'strike')) || on(childEl(rp, 'dstrike'))) fmt.s = true;
        const sz = Number(attrOf(childEl(rp, 'sz'), 'val'));
        if (sz > 0) fmt.sz = Math.min(72, sz / 2);
        const col = attrOf(childEl(rp, 'color'), 'val');
        if (col && /^[0-9A-Fa-f]{6}$/.test(col) && col !== '000000')
          fmt.color = `#${col.toUpperCase()}`;
        if (on(childEl(rp, 'vanish'))) continue;
      }
      let text = '';
      let breaks = 0;
      const flush = () => {
        // Перенос строки стоит как строка текста: работу окна задаёт число строк, а не знаков.
        if (text && take(ctx, text.length + breaks * DOC_BREAK_CHARS))
          out.push({ ...fmt, t: text });
        text = '';
        breaks = 0;
      };
      for (const c of k.kids) {
        if (typeof c === 'string') continue;
        const cn = localName(c.name);
        // Перевод строки внутри `<w:t>` — пробел, как у Word (строку переносит только `<w:br/>`).
        if (cn === 't')
          text += c.kids
            .filter((x): x is string => typeof x === 'string')
            .join('')
            .replace(/[\r\n]+/g, ' ');
        else if (cn === 'tab' || cn === 'ptab') text += '\t';
        else if (cn === 'br' || cn === 'cr') {
          text += '\n';
          breaks++;
        } else if (cn === 'noBreakHyphen') text += '-';
        else if (cn === 'drawing' || cn === 'pict' || cn === 'object') {
          flush();
          const blip = findEl(c, 'blip') ?? findEl(c, 'imagedata');
          const rid = prefixedAttr(blip, 'embed') ?? prefixedAttr(blip, 'id');
          const key = rid ? await ctx.bag.add(ctx.rels.get(rid)) : null;
          if (key && take(ctx)) {
            const ext = findEl(c, 'extent');
            const w = emuToPx(Number(attrOf(ext, 'cx') ?? 0));
            const h = emuToPx(Number(attrOf(ext, 'cy') ?? 0));
            out.push({ t: '', img: key, ...(w > 0 ? { w } : {}), ...(h > 0 ? { h } : {}) });
          }
        }
      }
      flush();
    } else if (n === 'hyperlink') {
      // Ссылка — только текст: адрес из файла не открывается и не загружается.
      await runsOf(k, ctx, out, { ...base, u: true });
    } else if (
      n === 'del' ||
      n === 'pPr' ||
      n === 'rPr' ||
      n === 'moveFrom' ||
      n === 'commentRangeStart'
    ) {
      continue;
    } else if (n === 'sdt') {
      const content = childEl(k, 'sdtContent');
      if (content) await runsOf(content, ctx, out, base);
    } else if (k.kids.length) {
      // ins, smartTag, fldSimple, customXml, moveTo… — внутри те же куски текста.
      await runsOf(k, ctx, out, base);
    }
  }
}

async function paraOf(p: XEl, ctx: Ctx): Promise<DocPara> {
  const pp = childEl(p, 'pPr');
  const styleId = attrOf(childEl(pp, 'pStyle'), 'val');
  const st = styleId ? ctx.styles.get(styleId) : undefined;
  const para: DocPara = { k: 'p', runs: [] };
  if (st?.h !== undefined) para.h = st.h;
  const ol = Number(attrOf(childEl(pp, 'outlineLvl'), 'val'));
  if (para.h === undefined && Number.isInteger(ol) && ol >= 0 && ol < 9)
    para.h = Math.min(6, ol + 1);
  const jc = attrOf(childEl(pp, 'jc'), 'val');
  if (jc === 'center') para.al = 'c';
  else if (jc === 'right' || jc === 'end') para.al = 'r';
  else if (jc === 'both' || jc === 'distribute') para.al = 'j';
  const np = childEl(pp, 'numPr');
  const num = np
    ? {
        numId: attrOf(childEl(np, 'numId'), 'val') ?? '0',
        ilvl: Number(attrOf(childEl(np, 'ilvl'), 'val') ?? 0),
      }
    : st?.num;
  if (num) {
    const label = ctx.numberer.label(num.numId, num.ilvl);
    if (label !== null) para.li = { lvl: num.ilvl, label };
  }
  await runsOf(p, ctx, para.runs, st?.b ? { b: true } : {});
  return para;
}

/** Ещё одна строка или ячейка таблицы: после `DOC_MAX_CELLS` — нет, документ показан не целиком. */
function takeCell(ctx: Ctx): boolean {
  if (ctx.cells >= DOC_MAX_CELLS) {
    ctx.cut = true;
    return false;
  }
  ctx.cells++;
  return true;
}

async function tableOf(tbl: XEl, ctx: Ctx): Promise<DocTable> {
  const rows: DocCell[][] = [];
  // Ячейка, начавшая объединение по вертикали, по номеру столбца сетки.
  const vStart = new Map<number, DocCell>();
  let full = false;
  if (ctx.tableDepth === 0) {
    ctx.tableChars = 0;
    ctx.tableFull = false;
  }
  ctx.tableDepth++;
  for (const tr of childEls(tbl, 'tr')) {
    if (full || ctx.tableFull || !takeCell(ctx)) break;
    const row: DocCell[] = [];
    let grid = 0;
    for (const tc of childEls(tr, 'tc')) {
      if (grid >= DOC_MAX_GRID) {
        ctx.cut = true;
        break;
      }
      const pr = childEl(tc, 'tcPr');
      const spanVal = Math.floor(Number(attrOf(childEl(pr, 'gridSpan'), 'val') ?? 1));
      const span = Math.min(DOC_MAX_GRID - grid, Math.max(1, spanVal || 1));
      const vm = childEl(pr, 'vMerge');
      const vmVal = attrOf(vm, 'val');
      if (vm && vmVal !== 'restart') {
        const start = vStart.get(grid);
        if (start) start.rowSpan = (start.rowSpan ?? 1) + 1;
        grid += span;
        continue;
      }
      if (ctx.tableFull || !takeCell(ctx)) {
        full = true;
        break;
      }
      const cell: DocCell = { blocks: await blocksOf(tc, ctx) };
      if (span > 1) cell.span = span;
      if (vm) vStart.set(grid, cell);
      else vStart.delete(grid);
      row.push(cell);
      grid += span;
    }
    rows.push(row);
  }
  ctx.tableDepth--;
  fitTableGrid(rows, ctx);
  return { k: 't', rows };
}

/**
 * Раскладка, как у таблицы в окне (правило HTML): ячейка встаёт в первый столбец, не занятый
 * объединением по вертикали сверху. Ячейка, которая так выходит за сетку Word (`DOC_MAX_GRID`), и
 * остальные ячейки её строки не показываются: иначе «лестница» объединений из файла раздвигает
 * таблицу на тысячи столбцов, хотя по сетке файла строка укладывается в 63.
 */
function fitTableGrid(rows: DocCell[][], ctx: Ctx): void {
  // До какой строки (не включая) занят столбец объединением сверху.
  const busy = new Array<number>(DOC_MAX_GRID).fill(0);
  rows.forEach((row, ri) => {
    let col = 0;
    let kept = 0;
    for (const cell of row) {
      while (col < DOC_MAX_GRID && busy[col]! > ri) col++;
      const span = cell.span ?? 1;
      if (col + span > DOC_MAX_GRID) {
        ctx.cut = true;
        break;
      }
      const until = ri + (cell.rowSpan ?? 1);
      for (let c = col; c < col + span; c++) busy[c] = Math.max(busy[c]!, until);
      col += span;
      kept++;
    }
    row.length = kept;
  });
}

async function blocksOf(el: XEl, ctx: Ctx): Promise<DocBlock[]> {
  const out: DocBlock[] = [];
  for (const k of el.kids) {
    if (typeof k === 'string') continue;
    if (ctx.count >= DOC_MAX_BLOCKS) {
      ctx.cut = true;
      break;
    }
    const n = localName(k.name);
    if (n === 'p') {
      ctx.count++;
      out.push(await paraOf(k, ctx));
    } else if (n === 'tbl') {
      ctx.count++;
      out.push(await tableOf(k, ctx));
    } else if (n === 'sdt') {
      const content = childEl(k, 'sdtContent');
      if (content) out.push(...(await blocksOf(content, ctx)));
    } else if (n === 'customXml' || n === 'ins') out.push(...(await blocksOf(k, ctx)));
  }
  return out;
}

export async function parseDocx(zip: Zip): Promise<DocView> {
  const rootRels = await readRels(zip, '');
  const docPart =
    [...rootRels.values()].find((r) => r.type === 'officeDocument' && !r.external)?.part ??
    'word/document.xml';
  const src = await zip.text(docPart);
  if (!src) throw new ViewError('file_bad');
  const rels = await readRels(zip, docPart);
  const relOf = (type: string) =>
    [...rels.values()].find((r) => r.type === type && !r.external)?.part;
  const styles = parseDocStyles(await zip.text(relOf('styles') ?? 'word/styles.xml'));
  const nums = parseNumbering(await zip.text(relOf('numbering') ?? 'word/numbering.xml'));
  const bag = new ImageBag(zip);
  const ctx: Ctx = {
    styles,
    numberer: new Numberer(nums),
    rels,
    bag,
    count: 0,
    runs: 0,
    chars: 0,
    cells: 0,
    tableDepth: 0,
    tableChars: 0,
    tableFull: false,
    cut: false,
  };
  const root = parseXmlTree(src, 3_000_000).root;
  const body = childEl(root ?? undefined, 'body');
  const blocks = body ? await blocksOf(body, ctx) : [];
  return { kind: 'doc', blocks, images: bag.images, cut: ctx.cut };
}
