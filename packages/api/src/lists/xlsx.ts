import { promisify } from 'node:util';
import { crc32, deflateRaw } from 'node:zlib';

/** Сжатие в пуле потоков Node.js: большой файл не останавливает ответы на другие запросы. */
const deflate = promisify(deflateRaw);

/**
 * Файл Excel (.xlsx) для выгрузки списка (ТЗ «Экспорт в Excel всех отфильтрованных записей; файл
 * формируется на сервере»): один лист, первая строка — заголовки жирным, закреплена и с фильтром;
 * текст — строками прямо в ячейке (формулы не вычисляются, поэтому «=…» в данных остаётся текстом),
 * числа — числами, деньги — в сомах с форматом «1 250,50». Архив ZIP собирается здесь же: библиотека
 * для одного листа без формул не нужна.
 */

export type XlsxCell = string | number | null;

export interface XlsxColumn {
  title: string;
  /** `money` — число в тыйынах, в файле — сомы с двумя знаками; `number` — как есть. */
  kind: 'text' | 'number' | 'money';
  /** Ширина в символах; без неё — по заголовку и первым строкам. */
  width?: number;
}

const STYLE_HEADER = 1;
const STYLE_MONEY = 2;

/** Символы, которых не может быть в XML 1.0 (управляющие, кроме табуляции и переводов строки). */
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function xmlText(value: string): string {
  return value
    .replace(XML_INVALID, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Имя столбца Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Имя листа: без `[]:*?/\`, не длиннее 31 символа. */
function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1';
}

function cellXml(ref: string, value: XlsxCell, kind: XlsxColumn['kind'], header = false): string {
  if (value === null || value === '') return '';
  if (typeof value === 'number' && !header) {
    if (!Number.isFinite(value)) return '';
    if (kind === 'money') return `<c r="${ref}" s="${STYLE_MONEY}"><v>${value / 100}</v></c>`;
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  const style = header ? ` s="${STYLE_HEADER}"` : '';
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlText(String(value))}</t></is></c>`;
}

function widthOf(column: XlsxColumn, rows: readonly XlsxCell[][], index: number): number {
  if (column.width) return column.width;
  let max = column.title.length;
  for (const row of rows.slice(0, 200)) {
    const v = row[index];
    if (v != null) max = Math.max(max, String(v).length);
  }
  return Math.min(60, Math.max(8, max + 2));
}

function sheetXml(columns: readonly XlsxColumn[], rows: readonly XlsxCell[][]): string {
  const last = columnName(Math.max(0, columns.length - 1));
  const header = `<row r="1">${columns
    .map((c, i) => cellXml(`${columnName(i)}1`, c.title, 'text', true))
    .join('')}</row>`;
  const body = rows
    .map((row, r) => {
      const n = r + 2;
      return `<row r="${n}">${columns
        .map((c, i) => cellXml(`${columnName(i)}${n}`, row[i] ?? null, c.kind))
        .join('')}</row>`;
    })
    .join('');
  const cols = columns
    .map(
      (c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c, rows, i)}" customWidth="1"/>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${header}${body}</sheetData>` +
    (columns.length ? `<autoFilter ref="A1:${last}${rows.length + 1}"/>` : '') +
    `</worksheet>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookXml(name: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
}

/** Дата и время файлов в архиве — 01.01.2026 00:00 (формат MS-DOS): файл зависит только от данных. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Архив ZIP (сжатие deflate) из файлов с ASCII-именами. */
export async function zip(files: readonly { name: string; data: Buffer }[]): Promise<Buffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const packedAll = await Promise.all(files.map((file) => deflate(file.data)));
  for (const [i, file] of files.entries()) {
    const name = Buffer.from(file.name, 'ascii');
    const packed = packedAll[i]!;
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, directory, end]);
}

/** Файл .xlsx с одним листом `name`: заголовки `columns` и строки `rows` (значения по столбцам). */
export function buildXlsx(
  name: string,
  columns: readonly XlsxColumn[],
  rows: readonly XlsxCell[][],
): Promise<Buffer> {
  const file = (path: string, xml: string) => ({ name: path, data: Buffer.from(xml, 'utf8') });
  return zip([
    file('[Content_Types].xml', CONTENT_TYPES),
    file('_rels/.rels', ROOT_RELS),
    file('xl/workbook.xml', workbookXml(name)),
    file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS),
    file('xl/styles.xml', STYLES),
    file('xl/worksheets/sheet1.xml', sheetXml(columns, rows)),
  ]);
}

/** MIME-тип файла .xlsx. */
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
