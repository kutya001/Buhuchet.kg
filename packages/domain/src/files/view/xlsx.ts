/**
 * Книга Excel (XLSX, XLSM) в окне просмотра (доработки 16.11.2026, блок 5, пункт 2): листы
 * вкладками, ширины столбцов, объединённые ячейки, жирный шрифт, числа по формату ячейки, формулы —
 * сохранённым в файле значением (ничего не пересчитывается). Макросы (`vbaProject.bin`), внешние
 * связи и подключения к данным не читаются вовсе: разбираются только листы, общие строки и стили.
 */
import { BUILTIN_NUMFMT, formatCellNumber, formatCellText, isDateFormat } from './numfmt';
import { readRels } from './ooxml';
import {
  cellRef,
  colWidthPx,
  DEFAULT_COL_PX,
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  SHEET_MAX_SHEETS,
  clipCellText,
  sheetBudgetSpent,
  sheetFormatCode,
  sheetColDefs,
  sheetMergeCollector,
  sheetRowMeta,
  sheetSlots,
  sheetTextBudget,
  takeSheetCell,
  type SheetTextBudget,
  type BookView,
  type SheetCell,
  type SheetView,
} from './sheet';
import {
  attrOf,
  childEl,
  childEls,
  localName,
  parseXmlTree,
  prefixedAttr,
  scanXml,
  ViewError,
  type XEl,
} from './xml';
import type { Zip } from './zip';

interface Xf {
  fmt: string;
  b?: true;
  i?: true;
  u?: true;
  color?: string;
  bg?: string;
  al?: 'l' | 'c' | 'r';
  wrap?: true;
}

/** Цвет ARGB из файла в `#RRGGBB`; чёрный текст и белая заливка — по теме окна (`null`). */
function rgbOf(el: XEl | undefined, skip: string): string | undefined {
  const rgb = attrOf(el, 'rgb');
  if (!rgb || !/^[0-9A-Fa-f]{6,8}$/.test(rgb)) return undefined;
  const hex = `#${rgb.slice(-6).toUpperCase()}`;
  return hex === skip ? undefined : hex;
}

function parseStyles(src: string | null): Xf[] {
  if (!src) return [];
  const { root } = parseXmlTree(src, 500_000);
  if (!root) return [];
  const fmts = new Map<number, string>();
  for (const f of childEls(childEl(root, 'numFmts'), 'numFmt'))
    fmts.set(Number(attrOf(f, 'numFmtId')), sheetFormatCode(attrOf(f, 'formatCode') ?? ''));
  const fonts = childEls(childEl(root, 'fonts'), 'font').map((f) => {
    const on = (n: string) => {
      const e = childEl(f, n);
      return (
        e && attrOf(e, 'val') !== '0' && attrOf(e, 'val') !== 'false' && attrOf(e, 'val') !== 'none'
      );
    };
    return { b: on('b'), i: on('i'), u: on('u'), color: rgbOf(childEl(f, 'color'), '#000000') };
  });
  const fills = childEls(childEl(root, 'fills'), 'fill').map((f) => {
    const p = childEl(f, 'patternFill');
    return attrOf(p, 'patternType') === 'solid'
      ? rgbOf(childEl(p, 'fgColor'), '#FFFFFF')
      : undefined;
  });
  return childEls(childEl(root, 'cellXfs'), 'xf').map((x) => {
    const id = Number(attrOf(x, 'numFmtId') ?? 0);
    const font = fonts[Number(attrOf(x, 'fontId') ?? 0)];
    const al = childEl(x, 'alignment');
    const h = attrOf(al, 'horizontal');
    const xf: Xf = { fmt: fmts.get(id) ?? BUILTIN_NUMFMT[id] ?? 'General' };
    if (font?.b) xf.b = true;
    if (font?.i) xf.i = true;
    if (font?.u) xf.u = true;
    if (font?.color) xf.color = font.color;
    const bg = fills[Number(attrOf(x, 'fillId') ?? 0)];
    if (bg) xf.bg = bg;
    if (h === 'center' || h === 'centerContinuous') xf.al = 'c';
    else if (h === 'right') xf.al = 'r';
    else if (h === 'left') xf.al = 'l';
    if (attrOf(al, 'wrapText') === '1' || attrOf(al, 'wrapText') === 'true') xf.wrap = true;
    return xf;
  });
}

