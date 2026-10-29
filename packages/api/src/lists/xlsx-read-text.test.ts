import { describe, expect, it } from 'vitest';
import { zip } from './xlsx';
import { readCsvRows, readSheetRows, readXlsxRows, SHEET_TEXT_MAX_LENGTH } from './xlsx-read';

// Свой предел длины текста ячейки (`SheetLimits.text`): загрузке справочников платформы (задача 2.37)
// нужны пояснения до 2 000 знаков, «Вводу из Excel» хватает 1 000.

/** Книга из одного листа с общими строками. */
function book(sheet: string, shared: string) {
  const file = (name: string, xml: string) => ({ name, data: Buffer.from(xml, 'utf8') });
  return zip([
    file(
      'xl/workbook.xml',
      '<workbook xmlns:r="r"><sheets><sheet name="Лист" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
    file('xl/sharedStrings.xml', `<sst><si><t>${shared}</t></si></sst>`),
  ]);
}

describe('чтение таблицы: предел длины текста ячейки', () => {
  it('по умолчанию — 1 000 знаков, со своим пределом — длиннее; длиннее предела — с «…»', async () => {
    const long = 'я'.repeat(3_000);
    const file = await book(
      '<row r="1"><c r="A1" t="s"><v>0</v></c>' +
        `<c r="B1" t="inlineStr"><is><t>${long}</t><t>!</t></is></c>` +
        `<c r="C1" t="str"><v>${'&amp;'.repeat(2_500)}</v></c>` +
        `<c r="D1" t="inlineStr"><is><t>${'ё'.repeat(1_500)}</t></is></c></row>`,
      long,
    );
    const lengths = (rows: unknown[][]) => rows[0]!.map((v) => String(v).length);
    expect(lengths(readXlsxRows(file))).toEqual(Array(4).fill(SHEET_TEXT_MAX_LENGTH + 1));
    const wide = readSheetRows(file, { text: 2_000 });
    expect(lengths(wide)).toEqual([2_001, 2_001, 2_001, 1_500]);
    expect(wide[0]![2]).toBe(`${'&'.repeat(2_000)}…`);
    expect(wide[0]![3]).toBe('ё'.repeat(1_500));

    const csv = Buffer.from(`Код;"${long}";${'ё'.repeat(1_500)}\n`);
    expect(lengths(readCsvRows(csv))).toEqual([3, 1_001, 1_001]);
    expect(lengths(readCsvRows(csv, { text: 2_000 }))).toEqual([3, 2_001, 1_500]);
  });
});
