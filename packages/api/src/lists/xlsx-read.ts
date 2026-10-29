import { inflateRawSync } from 'node:zlib';

/**
 * Чтение загруженной таблицы (ТЗ «Ввод из Excel»: «выбор файла или перетаскивание»): первый лист файла
 * .xlsx (Excel, LibreOffice, Google Таблицы) или CSV — строками значений ячеек. Как и выгрузка
 * (`xlsx.ts`), без библиотеки: архив ZIP и XML листа разбираются здесь, формулы не вычисляются (берётся
 * сохранённое значение). Файл присылает пользователь, поэтому разбор — один проход по тегам без
 * регулярных выражений по всему XML (время растёт линейно с размером файла), а пределы защищают сервер
 * от «архивной бомбы» и огромных листов: распакованный файл — не больше 64 МБ, строк, столбцов и ячеек —
 * не больше `SheetLimits`, текст ячейки — не длиннее `SHEET_TEXT_MAX_LENGTH`.
 */

export type SheetCell = string | number | null;

/**
 * Файл не читается как таблица: `file_unreadable` — не .xlsx и не CSV или испорчен, `sheet_too_big` —
 * больше пределов `SheetLimits` или распакованный больше 64 МБ.
 */
export class SheetReadError extends Error {
  constructor(readonly code: 'file_unreadable' | 'sheet_too_big') {
    super(code);
  }
}

/** Пределы листа: больше — `sheet_too_big`. */
export interface SheetLimits {
  /** Строк — по номеру последней, с пустыми. */
  rows: number;
  /** Столбцов — по адресу самой правой ячейки. */
  columns: number;
  /** Непустых ячеек. */
  cells: number;
  /** Ячеек вместе с пустыми до последней непустой в каждой строке: столько займут строки в памяти. */
  area: number;
}

/**
 * Пределы по умолчанию: с запасом для шаблона «Ввода из Excel» (до 1 000 контрагентов, 24 месяцев и
 * нескольких десятков показателей).
 */
export const DEFAULT_SHEET_LIMITS: SheetLimits = {
  rows: 5_000,
  columns: 4_096,
  cells: 500_000,
  area: 2_000_000,
};

/** Текст ячейки — не длиннее: длиннее обрезается и кончается «…» (названия и заголовки короче). */
export const SHEET_TEXT_MAX_LENGTH = 1_000;
/** Сколько символов XML читается для текста ячейки: сущность «&#x10FFFF;» — 10 символов на один. */
const TEXT_RAW_MAX_LENGTH = SHEET_TEXT_MAX_LENGTH * 10;

const MAX_UNPACKED = 64 * 1024 * 1024;
/** Строк и столбцов на листе Excel: адрес дальше — файл испорчен. */
const EXCEL_ROWS = 1_048_576;
const EXCEL_COLUMNS = 16_384;
/** Пустая строка листа — одна на все пропуски. */
const EMPTY_ROW: SheetCell[] = [];

const unreadable = () => new SheetReadError('file_unreadable');
const tooBig = () => new SheetReadError('sheet_too_big');

const limitsOf = (limits: Partial<SheetLimits>): SheetLimits => ({
  ...DEFAULT_SHEET_LIMITS,
  ...limits,
});

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
  if (end < 0) throw unreadable();
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw unreadable();
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
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) throw unreadable();
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const packed = buf.subarray(start, start + entry.packed);
  let data: Buffer;
  if (entry.method === 0) data = packed;
  else if (entry.method === 8) {
    try {
      data = inflateRawSync(packed, { maxOutputLength: Math.max(1, budget.left) });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw tooBig();
      throw unreadable();
    }
  } else throw unreadable();
  budget.left -= data.length;
  if (budget.left < 0) throw tooBig();
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

/** Текст не длиннее предела: длиннее — обрезан, в конце «…». */
function clip(text: string): string {
  return text.length > SHEET_TEXT_MAX_LENGTH ? `${text.slice(0, SHEET_TEXT_MAX_LENGTH)}…` : text;
}

/** Текст ячейки из XML: сущности — в символы, длина — не больше предела. */
function cellText(raw: string): string {
  if (raw.length <= TEXT_RAW_MAX_LENGTH) return clip(xmlUnescape(raw));
  return `${xmlUnescape(raw.slice(0, TEXT_RAW_MAX_LENGTH)).slice(0, SHEET_TEXT_MAX_LENGTH)}…`;
}

/** Текст из нескольких кусков (`<t>` форматированного текста): после предела куски не добавляются. */
function appendText(text: string, raw: string): string {
  return text.length > SHEET_TEXT_MAX_LENGTH ? text : text + cellText(raw);
}

/**
 * Значение атрибута в тексте тега после имени: `r="A1" t='s'`. Имя с «:» в начале — с любой приставкой
 * (`:id` — `r:id`). Один проход по тексту тега.
 */