/** Общие строки: текст каждого `<si>` (с форматированными кусками, без фонетических подсказок). */
function parseSharedStrings(src: string | null): string[] {
  const out: string[] = [];
  if (!src) return out;
  let cur: string | null = null;
  let inT = false;
  let rph = 0;
  scanXml(src, {
    open(name, _a, self) {
      const n = localName(name);
      if (n === 'si') cur = '';
      else if (n === 'rPh' && !self) rph++;
      else if (n === 't' && !self) inT = true;
    },
    close(name) {
      const n = localName(name);
      if (n === 'si') {
        out.push(cur ?? '');
        cur = null;
      } else if (n === 'rPh') rph = Math.max(0, rph - 1);
      else if (n === 't') inT = false;
    },
    text(t) {
      if (inT && rph === 0 && cur !== null) cur += t;
    },
  });
  return out;
}

const boolText = (v: string) => (v === '1' || v === 'true' ? 'ИСТИНА' : 'ЛОЖЬ');

/** Ячейка по типу, значению и стилю. */
export function sheetCell(
  t: string | undefined,
  raw: string,
  xf: Xf | undefined,
  sst: readonly string[],
  date1904: boolean,
): SheetCell | null {
  const fmt = xf?.fmt ?? 'General';
  let cell: SheetCell;
  if (t === 's') cell = { v: formatCellText(sst[Number(raw)] ?? '', fmt) };
  else if (t === 'str' || t === 'inlineStr') cell = { v: formatCellText(raw, fmt) };
  else if (t === 'b') cell = { v: boolText(raw), al: 'c' };
  else if (t === 'e') cell = { v: clipCellText(raw), al: 'c' };
  else if (t === 'd') {
    const ms = Date.parse(
      raw.length <= 10 ? `${raw}T00:00:00Z` : raw.endsWith('Z') ? raw : `${raw}Z`,
    );
    if (Number.isNaN(ms)) cell = { v: clipCellText(raw) };
    else
      cell = {
        v: formatCellNumber(
          ms / 86400000 + 25569,
          isDateFormat(fmt) ? fmt : 'dd.mm.yyyy',
          date1904,
        ),
        num: true,
      };
  } else {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    cell = Number.isFinite(n)
      ? { v: formatCellNumber(n, fmt, date1904), num: true }
      : { v: clipCellText(raw) };
  }
  if (cell.v === '' && !xf?.bg) return null;
  if (xf) {
    if (xf.b) cell.b = true;
    if (xf.i) cell.i = true;
    if (xf.u) cell.u = true;
    if (xf.al) cell.al = xf.al;
    if (xf.wrap) cell.wrap = true;
    if (xf.color) cell.color = xf.color;
    if (xf.bg) cell.bg = xf.bg;
  }
  return cell;
}

/** Номер последней строки листа: из последнего `<row r="…">` перед концом данных или из `<dimension>`. */
function lastRowNumber(src: string, dataEnd: number): number {
  const head = src.slice(0, Math.min(src.length, 4096));
  const dim = /<(?:\w+:)?dimension\b[^>]*\bref="[A-Za-z]+\d+:[A-Za-z]+(\d+)"/.exec(head);
  const tailFrom = Math.max(0, dataEnd - 1);
  let at = src.lastIndexOf('<row ', tailFrom);
  const at2 = src.lastIndexOf(':row ', tailFrom);
  if (at2 > at) at = at2 - 1;
  if (at >= 0) {
    const m = /\br="(\d+)"/.exec(src.slice(at, at + 400));
    if (m) return Number(m[1]);
  }
  return dim ? Number(dim[1]) : 0;
}

