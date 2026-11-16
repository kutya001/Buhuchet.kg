/**
 * Старая книга Excel (XLS, BIFF8) в окне просмотра (доработки 16.11.2026, блок 5, пункт 2):
 * составной файл (CFB) → поток «Workbook» → записи листов. Читаются только значения, форматы чисел,
 * шрифты, ширины и объединения; макросы (потоки VBA) и формулы не исполняются — у формулы берётся
 * сохранённое значение. Книга с паролем — «Предпросмотр недоступен» и «Скачать».
 */
import { BUILTIN_NUMFMT, formatCellNumber, formatCellText } from './numfmt';
import {
  colWidthPx,
  DEFAULT_COL_PX,
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  SHEET_MAX_SHEETS,
  type BookView,
  type SheetCell,
  type SheetView,
} from './sheet';
import { ViewError } from './xml';

const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Составной файл Office (XLS, DOC, PPT, а также XLSX/DOCX с паролем)? */
export const isCfb = (b: Uint8Array) => b.length >= 512 && CFB_SIG.every((v, i) => b[i] === v);

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** Поток составного файла по имени (без учёта регистра); нет — `null`. */
export function cfbStream(b: Uint8Array, name: string): Uint8Array | null {
  if (!isCfb(b)) throw new ViewError('xls_bad');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const shift = dv.getUint16(30, true);
  if (shift !== 9 && shift !== 12) throw new ViewError('xls_bad');
  const ss = 1 << shift;
  const miniShift = dv.getUint16(32, true);
  const miniSize = 1 << miniShift;
  const nSectors = Math.floor((b.length - ss) / ss);
  const sectorOff = (sid: number) => {
    if (sid >= nSectors) throw new ViewError('xls_bad');
    return (sid + 1) * ss;
  };
  // Таблица размещения: номера её секторов — в заголовке (109) и в цепочке DIFAT.
  const fatSids: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(76 + i * 4);
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSids.push(s);
  }
  let difat = u32(68);
  for (let guard = 0; difat !== ENDOFCHAIN && difat !== FREESECT && guard < nSectors; guard++) {
    const o = sectorOff(difat);
    for (let i = 0; i < ss / 4 - 1; i++) {
      const s = u32(o + i * 4);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSids.push(s);
    }
    difat = u32(o + ss - 4);
  }
  const fat = new Uint32Array(fatSids.length * (ss / 4));
  fatSids.forEach((sid, k) => {
    const o = sectorOff(sid);
    for (let i = 0; i < ss / 4; i++) fat[k * (ss / 4) + i] = u32(o + i * 4);
  });
  const chain = (start: number, table: Uint32Array, limit: number): number[] => {
    const out: number[] = [];
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT; s = table[s] ?? ENDOFCHAIN) {
      if (out.length > limit || s >= table.length) throw new ViewError('xls_bad');
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const sids = chain(start, fat, nSectors);
    const out = new Uint8Array(sids.length * ss);
    sids.forEach((sid, k) => out.set(b.subarray(sectorOff(sid), sectorOff(sid) + ss), k * ss));
    return out.subarray(0, Math.min(size, out.length));
  };
  // Каталог: записи по 128 байт.
  const dir = readChain(u32(48), Number.MAX_SAFE_INTEGER);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const cutoff = u32(56);
  let root: { start: number; size: number } | null = null;
  let found: { start: number; size: number } | null = null;
  const want = name.toLowerCase();
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 64, true);
    const type = dir[o + 66];
    if (!type || nameLen < 2 || nameLen > 64) continue;
    let n = '';
    for (let i = 0; i < nameLen / 2 - 1; i++)
      n += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    const entry = { start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) };
    if (type === 5) root = entry;
    else if (type === 2 && n.toLowerCase() === want && !found) found = entry;
  }
  if (!found) return null;
  if (found.size >= cutoff) return readChain(found.start, found.size);
  // Маленький поток — в «мини-потоке» корня.
  if (!root) throw new ViewError('xls_bad');
  const mini = readChain(root.start, root.size);
  const mfSids = chain(u32(60), fat, nSectors);
  const minifat = new Uint32Array(mfSids.length * (ss / 4));
  mfSids.forEach((sid, k) => {
    const o = sectorOff(sid);
    for (let i = 0; i < ss / 4; i++) minifat[k * (ss / 4) + i] = u32(o + i * 4);
  });
  const sids = chain(found.start, minifat, mini.length / miniSize + 1);
  const out = new Uint8Array(sids.length * miniSize);
  sids.forEach((sid, k) => {
    if ((sid + 1) * miniSize > mini.length) throw new ViewError('xls_bad');
    out.set(mini.subarray(sid * miniSize, (sid + 1) * miniSize), k * miniSize);
  });
  return out.subarray(0, found.size);
}

