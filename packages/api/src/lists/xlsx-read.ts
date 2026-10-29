import { inflateRawSync } from 'node:zlib';

/**
 * Чтение загруженной таблицы (ТЗ «Ввод из Excel»: «выбор файла или перетаскивание»): первый лист файла
 * .xlsx (Excel, LibreOffice, Google Таблицы) или CSV — строками значений ячеек. Как и выгрузка
 * (`xlsx.ts`), без библиотеки: архив ZIP и XML листа разбираются здесь, формулы не вычисляются (берётся
 * сохранённое значение). Пределы защищают сервер от «архивной бомбы» и огромных листов: распакованный
 * файл — не больше 64 МБ, ячеек — не больше `maxCells`.
 */

export type SheetCell = string | number | null;

/** Файл не читается как таблица: код — ключ словаря `err.<код>`. */
export class SheetReadError extends Error {
  constructor(readonly code: 'file_unreadable' | 'file_too_big') {
    super(code);
  }
}

const MAX_UNPACKED = 64 * 1024 * 1024;
const DEFAULT_MAX_CELLS = 500_000;
/** Строк и столбцов на листе Excel: адрес дальше — файл испорчен. */
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
/** Пустая строка листа — одна на все пропуски. */
const EMPTY_ROW: SheetCell[] = [];

interface ZipEntry {
  name: string;
  method: number;
  packed: number;
  size: number;
  offset: number;
}

/** Оглавление архива ZIP: имена, сжатие, размеры и где лежат данные. */
function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  // Конец центрального каталога: последние 22 байта плюс комментарий до 64 КБ.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SheetReadError('file_unreadable');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) {
      throw new SheetReadError('file_unreadable');
    }
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, {
      name,
      method: buf.readUInt16LE(at + 10),
      packed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

/** Файл из архива текстом; распакованный размер ограничен. */
function zipText(buf: Buffer, entry: ZipEntry, budget: { left: number }): string {
  const at = entry.offset;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) {
    throw new SheetReadError('file_unreadable');
  }
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const packed = buf.subarray(start, start + entry.packed);
  let data: Buffer;
  if (entry.method === 0) data = packed;
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(packed, { maxOutputLength: Math.max(1, budget.left) });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new SheetReadError('file_too_big');
      }
      throw new SheetReadError('file_unreadable');
    }
  } else throw new SheetReadError('file_unreadable');
  budget.left -= data.length;
  if (budget.left < 0) throw new SheetReadError('file_too_big');
  return data.toString('utf8');
}

/** Текст XML без разметки: сущности &lt; &amp; &#1234; &#x4F; — в символы. */
export function xmlUnescape(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Значение атрибута открывающего тега. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]!) : undefined;
}

/** Текст элемента строки: все `<t>` подряд, кроме фонетических подсказок `<rPh>`. */
function richText(xml: string): string {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of plain.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
    out += xmlUnescape(m[1] ?? '');
  }
  return out;
}

/** Номер столбца из адреса ячейки: «C5» → 2. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/** Путь первого листа книги: по `workbook.xml` и его связям. */
function firstSheetPath(entries: Map<string, ZipEntry>, buf: Buffer, budget: { left: number }) {
  const workbook = entries.get('xl/workbook.xml');
  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const sheet = /<(?:\w+:)?sheet\b[^>]*>/.exec(zipText(buf, workbook, budget))?.[0];
    const id = sheet && (attr(sheet, 'r:id') ?? attr(sheet, '\\w+:id'));
    if (id) {
      for (const m of zipText(buf, rels, budget).matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], 'Id') !== id) continue;
        const target = attr(m[0], 'Target') ?? '';
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        if (entries.has(path)) return path;
      }
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  throw new SheetReadError('file_unreadable');
}

/** Первый лист файла .xlsx — строками: индекс строки — номер строки Excel минус 1. */
export function readXlsxRows(buf: Buffer, maxCells = DEFAULT_MAX_CELLS): SheetCell[][] {
  const entries = zipEntries(buf);
  const budget = { left: MAX_UNPACKED };
  const sheetPath = firstSheetPath(entries, buf, budget);
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedEntry) {
    for (const m of zipText(buf, sharedEntry, budget).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
      shared.push(richText(m[1] ?? ''));
    }
  }
  const xml = zipText(buf, entries.get(sheetPath)!, budget);
  const data = /<sheetData>([\s\S]*)<\/sheetData>/.exec(xml)?.[1] ?? '';
  const rows: SheetCell[][] = [];
  let cells = 0;
  let nextRow = 0;
  for (const rowMatch of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rowMatch[1]!, 'r');
    const rowIndex = r ? Number(r) - 1 : nextRow;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) {
      throw new SheetReadError('file_unreadable');
    }
    nextRow = rowIndex + 1;
    const row: SheetCell[] = [];
    let nextCol = 0;
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1]!;
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref) : nextCol;
      nextCol = col + 1;
      if (col < 0 || col >= MAX_COLUMNS) throw new SheetReadError('file_unreadable');
      const body = c[2] ?? '';
      const type = attr(tag, 't') ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: SheetCell = null;
      if (type === 's') value = v === undefined ? null : (shared[Number(v)] ?? null);
      else if (type === 'inlineStr') value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (type === 'str' || type === 'e') value = v === undefined ? null : xmlUnescape(v);
      else if (type === 'b') value = v === undefined ? null : v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined && v.trim() !== '') {
        const n = Number(v);
        value = Number.isFinite(n) ? n : xmlUnescape(v);
      }
      if (value === null || value === '') continue;
      if (++cells > maxCells) throw new SheetReadError('file_too_big');
      row[col] = value;
    }
    if (row.length) rows[rowIndex] = row;
  }
  return Array.from(rows, (row) => (row ? Array.from(row, (v) => v ?? null) : EMPTY_ROW));
}

/**
 * CSV — строками: разделитель — «;», «,» или табуляция (какого больше в первой строке), кавычки
 * по RFC 4180. Кодировка UTF-8 (с BOM или без); не UTF-8 — Windows-1251, как сохраняет Excel.
 */
export function readCsvRows(buf: Buffer, maxCells = DEFAULT_MAX_CELLS): SheetCell[][] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1251').decode(buf);
  }
  text = text.replace(/^\ufeff/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', ',', '\t'].reduce((best, s) =>
    firstLine.split(s).length > firstLine.split(best).length ? s : best,
  );
  const rows: SheetCell[][] = [];
  let row: SheetCell[] = [];
  let field = '';
  let quoted = false;
  let cells = 0;
  const push = () => {
    if (++cells > maxCells) throw new SheetReadError('file_too_big');
    row.push(field === '' ? null : field);
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    push();
    rows.push(row);
  }
  return rows;
}

/** Таблица из файла: .xlsx — по подписи архива ZIP, иначе — CSV. */
export function readSheetRows(buf: Buffer, maxCells = DEFAULT_MAX_CELLS): SheetCell[][] {
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  return isZip ? readXlsxRows(buf, maxCells) : readCsvRows(buf, maxCells);
}