/** Лист: первые `SHEET_MAX_ROWS` строк; остальное не разбирается (только число строк). */
export function parseWorksheet(
  name: string,
  src: string,
  xfs: readonly Xf[],
  sst: readonly string[],
  date1904: boolean,
  budget: SheetTextBudget = sheetTextBudget(),
): SheetView {
  const colDefs = sheetColDefs();
  let defPx = DEFAULT_COL_PX;
  const rows: (SheetCell | null)[][] = [];
  const rowMeta = sheetRowMeta();
  const merges = sheetMergeCollector();
  let colsCut = false;
  let maxCol = -1;
  let rowIdx = -1;
  let colIdx = -1;
  let cur: { t?: string; s?: string; c: number } | null = null;
  let val = '';
  let inV = false;
  let inIs = false;
  let rph = 0;
  let cut = false;
  // Строка, на которой кончился предел книги (знаки или ячейки): с неё строки не показываются.
  let textCutAt = -1;
  let rowsSeen = 0;
  const dataEnd = (() => {
    const i = src.lastIndexOf('sheetData>');
    return i < 0 ? src.length : i;
  })();
  scanXml(src, {
    open(tag, a, self) {
      const n = localName(tag);
      if (n === 'row') {
        rowsSeen++;
        // Номер строки — целое с 1; неверный — следующая строка, как без номера.
        const rn = a.r ? Number(a.r) : NaN;
        rowIdx = Number.isInteger(rn) && rn >= 1 ? rn - 1 : rowIdx + 1;
        colIdx = -1;
        // Предел строк, знаков или ячеек книги: дальше строки только считаются (`totalRows`).
        if (rowIdx >= SHEET_MAX_ROWS || sheetBudgetSpent(budget)) {
          cut = true;
          return false;
        }
        while (rows.length <= rowIdx) rows.push([]);
        if (a.ht && (a.customHeight === '1' || a.customHeight === 'true'))
          rowMeta.height(rowIdx, Number(a.ht) * (4 / 3));
        if (a.hidden === '1' || a.hidden === 'true') rowMeta.hide(rowIdx);
      } else if (n === 'c') {
        const ref = a.r ? cellRef(a.r) : null;
        colIdx = ref ? ref[1] : colIdx + 1;
        cur = { c: colIdx };
        if (a.t !== undefined) cur.t = a.t;
        if (a.s !== undefined) cur.s = a.s;
        val = '';
        if (self) cur = null;
      } else if (n === 'v' && cur && !self) inV = true;
      else if (n === 'is' && cur && !self) inIs = true;
      else if (n === 'rPh' && !self) rph++;
      else if (n === 't' && inIs && !self) inV = true;
      else if (n === 'col') {
        const hidden = a.hidden === '1' || a.hidden === 'true';
        colDefs.add(
          Number(a.min ?? 1) - 1,
          Number(a.max ?? a.min ?? 1) - 1,
          hidden ? 0 : a.width ? colWidthPx(Number(a.width), -1) : -1,
        );
      } else if (n === 'sheetFormatPr') {
        if (a.defaultColWidth) defPx = colWidthPx(Number(a.defaultColWidth));
        else if (a.baseColWidth) defPx = colWidthPx(Number(a.baseColWidth) + 0.43);
      } else if (n === 'mergeCell' && a.ref) {
        const [p, q] = a.ref.split(':');
        const s = p ? cellRef(p) : null;
        const e = q ? cellRef(q) : s;
        if (s && e) merges.add(s[0], s[1], e[0], e[1]);
      }
    },
    close(tag) {
      const n = localName(tag);
      if (n === 'c' && cur) {
        if (cur.c >= SHEET_MAX_COLS) colsCut = true;
        else {
          const cell = sheetCell(
            cur.t,
            val,
            cur.s !== undefined ? xfs[Number(cur.s)] : xfs[0],
            sst,
            date1904,
          );
          if (cell && !takeSheetCell(budget, cell, sheetSlots(rows[rowIdx], cur.c))) {
            cut = true;
            if (textCutAt < 0) textCutAt = rowIdx;
          } else if (cell) {
            const row = rows[rowIdx]!;
            while (row.length < cur.c) row.push(null);
            row[cur.c] = cell;
            if (cur.c > maxCol) maxCol = cur.c;
          }
        }
        cur = null;
      } else if (n === 'v') inV = false;
      else if (n === 't' && inIs) inV = false;
      else if (n === 'is') inIs = false;
      else if (n === 'rPh') rph = Math.max(0, rph - 1);
    },
    text(t) {
      if (inV && rph === 0) val += t;
    },
  });
  if (textCutAt >= 0 && rows.length > textCutAt) rows.length = textCutAt;
  let totalRows = rows.length;
  if (cut) {
    totalRows = Math.max(lastRowNumber(src, dataEnd), rowsSeen);
    // Объединения и прочее после данных листа: разбираем только хвост файла.
    const tail = src.slice(dataEnd + 'sheetData>'.length);
    scanXml(tail, {
      open(tag, a) {
        if (localName(tag) === 'mergeCell' && a.ref) {
          const [p, q] = a.ref.split(':');
          const s = p ? cellRef(p) : null;
          const e = q ? cellRef(q) : s;
          if (s && e) merges.add(s[0], s[1], e[0], e[1]);
        }
      },
    });
  }
  // Ширины: заданные `<col>` и по умолчанию; столбцов — до последнего с данными или объединением.
  for (const m of merges.list) maxCol = Math.max(maxCol, m[3]);
  const width = Math.min(SHEET_MAX_COLS, maxCol + 1);
  const cols = colDefs.widths(width, defPx);
  for (const r of rows) if (r.length > width) r.length = width;
  return {
    name,
    cols,
    rows,
    heights: rowMeta.heights,
    hiddenRows: rowMeta.hiddenRows(),
    merges: merges.list,
    totalRows,
    colsCut,
  };
}