interface Rec {
  type: number;
  /** Данные записи и её продолжений CONTINUE (по отдельности — для таблицы строк). */
  segs: Uint8Array[];
  data: Uint8Array;
  pos: number;
}

function* records(s: Uint8Array, from = 0): Generator<Rec> {
  let p = from;
  while (p + 4 <= s.length) {
    const type = s[p]! | (s[p + 1]! << 8);
    const len = s[p + 2]! | (s[p + 3]! << 8);
    const pos = p;
    const segs = [s.subarray(p + 4, Math.min(s.length, p + 4 + len))];
    p += 4 + len;
    while (p + 4 <= s.length && (s[p]! | (s[p + 1]! << 8)) === 0x003c) {
      const l = s[p + 2]! | (s[p + 3]! << 8);
      segs.push(s.subarray(p + 4, Math.min(s.length, p + 4 + l)));
      p += 4 + l;
    }
    yield { type, segs, data: segs[0]!, pos };
  }
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};
const utf16 = (b: Uint8Array) => new TextDecoder('utf-16le').decode(b);

/** XLUnicodeString внутри одной записи: длина u16 или u8, флаги, знаки. */
function xlString(d: Uint8Array, o: number, shortLen = false): { s: string; end: number } {
  const cch = shortLen ? d[o]! : d[o]! | (d[o + 1]! << 8);
  let p = o + (shortLen ? 1 : 2);
  const flags = d[p++]!;
  const high = flags & 1;
  const rich = flags & 8 ? d[p]! | (d[p + 1]! << 8) : 0;
  if (flags & 8) p += 2;
  const ext = flags & 4 ? new DataView(d.buffer, d.byteOffset + p, 4).getUint32(0, true) : 0;
  if (flags & 4) p += 4;
  const bytes = d.subarray(p, p + cch * (high ? 2 : 1));
  p += bytes.length + rich * 4 + ext;
  return { s: high ? utf16(bytes) : latin1(bytes), end: p };
}

/** Таблица общих строк (SST) с продолжениями: знаки строки могут переходить в CONTINUE. */
function parseSst(segs: Uint8Array[]): string[] {
  let si = 0;
  let pos = 8;
  let seg = segs[0]!;
  const count =
    seg.length >= 8 ? new DataView(seg.buffer, seg.byteOffset + 4, 4).getUint32(0, true) : 0;
  const next = () => {
    si++;
    seg = segs[si] ?? new Uint8Array(0);
    pos = 0;
  };
  const u8 = () => {
    if (pos >= seg.length) next();
    return seg[pos++] ?? 0;
  };
  const u16 = () => u8() | (u8() << 8);
  const u32 = () => (u16() | (u16() << 16)) >>> 0;
  const skip = (n: number) => {
    while (n > 0 && si < segs.length) {
      const take = Math.min(n, seg.length - pos);
      pos += take;
      n -= take;
      if (n > 0) next();
    }
  };
  const out: string[] = [];
  for (let k = 0; k < count && si < segs.length; k++) {
    if (pos >= seg.length) next();
    const cch = u16();
    const flags = u8();
    let high = flags & 1;
    const rich = flags & 8 ? u16() : 0;
    const ext = flags & 4 ? u32() : 0;
    let s = '';
    let left = cch;
    while (left > 0 && si < segs.length) {
      if (pos >= seg.length) {
        next();
        high = u8() & 1;
      }
      const avail = high ? Math.floor((seg.length - pos) / 2) : seg.length - pos;
      const take = Math.min(left, avail);
      if (take <= 0) {
        pos = seg.length;
        continue;
      }
      const bytes = seg.subarray(pos, pos + take * (high ? 2 : 1));
      s += high ? utf16(bytes) : latin1(bytes);
      pos += bytes.length;
      left -= take;
    }
    skip(rich * 4 + ext);
    out.push(s);
  }
  return out;
}

function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) v = (rk | 0) >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, rk & 0xfffffffc, true);
    v = dv.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

interface XlsXf {
  fmt: string;
  b?: true;
  i?: true;
  u?: true;
  al?: 'l' | 'c' | 'r';
  wrap?: true;
}

