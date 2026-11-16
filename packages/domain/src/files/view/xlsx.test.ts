import { describe, expect, it } from 'vitest';
import { xlsxBytes, zipBytes } from './fixtures';
import { parseFileView } from './index';
import {
  cellRef,
  colIndex,
  colLetters,
  csvSheet,
  looksNumeric,
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
} from './sheet';
import { parseWorksheet, parseXlsx, sheetCell } from './xlsx';
import { ViewError } from './xml';
import { openZip } from './zip';

const NB = '\u00a0';

describe('Excel XLSX в окне просмотра', () => {
  it('листы вкладками по порядку книги, скрытый лист не показывается', async () => {
    const book = await parseXlsx(
      openZip(
        await xlsxBytes([
          { name: 'Отчёт', rows: [['Контрагент', 'Сумма']] },
          { name: 'Служебный', hidden: true, rows: [['секрет']] },
          { name: 'Журнал', rows: [[1]] },
        ]),
      ),
    );
    expect(book.sheets.map((s) => s.name)).toEqual(['Отчёт', 'Журнал']);
  });

  it('числа и даты по формату ячейки, жирный, заливка, выравнивание, формулы — сохранённым значением', async () => {
    const book = await parseXlsx(
      openZip(
        await xlsxBytes([
          {
            name: 'Лист1',
            rows: [
              [
                { v: 'Итого', s: 1 },
                { v: 1250.5, s: 3 },
                { v: 46342, s: 2 },
                { v: 0.256, s: 4 },
                { v: 'центр', s: 5 },
              ],
              [
                { v: 2501, f: 'B1*2' },
                { v: 'да', f: 'IF(1,"да")' },
                true,
                42,
                null,
                'ОсОО «Ромашка»',
              ],
            ],
            merges: ['A3:C3'],
            cols: [
              { min: 1, max: 1, width: 30 },
              { min: 3, max: 3, hidden: true },
            ],
          },
        ]),
      ),
    );
    const s = book.sheets[0]!;
    expect(s.rows[0]![0]).toEqual({ v: 'Итого', b: true, color: '#C00000', bg: '#FFFF00' });
    expect(s.rows[0]![1]).toEqual({ v: `1${NB}250,50`, num: true });
    expect(s.rows[0]![2]).toEqual({ v: '16.11.2026', num: true });
    expect(s.rows[0]![3]).toEqual({ v: '25,6%', num: true });
    expect(s.rows[0]![4]).toEqual({ v: 'центр', al: 'c', wrap: true });
    expect(s.rows[1]!.slice(0, 4)).toEqual([
      { v: '2501', num: true },
      { v: 'да' },
      { v: 'ИСТИНА', al: 'c' },
      { v: '42', num: true },
    ]);
    expect(s.rows[1]![4]).toBeNull();
    expect(s.rows[1]![5]).toEqual({ v: 'ОсОО «Ромашка»' });
    expect(s.merges).toEqual([[2, 0, 2, 2]]);
    expect(s.cols[0]).toBe(215);
    expect(s.cols[1]).toBe(64);
    expect(s.cols[2]).toBe(0);
    expect(s.totalRows).toBe(2);
  });

  it('лист на 50 000 строк: показаны первые 5 000, известно, сколько всего', async () => {
    const bytes = await xlsxBytes([{ name: 'Журнал', rows: [['№', 'Описание']], bigRows: 49_999 }]);
    const t0 = Date.now();
    const s = (await parseXlsx(openZip(bytes))).sheets[0]!;
    expect(s.rows).toHaveLength(SHEET_MAX_ROWS);
    expect(s.totalRows).toBe(50_000);
    expect(s.rows[SHEET_MAX_ROWS - 1]![1]).toEqual({ v: `Строка ${SHEET_MAX_ROWS}` });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('книга с макросом (XLSM): макрос не читается, внешние связи не открываются, листы показываются', async () => {
    const bytes = await xlsxBytes([{ name: 'Данные', rows: [["=cmd|' /c calc'!A1", 5]] }], {
      macro: true,
    });
    const read: string[] = [];
    const zip = openZip(bytes);
    const spy = {
      ...zip,
      read: (n: string) => (read.push(n), zip.read(n)),
      text: (n: string) => (read.push(n), zip.text(n)),
    };
    const book = await parseXlsx(spy);
    expect(book.sheets[0]!.rows[0]).toEqual([{ v: "=cmd|' /c calc'!A1" }, { v: '5', num: true }]);
    expect(read.some((n) => /vbaProject|evil/i.test(n))).toBe(false);
    const view = await parseFileView('Расчёт.xlsm', bytes);
    expect(view.kind).toBe('sheet');
  });

  it('zip-бомба внутри XLSX — ошибка, а не зависание', async () => {
    const bomb = await zipBytes([
      {
        name: '_rels/.rels',
        data: '<Relationships><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      },
      {
        name: 'xl/workbook.xml',
        data: '<workbook><sheets><sheet name="a" r:id="r1"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<Relationships><Relationship Id="r1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: new Uint8Array(16 * 1024 * 1024),
        declaredSize: 4096,
      },
    ]);
    await expect(parseFileView('бомба.xlsx', bomb)).rejects.toThrowError(new ViewError('zip_bomb'));
  });

  it('лист без r у строк и ячеек, общие строки с форматированием и подсказками, inlineStr, ошибки', () => {
    const src = `<worksheet><sheetFormatPr defaultColWidth="10"/><sheetData><row><c t="inlineStr"><is><r><t>Жир</t></r><r><t>ный</t></r><rPh><t>фонетика</t></rPh></is></c><c t="e"><v>#DIV/0!</v></c><c t="d"><v>2026-11-16</v></c><c t="d"><v>не дата</v></c></row><row ht="30" customHeight="1" hidden="1"><c t="n"><v>abc</v></c><c><v> </v></c><c/></row></sheetData></worksheet>`;
    const s = parseWorksheet('a', src, [], [], false);
    expect(s.rows[0]).toEqual([
      { v: 'Жирный' },
      { v: '#DIV/0!', al: 'c' },
      { v: '16.11.2026', num: true },
      { v: 'не дата' },
    ]);
    expect(s.rows[1]).toEqual([{ v: 'abc' }]);
    expect(s.heights).toEqual({ 1: 40 });
    expect(s.hiddenRows).toEqual([1]);
    expect(s.cols).toEqual([75, 75, 75, 75]);
    expect(sheetCell('s', '0', undefined, ['общая'], false)).toEqual({ v: 'общая' });
    expect(sheetCell('b', '0', undefined, [], false)).toEqual({ v: 'ЛОЖЬ', al: 'c' });
    expect(sheetCell(undefined, '', undefined, [], false)).toBeNull();
    expect(sheetCell('s', '9', { fmt: 'General', bg: '#FF0000' }, [], false)).toEqual({
      v: '',
      bg: '#FF0000',
    });
    expect(sheetCell('d', '2026-11-16T12:00:00', { fmt: 'dd.mm.yyyy h:mm' }, [], false)).toEqual({
      v: '16.11.2026 12:00',
      num: true,
    });
  });

  it('столбцы за пределом обрезаются, объединения после 5 000 строк и последняя строка из файла', () => {
    const far = `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="JA1"><v>2</v></c></row><row r="${SHEET_MAX_ROWS + 10}"><c r="A${SHEET_MAX_ROWS + 10}"><v>3</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B2"/><mergeCell ref="C1"/></mergeCells></worksheet>`;
    const s = parseWorksheet('a', far, [], [], false);
    expect(s.colsCut).toBe(true);
    expect(s.rows).toHaveLength(1);
    expect(s.totalRows).toBe(SHEET_MAX_ROWS + 10);
    expect(s.merges).toEqual([
      [0, 0, 1, 1],
      [0, 2, 0, 2],
    ]);
    expect(s.cols).toHaveLength(3);
    const dimOnly = `<worksheet><dimension ref="A1:B9000"/><sheetData><row><c><v>1</v></c></row>${'<row><c><v>1</v></c></row>'.repeat(SHEET_MAX_ROWS)}</sheetData></worksheet>`;
    expect(parseWorksheet('b', dimOnly, [], [], false).totalRows).toBe(9000);
  });

  it('помощники листа и CSV', () => {
    expect(colLetters(0)).toBe('A');
    expect(colLetters(27)).toBe('AB');
    expect(colLetters(SHEET_MAX_COLS - 1)).toBe('IV');
    expect(colIndex('ab')).toBe(27);
    expect(cellRef('$B$3')).toEqual([2, 1]);
    expect(cellRef('нет')).toBeNull();
    expect(looksNumeric('1 250,50')).toBe(true);
    expect(looksNumeric('-12%')).toBe(true);
    expect(looksNumeric('ИНН 123')).toBe(false);
    const wide = csvSheet(
      'w',
      [Array.from({ length: SHEET_MAX_COLS + 5 }, (_, i) => String(i)), ['', 'x']],
      2,
    );
    expect(wide.colsCut).toBe(true);
    expect(wide.rows[0]).toHaveLength(SHEET_MAX_COLS);
    expect(wide.rows[1]).toEqual([null, { v: 'x' }]);
  });

  it('книга без листов и битая книга', async () => {
    const empty = await zipBytes([{ name: 'xl/workbook.xml', data: '<workbook/>' }]);
    expect(await parseXlsx(openZip(empty))).toEqual({ kind: 'sheet', sheets: [] });
    const none = await zipBytes([{ name: 'a.txt', data: 'x' }]);
    await expect(parseXlsx(openZip(none))).rejects.toThrowError(new ViewError('file_bad'));
  });
});