/** Книга XLSX/XLSM: видимые листы по порядку книги. */
export async function parseXlsx(zip: Zip): Promise<BookView> {
  const rootRels = await readRels(zip, '');
  const wbPart =
    [...rootRels.values()].find((r) => r.type === 'officeDocument')?.part ?? 'xl/workbook.xml';
  const wbSrc = await zip.text(wbPart);
  if (!wbSrc) throw new ViewError('file_bad');
  const wb = parseXmlTree(wbSrc, 200_000).root;
  const date1904 = ['1', 'true'].includes(
    attrOf(childEl(wb ?? undefined, 'workbookPr'), 'date1904') ?? '',
  );
  const rels = await readRels(zip, wbPart);
  const relOf = (type: string) => [...rels.values()].find((r) => r.type === type && !r.external);
  const sst = parseSharedStrings(
    await zip.text(relOf('sharedStrings')?.part ?? 'xl/sharedStrings.xml'),
  );
  const xfs = parseStyles(await zip.text(relOf('styles')?.part ?? 'xl/styles.xml'));
  const sheets: SheetView[] = [];
  // Знаки ячеек — общим счётом на книгу: следующий лист берёт остаток.
  const budget = sheetTextBudget();
  for (const s of childEls(childEl(wb ?? undefined, 'sheets'), 'sheet')) {
    if (sheets.length >= SHEET_MAX_SHEETS) break;
    const state = attrOf(s, 'state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const rel = rels.get(prefixedAttr(s, 'id') ?? '');
    if (!rel || rel.external || rel.type !== 'worksheet') continue;
    const src = await zip.text(rel.part);
    if (src === null) continue;
    sheets.push(
      parseWorksheet(
        attrOf(s, 'name') ?? String(sheets.length + 1),
        src,
        xfs,
        sst,
        date1904,
        budget,
      ),
    );
  }
  return { kind: 'sheet', sheets };
}
