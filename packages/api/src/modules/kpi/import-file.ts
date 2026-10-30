import type { ImportTemplateCell } from '@buhuchet/domain';
import { columnName, xmlText, zip } from '../../lists/xlsx';

/*
 * Файл шаблона «Ввода из Excel» (задача 2.28; ТЗ «Шаг 1 «Скачать шаблон»»; прототип `kxTplBlob`): лист
 * «Показатели» — заголовки, ИНН и название защищены, ячейки невключённых показателей серые и защищены,
 * проверенные значения — зелёные; лист защищён без пароля (менять можно только ячейки ввода и ширину
 * столбцов), первые два столбца и строка заголовков закреплены. Второй лист — «Подсказки». Архив
 * собирается так же, как выгрузка списка (`lists/xlsx.ts`), без библиотеки.
 */

export interface TemplateRow {
  inn: string;
  name: string;
  /** Значения ячеек ввода — в единицах показателя (сотые / 100). */
  cells: ImportTemplateCell[];
}

export interface TemplateBook {
  sheet: string;
  tipsSheet: string;
  head: readonly string[];
  rows: readonly TemplateRow[];
  tips: readonly string[];
}

/** Стили ячеек: номер — индекс в `cellXfs` (как в прототипе, core/xlsx.js `XL_ST`). */
const S = { head: 1, input: 2, off: 3, checked: 4, key: 5, wrap: 6 } as const;

const fill = (rgb: string) =>
  `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const side = (name: string) => `<${name} style="thin"><color rgb="FFBFBFBF"/></${name}>`;

/**
 * Заголовки — жирным на сером, ИНН и название — текстом на голубом, невключённые — серые, проверенные —
 * зелёные; ячейки ввода и проверенные не защищены, число — «1 250 000,50» (формат 4), рамки — тонкие.
 */
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `${fill('E7E6E6')}${fill('E2EFDA')}${fill('DDEBF7')}</fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="7">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>` +
  `<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const text = (ref: string, value: string, style: number) =>
  `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;

function cellXml(ref: string, cell: ImportTemplateCell): string {
  if (cell.kind === 'off') return `<c r="${ref}" s="${S.off}"/>`;
  const style = cell.kind === 'checked' ? S.checked : S.input;
  if (cell.value === null) return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" s="${style}"><v>${cell.value / 100}</v></c>`;
}

function mainSheet(book: TemplateBook): string {
  const head = `<row r="1">${book.head.map((h, i) => text(`${columnName(i)}1`, h, S.head)).join('')}</row>`;
  const body = book.rows
    .map((row, r) => {
      const n = r + 2;
      return (
        `<row r="${n}">${text(`A${n}`, row.inn, S.key)}${text(`B${n}`, row.name, S.key)}` +
        `${row.cells.map((cell, j) => cellXml(`${columnName(j + 2)}${n}`, cell)).join('')}</row>`
      );
    })
    .join('');
  const widths = book.head.map((_, i) => (i === 0 ? 18 : i === 1 ? 34 : 20));
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
    `<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>` +
    `<selection pane="bottomRight" activeCell="C2" sqref="C2"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>` +
    `<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" sort="0" autoFilter="0"/>` +
    `</worksheet>`
  );
}

function tipsSheet(tips: readonly string[]): string {
  const rows = tips
    .map((tip, r) => `<row r="${r + 1}">${tip ? text(`A${r + 1}`, tip, S.wrap) : ''}</row>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<cols><col min="1" max="1" width="110" customWidth="1"/></cols>` +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** Имя листа: без `[]:*?/\`, не длиннее 31 символа. */
const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
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
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

/** Файл шаблона .xlsx: лист «Показатели» и лист «Подсказки». */
export function buildImportTemplate(book: TemplateBook): Promise<Buffer> {
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlText(sheetName(book.sheet))}" sheetId="1" r:id="rId1"/>` +
    `<sheet name="${xmlText(sheetName(book.tipsSheet))}" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  const file = (path: string, xml: string) => ({ name: path, data: Buffer.from(xml, 'utf8') });
  return zip([
    file('[Content_Types].xml', CONTENT_TYPES),
    file('_rels/.rels', ROOT_RELS),
    file('xl/workbook.xml', workbook),
    file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS),
    file('xl/styles.xml', STYLES),
    file('xl/worksheets/sheet1.xml', mainSheet(book)),
    file('xl/worksheets/sheet2.xml', tipsSheet(book.tips)),
  ]);
}