export function parseXls(file: Uint8Array): BookView {
  const wb = cfbStream(file, 'Workbook');
  if (!wb) throw new ViewError('xls_bad');
  const fonts: { b: boolean; i: boolean; u: boolean }[] = [];
  const formats = new Map<number, string>();
  const xfs: XlsXf[] = [];
  let sst: string[] = [];
  let date1904 = false;
  const sheetsMeta: { name: string; pos: number }[] = [];
  for (const r of records(wb)) {
    const d = r.data;
    const rdv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (r.type === 0x002f) throw new ViewError('file_encrypted');
    if (r.type === 0x000a) break;
    if (r.type === 0x0031 && d.length >= 14) {
      fonts.push({
        b: rdv.getUint16(6, true) >= 700,
        i: (rdv.getUint16(2, true) & 2) !== 0,
        u: d[10]! !== 0,
      });
    } else if (r.type === 0x041e && d.length >= 5)
      formats.set(rdv.getUint16(0, true), xlString(d, 2).s);
    else if (r.type === 0x00e0 && d.length >= 8) {
      const fi = rdv.getUint16(0, true);
      const font = fonts[fi >= 4 ? fi - 1 : fi];
      const id = rdv.getUint16(2, true);
      const alc = d[6]! & 7;
      const xf: XlsXf = { fmt: formats.get(id) ?? BUILTIN_NUMFMT[id] ?? 'General' };
      if (font?.b) xf.b = true;
      if (font?.i) xf.i = true;
      if (font?.u) xf.u = true;
      if (alc === 1) xf.al = 'l';
      else if (alc === 2 || alc === 6) xf.al = 'c';
      else if (alc === 3) xf.al = 'r';
      if (d[6]! & 8) xf.wrap = true;
      xfs.push(xf);
    } else if (r.type === 0x00fc) sst = parseSst(r.segs);
    else if (r.type === 0x0022 && d.length >= 2) date1904 = rdv.getUint16(0, true) === 1;
    else if (r.type === 0x0085 && d.length >= 8) {
      const state = d[4]! & 3;
      const dt = d[5]!;
      if (state === 0 && dt === 0)
        sheetsMeta.push({ pos: rdv.getUint32(0, true), name: xlString(d, 6, true).s });
    }
  }
  const sheets: SheetView[] = [];
  for (const meta of sheetsMeta.slice(0, SHEET_MAX_SHEETS)) {
    if (meta.pos >= wb.length) continue;
    sheets.push(parseXlsSheet(wb, meta, xfs, sst, date1904));
  }
  return { kind: 'sheet', sheets };
}

