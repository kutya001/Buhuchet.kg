import { crc32 } from 'node:zlib';

// Маленькие настоящие файлы для окна просмотра (доработки 16.11.2026, блок 5): книга Excel из двух
// листов, текст в Windows-1251, XML с внешней сущностью, старый DOC, PDF и картинка PNG.

/** ZIP без сжатия: XLSX — это ZIP с XML внутри. */
function zipStored(files: { name: string; data: string }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${NS_R}/${type}" Target="${target}"/>`;
const rels = (items: string[]) =>
  `${HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;

/** Названия листов книги `xlsxTwoSheets`. */
export const XLSX_SHEETS = ['Отчёт', 'Журнал'] as const;

/**
 * Книга из двух листов: «Отчёт» — заголовки жирным, A2 «НДС за октябрь», B2 — 1250.5 в формате
 * «#,##0.00» (в окне — «1 250,50»); «Журнал» — A1 «Журнал записей».
 */
export function xlsxTwoSheets(): Buffer {
  const shared = ['Налог', 'Сумма', 'Журнал записей'];
  const sheet1 = `${HDR}<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>НДС за октябрь</t></is></c><c r="B2" s="2"><v>1250.5</v></c></row></sheetData></worksheet>`;
  const sheet2 = `${HDR}<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row></sheetData></worksheet>`;
  const styles = `${HDR}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  const sst = `${HDR}<sst xmlns="${NS}" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
  const workbook = `${HDR}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>${XLSX_SHEETS.map(
    (name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
  ).join('')}</sheets></workbook>`;
  return zipStored([
    {
      name: '[Content_Types].xml',
      data: `${HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    },
    { name: '_rels/.rels', data: rels([rel('rId1', 'officeDocument', 'xl/workbook.xml')]) },
    { name: 'xl/workbook.xml', data: workbook },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: rels([
        rel('rId1', 'worksheet', 'worksheets/sheet1.xml'),
        rel('rId2', 'worksheet', 'worksheets/sheet2.xml'),
        rel('rId3', 'styles', 'styles.xml'),
        rel('rId4', 'sharedStrings', 'sharedStrings.xml'),
      ]),
    },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ]);
}

/** Текст в Windows-1251 (кириллица А–я, Ё и ё; остальное — ASCII). */
export function win1251(text: string): Buffer {
  return Buffer.from(
    [...text].map((ch) => {
      const c = ch.codePointAt(0) ?? 0x3f;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      if (c === 0x401) return 0xa8;
      if (c === 0x451) return 0xb8;
      return c < 0x80 ? c : 0x3f;
    }),
  );
}

/** Адрес внешней сущности XML: окно не должно к нему обращаться. */
export const XML_EXTERNAL = 'http://127.0.0.1:9/secret.txt';

/** Отчёт XML с объявлением DOCTYPE и внешней сущностью `&ext;`. */
export const xmlWithEntity = () =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Report [<!ENTITY ext SYSTEM "${XML_EXTERNAL}">]>\n<Report><Org inn="01234567890123">ОсОО «Тест»</Org><Note>&ext;</Note></Report>`,
    'utf8',
  );

/** Начало файла Word 97–2003 (составной документ OLE): окно его не разбирает — только «Скачать». */
export const oldDoc = () =>
  Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(2040),
  ]);

/** Самый короткий PDF: окну хватает заголовка `%PDF-`. */
export const tinyPdf = () =>
  Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'latin1',
  );

/** Картинка PNG 1×1. */
export const tinyPng = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