function attrOf(tag: string, name: string): string | undefined {
  let at = 0;
  for (;;) {
    const eq = tag.indexOf('=', at);
    if (eq < 0) return undefined;
    let open = eq + 1;
    while (open < tag.length && tag.charCodeAt(open) <= 32) open++;
    const quote = tag[open];
    if (quote !== '"' && quote !== "'") return undefined;
    const close = tag.indexOf(quote, open + 1);
    if (close < 0) return undefined;
    const key = tag.slice(at, eq).trim();
    if (key === name || (name[0] === ':' && key.endsWith(name))) {
      return xmlUnescape(tag.slice(open + 1, close));
    }
    at = close + 1;
  }
}

/**
 * Проход по тегам XML: `next()` переходит к следующему тегу. Каждый символ просматривается не больше двух
 * раз (поиск «<», затем «>»), поэтому время линейно при любом содержимом файла.
 */
class XmlTags {
  /** Имя тега без приставки пространства имён: «x:row» → «row». */
  name = '';
  /** `</row>`. */
  closing = false;
  /** `<row/>`. */
  selfClosing = false;
  private at = 0;
  private textStart = 0;
  private lt = 0;
  private nameEnd = 0;
  private gt = 0;

  constructor(private readonly xml: string) {}

  next(): boolean {
    const { xml } = this;
    const lt = xml.indexOf('<', this.at);
    if (lt < 0) return false;
    const gt = xml.indexOf('>', lt);
    if (gt < 0) throw unreadable();
    this.textStart = this.at;
    this.lt = lt;
    this.gt = gt;
    this.at = gt + 1;
    this.closing = xml.charCodeAt(lt + 1) === 47;
    this.selfClosing = xml.charCodeAt(gt - 1) === 47;
    let start = lt + (this.closing ? 2 : 1);
    let end = start;
    while (end < gt) {
      const ch = xml.charCodeAt(end);
      if (ch <= 32 || ch === 47) break;
      if (ch === 58) start = end + 1;
      end++;
    }
    this.nameEnd = end;
    this.name = xml.slice(start, end);
    return true;
  }

  /** Текст между предыдущим тегом и этим. */
  text(): string {
    return this.xml.slice(this.textStart, this.lt);
  }

  /** Атрибут тега. */
  attr(name: string): string | undefined {
    return attrOf(this.xml.slice(this.nameEnd, this.gt), name);
  }
}