function parseXlsSheet(
  wb: Uint8Array,
  meta: { name: string; pos: number },
  xfs: readonly XlsXf[],
  sst: readonly string[],
  date1904: boolean,
): SheetView {
  const rows: (SheetCell | null)[][] = [];
  const heights: Record<number, number> = {};
  const hiddenRows: number[] = [];
  const merges: SheetView['merges'] = [];
  const colDef: { min: number; max: number; px: number }[] = [];
  let defPx = DEFAULT_COL_PX;
  let dimRows = 0;
  let maxRow = -1;
  let maxCol = -1;
  let colsCut = false;
  let depth = 0;
  let pendingFormula: { r: number; c: number; xf: number } | null = null;
  const put = (r: number, c: number, cell: SheetCell | null) => {
    if (r > maxRow) maxRow = r;
    if (r >= SHEET_MAX_ROWS || !cell) return;
    if (c >= SHEET_MAX_COLS) {
      colsCut = true;
      return;
    }
    while (rows.length <= r) rows.push([]);
    const row = rows[r]!;
    while (row.length < c) row.push(null);
    row[c] = cell;
    if (c > maxCol) maxCol = c;
  };
  const styled = (cell: SheetCell, xfi: number): SheetCell => {
    const xf = xfs[xfi];
    if (xf) {
      if (xf.b) cell.b = true;
      if (xf.i) cell.i = true;
      if (xf.u) cell.u = true;
      if (xf.al) cell.al = xf.al;
      if (xf.wrap) cell.wrap = true;
    }
    return cell;
  };
  const num = (v: number, xfi: number) =>
    styled({ v: formatCellNumber(v, xfs[xfi]?.fmt ?? 'General', date1904), num: true }, xfi);
  const str = (s: string, xfi: number) =>
    s === '' ? null : styled({ v: formatCellText(s, xfs[xfi]?.fmt ?? 'General') }, xfi);
  for (const r of records(wb, meta.pos)) {
    const d = r.data;
    const rdv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (r.type === 0x0809) {
      depth++;
      continue;
    }
    if (r.type === 0x000a) {
      depth--;
      if (depth <= 0) break;
      continue;
    }
    if (depth > 1) continue;
    const rw = d.length >= 2 ? rdv.getUint16(0, true) : 0;
    const col = d.length >= 4 ? rdv.getUint16(2, true) : 0;
    const xfi = d.length >= 6 ? rdv.getUint16(4, true) : 0;
    switch (r.type) {
      case 0x0200:
        if (d.length >= 8) dimRows = rdv.getUint32(4, true);
        break;
      case 0x0055:
        if (d.length >= 2) defPx = colWidthPx(rdv.getUint16(0, true) + 0.43);
        break;
      case 0x007d:
        if (d.length >= 10) {
          const hidden = (rdv.getUint16(8, true) & 1) !== 0;
          colDef.push({
            min: rdv.getUint16(0, true),
            max: Math.min(rdv.getUint16(2, true), SHEET_MAX_COLS - 1),
            px: hidden ? 0 : colWidthPx(rdv.getUint16(4, true) / 256),
          });
        }
        break;
      case 0x0208:
        if (d.length >= 16 && rw < SHEET_MAX_ROWS) {
          const h = rdv.getUint16(6, true);
          const flags = rdv.getUint16(12, true);
          if (flags & 0x20) hiddenRows.push(rw);
          if (flags & 0x40 && !(h & 0x8000))
            heights[rw] = Math.round(((h & 0x7fff) / 20) * (4 / 3));
        }
        break;
      case 0x00fd:
        if (d.length >= 10) put(rw, col, str(sst[rdv.getUint32(6, true)] ?? '', xfi));
        break;
      case 0x0204:
        if (d.length >= 9) put(rw, col, str(xlString(d, 6).s, xfi));
        break;
      case 0x0203:
        if (d.length >= 14) put(rw, col, num(rdv.getFloat64(6, true), xfi));
        break;
      case 0x027e:
        if (d.length >= 10) put(rw, col, num(rkValue(rdv.getUint32(6, true)), xfi));
        break;
      case 0x00bd: {
        const n = Math.floor((d.length - 6) / 6);
        for (let k = 0; k < n; k++) {
          const o = 4 + k * 6;
          put(rw, col + k, num(rkValue(rdv.getUint32(o + 2, true)), rdv.getUint16(o, true)));
        }
        break;
      }
      case 0x0205:
        if (d.length >= 8) {
          const v = d[6]!;
          const isErr = d[7]! === 1;
          const ERR: Record<number, string> = {
            0: '#ПУСТО!',
            7: '#ДЕЛ/0!',
            15: '#ЗНАЧ!',
            23: '#ССЫЛКА!',
            29: '#ИМЯ?',
            36: '#ЧИСЛО!',
            42: '#Н/Д',
          };
          put(
            rw,
            col,
            styled({ v: isErr ? (ERR[v] ?? '#Н/Д') : v ? 'ИСТИНА' : 'ЛОЖЬ', al: 'c' }, xfi),
          );
        }
        break;
      case 0x0006:
        if (d.length >= 14) {
          if (d[12] === 0xff && d[13] === 0xff) {
            const t = d[6];
            if (t === 0) pendingFormula = { r: rw, c: col, xf: xfi };
            else if (t === 1) put(rw, col, styled({ v: d[8] ? 'ИСТИНА' : 'ЛОЖЬ', al: 'c' }, xfi));
            else if (t === 2) put(rw, col, styled({ v: '#ЗНАЧ!', al: 'c' }, xfi));
          } else put(rw, col, num(rdv.getFloat64(6, true), xfi));
        }
        break;
      case 0x0207:
        if (pendingFormula && d.length >= 3)
          put(pendingFormula.r, pendingFormula.c, str(xlString(d, 0).s, pendingFormula.xf));
        pendingFormula = null;
        break;
      case 0x00e5: {
        const n = d.length >= 2 ? rdv.getUint16(0, true) : 0;
        for (let k = 0; k < n && 2 + k * 8 + 8 <= d.length; k++) {
          const o = 2 + k * 8;
          const r1 = rdv.getUint16(o, true);
          const c1 = rdv.getUint16(o + 4, true);
          if (r1 < SHEET_MAX_ROWS && c1 < SHEET_MAX_COLS)
            merges.push([
              r1,
              c1,
              Math.min(rdv.getUint16(o + 2, true), SHEET_MAX_ROWS - 1),
              Math.min(rdv.getUint16(o + 6, true), SHEET_MAX_COLS - 1),
            ]);
        }
        break;
      }
    }
  }
  for (const m of merges) maxCol = Math.max(maxCol, m[3]);
  const width = Math.min(SHEET_MAX_COLS, maxCol + 1);
  const cols = Array.from({ length: width }, () => defPx);
  for (const c of colDef) for (let i = c.min; i <= c.max && i < width; i++) cols[i] = c.px;
  return {
    name: meta.name,
    cols,
    rows,
    heights,
    hiddenRows,
    merges,
    totalRows: Math.max(rows.length, maxRow + 1, dimRows),
    colsCut,
  };
}