/** Номер столбца из адреса ячейки: «C5» → 2; больше трёх букв — за пределами листа Excel. */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length && i < 4; i++) {
    const code = ref.charCodeAt(i);
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
    let id: string | undefined;
    const book = new XmlTags(zipText(buf, workbook, budget));
    while (!id && book.next()) {
      if (book.name === 'sheet' && !book.closing) id = book.attr(':id');
    }
    const links = new XmlTags(id ? zipText(buf, rels, budget) : '');
    while (links.next()) {
      if (links.name !== 'Relationship' || links.closing || links.attr('Id') !== id) continue;
      const target = links.attr('Target') ?? '';
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      if (entries.has(path)) return path;
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  throw unreadable();
}

/** Общие строки книги (`sharedStrings.xml`): текст `<si>` — все `<t>` подряд, кроме подсказок `<rPh>`. */
function sharedStrings(xml: string, limits: SheetLimits): string[] {
  const tags = new XmlTags(xml);
  const out: string[] = [];
  let open = false;
  let phonetic = false;
  let text = '';
  while (tags.next()) {
    if (tags.name === 'si') {
      if (tags.closing) {
        if (!open) throw unreadable();
        out.push(clip(text));
        open = false;
      } else if (tags.selfClosing) out.push('');
      else {
        if (open) throw unreadable();
        open = true;
        text = '';
      }
      // Общих строк не больше, чем ячеек.
      if (out.length > limits.cells) throw tooBig();
    } else if (tags.name === 'rPh') phonetic = !tags.closing && !tags.selfClosing;
    else if (tags.name === 't' && tags.closing && open && !phonetic) {
      text = appendText(text, tags.text());
    }
  }
  if (open) throw unreadable();
  return out;
}

/** Лист: строки `<sheetData>` — значения ячеек по адресам. */
function sheetRows(xml: string, shared: readonly string[], limits: SheetLimits): SheetCell[][] {
  const tags = new XmlTags(xml);
  for (;;) {
    if (!tags.next()) return [];
    if (tags.name === 'sheetData' && !tags.closing) break;
  }
  if (tags.selfClosing) return [];
  const rows: SheetCell[][] = [];
  let cells = 0;
  let area = 0;
  let nextRow = 0;
  let row: SheetCell[] | null = null;
  let rowIndex = 0;
  let nextCol = 0;
  // Открытая ячейка: столбец, тип, `<v>` и текст `<is>`.
  let inCell = false;
  let col = 0;
  let type = 'n';
  let v: string | undefined;
  let inline = '';
  let inInline = false;
  let phonetic = false;
  const cellValue = (): SheetCell => {
    if (type === 's') return v === undefined ? null : (shared[Number(v)] ?? null);
    if (type === 'inlineStr') return clip(inline);
    if (type === 'str' || type === 'e') return v === undefined ? null : cellText(v);
    if (type === 'b') return v === undefined ? null : v.trim() === '1' ? 'TRUE' : 'FALSE';
    if (v === undefined || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : cellText(v);
  };
  while (tags.next()) {
    // Имя — заново после `next()`: сужение типа выше к нему не относится.
    switch (tags.name as string) {
      case 'sheetData':
        if (!tags.closing || row) throw unreadable();
        return Array.from(rows, (r) => (r ? Array.from(r, (x) => x ?? null) : EMPTY_ROW));
      case 'row': {
        if (tags.closing) {
          if (!row || inCell) throw unreadable();
          if (row.length) {
            area += row.length;
            if (area > limits.area) throw tooBig();
            rows[rowIndex] = row;
          }
          row = null;
          break;
        }
        if (row) throw unreadable();
        const r = tags.attr('r');
        rowIndex = r === undefined ? nextRow : Number(r) - 1;
        if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= EXCEL_ROWS) {
          throw unreadable();
        }
        if (rowIndex >= limits.rows) throw tooBig();
        nextRow = rowIndex + 1;
        nextCol = 0;
        if (!tags.selfClosing) row = [];
        break;
      }
      case 'c': {
        if (tags.closing) {
          if (!inCell || !row) throw unreadable();
          inCell = false;
          const value = cellValue();
          if (value === null || value === '') break;
          if (++cells > limits.cells) throw tooBig();
          row[col] = value;
          break;
        }
        if (!row || inCell) throw unreadable();
        const ref = tags.attr('r');
        col = ref ? columnIndex(ref) : nextCol;
        if (col < 0 || col >= EXCEL_COLUMNS) throw unreadable();
        if (col >= limits.columns) throw tooBig();
        nextCol = col + 1;
        type = tags.attr('t') ?? 'n';
        v = undefined;
        inline = '';
        inInline = false;
        phonetic = false;
        inCell = !tags.selfClosing;
        break;
      }
      case 'v':
        if (tags.closing && inCell) v = tags.text();
        break;
      case 'is':
        inInline = inCell && !tags.closing && !tags.selfClosing;
        break;
      case 'rPh':
        phonetic = !tags.closing && !tags.selfClosing;
        break;
      case 't':
        if (tags.closing && inInline && !phonetic) inline = appendText(inline, tags.text());
        break;
    }
  }
  throw unreadable();
}

/** Первый лист файла .xlsx — строками: индекс строки — номер строки Excel минус 1. */
export function readXlsxRows(buf: Buffer, limits: Partial<SheetLimits> = {}): SheetCell[][] {
  const lim = limitsOf(limits);
  const entries = zipEntries(buf);
  const budget = { left: MAX_UNPACKED };
  const sheetPath = firstSheetPath(entries, buf, budget);
  const sharedEntry = entries.get('xl/sharedStrings.xml');
  const shared = sharedEntry ? sharedStrings(zipText(buf, sharedEntry, budget), lim) : [];
  return sheetRows(zipText(buf, entries.get(sheetPath)!, budget), shared, lim);
}

/**
 * CSV — строками: разделитель — «;», «,» или табуляция (какого больше в первой строке), кавычки
 * по RFC 4180. Кодировка UTF-8 (с BOM или без); не UTF-8 — Windows-1251, как сохраняет Excel.
 */
export function readCsvRows(buf: Buffer, limits: Partial<SheetLimits> = {}): SheetCell[][] {
  const lim = limitsOf(limits);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1251').decode(buf);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lineEnd = text.search(/[\r\n]/);
  const firstLine = lineEnd < 0 ? text : text.slice(0, lineEnd);
  const count = (s: string) => {
    let n = 0;
    for (let i = firstLine.indexOf(s); i >= 0; i = firstLine.indexOf(s, i + 1)) n++;
    return n;
  };
  const sep = [';', ',', '\t'].reduce((best, s) => (count(s) > count(best) ? s : best));
  const rows: SheetCell[][] = [];
  let row: SheetCell[] = [];
  let field = '';
  let quoted = false;
  let cells = 0;
  let area = 0;
  const push = () => {
    if (row.length >= lim.columns || ++area > lim.area) throw tooBig();
    if (field !== '' && ++cells > lim.cells) throw tooBig();
    row.push(field === '' ? null : clip(field));
    field = '';
  };
  const endRow = () => {
    push();
    if (rows.length >= lim.rows) throw tooBig();
    rows.push(row);
    row = [];
  };
  // Длиннее предела поле не растёт: `clip` всё равно обрежет.
  const add = (ch: string) => {
    if (field.length <= SHEET_TEXT_MAX_LENGTH) field += ch;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        add('"');
        i++;
      } else if (ch === '"') quoted = false;
      else add(ch);
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else add(ch);
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Таблица из файла: .xlsx — по подписи архива ZIP, иначе — CSV. */
export function readSheetRows(buf: Buffer, limits: Partial<SheetLimits> = {}): SheetCell[][] {
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  return isZip ? readXlsxRows(buf, limits) : readCsvRows(buf, limits);
}
