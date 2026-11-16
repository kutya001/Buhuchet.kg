import { describe, expect, it } from 'vitest';
import { cfbBytes, xlsWorkbookStream, type XlsSheetSpec } from './fixtures';
import { SHEET_MAX_BOOK_CHARS } from './sheet';
import { cfbStream, isCfb, parseXls } from './xls';
import { ViewError } from './xml';

const NB = '\u00a0';

const sheet: XlsSheetSpec = {
  name: 'Расчёт',
  cells: [
    { r: 0, c: 0, k: 'label', v: 'Контрагент', xf: 1 },
    { r: 0, c: 1, k: 'labelInline', v: 'Сумма' },
    { r: 1, c: 0, k: 'label', v: 'ОсОО «Ромашка»' },
    { r: 1, c: 1, k: 'number', v: 1250.5, xf: 3 },
    { r: 1, c: 2, k: 'rk', v: 46342, xf: 2 },
    { r: 1, c: 3, k: 'rk', v: 12.34, xf: 4 },
    { r: 2, c: 0, k: 'mulrk', v: [1, 2, 3] },
    { r: 3, c: 0, k: 'bool', v: true },
    { r: 3, c: 1, k: 'err', v: 7 },
    { r: 3, c: 2, k: 'formula', v: 2501, xf: 5 },
    { r: 3, c: 3, k: 'fstr', v: 'итог' },
  ],
  merges: [[5, 0, 5, 2]],
  colWidths: [
    { first: 0, last: 0, width256: 30 * 256 },
    { first: 3, last: 3, width256: 256, hidden: true },
  ],
  rowsInfo: [
    { r: 1, twips: 600 },
    { r: 2, hidden: true },
  ],
};

describe('старый Excel XLS в окне просмотра', () => {
  it('значения, форматы чисел и дат, жирный, объединения, ширины, формулы — сохранённым значением', () => {
    const file = cfbBytes([
      {
        name: 'Workbook',
        data: xlsWorkbookStream([
          sheet,
          { name: 'Скрыт', hidden: true, cells: [{ r: 0, c: 0, k: 'rk', v: 1 }] },
        ]),
      },
    ]);
    expect(isCfb(file)).toBe(true);
    const book = parseXls(file);
    expect(book.sheets.map((s) => s.name)).toEqual(['Расчёт']);
    const s = book.sheets[0]!;
    expect(s.rows[0]).toEqual([{ v: 'Контрагент', b: true }, { v: 'Сумма' }]);
    expect(s.rows[1]).toEqual([
      { v: 'ОсОО «Ромашка»' },
      { v: `1${NB}250,50`, num: true },
      { v: '16.11.2026', num: true },
      { v: '12,34 сом', num: true },
    ]);
    expect(s.rows[2]).toEqual([
      { v: '1', num: true },
      { v: '2', num: true },
      { v: '3', num: true },
    ]);
    expect(s.rows[3]).toEqual([
      { v: 'ИСТИНА', al: 'c' },
      { v: '#ДЕЛ/0!', al: 'c' },
      { v: '2501', num: true, al: 'c' },
      { v: 'итог' },
    ]);
    expect(s.merges).toEqual([[5, 0, 5, 2]]);
    expect(s.cols).toEqual([215, 78, 78, 0]);
    expect(s.heights).toEqual({ 1: 40 });
    expect(s.hiddenRows).toEqual([2]);
    expect(s.totalRows).toBe(4);
  });

  it('таблица строк, разрезанная продолжением CONTINUE посреди строки', () => {
    const long = 'Абв' + 'Ж'.repeat(10);
    const file = cfbBytes([
      {
        name: 'Workbook',
        data: xlsWorkbookStream(
          [
            {
              name: 'Л',
              cells: [
                { r: 0, c: 0, k: 'label', v: 'abc' },
                { r: 0, c: 1, k: 'label', v: long },
              ],
            },
          ],
          { splitSst: true },
        ),
      },
    ]);
    // Первые три знака — однобайтовые (Latin-1), остальные — после CONTINUE в UTF-16.
    const s = parseXls(file).sheets[0]!;
    expect(s.rows[0]![0]).toEqual({ v: 'abc' });
    expect(s.rows[0]![1]!.v.slice(3)).toBe('Ж'.repeat(10));
  });

  it('большой поток вне мини-потока, система дат 1904, 50 000 строк — первые 5 000', () => {
    const cells = Array.from({ length: 6000 }, (_, i) => ({ r: i, c: 0, k: 'rk' as const, v: i }));
    const file = cfbBytes([
      {
        name: 'Workbook',
        data: xlsWorkbookStream(
          [
            { name: 'Большой', cells, dimRows: 50_000 },
            { name: 'Даты', cells: [{ r: 0, c: 0, k: 'rk', v: 0, xf: 2 }] },
          ],
          { date1904: true },
        ),
      },
    ]);
    const [big, dates] = parseXls(file).sheets;
    expect(big!.rows).toHaveLength(5000);
    expect(big!.totalRows).toBe(50_000);
    expect(dates!.rows[0]![0]!.v).toBe('01.01.1904');
  });

  it('ячейки книги — общим счётом на листы: строка на пределе не показывается (защита, п. И-12)', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({
      r: i,
      c: 0,
      k: 'mulrk' as const,
      v: [1, 2, 3, 4],
    }));
    const file = cfbBytes([
      {
        name: 'Workbook',
        data: xlsWorkbookStream([
          { name: 'Первый', cells },
          { name: 'Второй', cells },
        ]),
      },
    ]);
    const budget = { left: SHEET_MAX_BOOK_CHARS, cells: 10 };
    const [first, second] = parseXls(file, budget).sheets;
    // 10 ячеек — две строки по 4 и половина третьей: третья не показывается, число строк — прежнее.
    expect(first!.rows).toHaveLength(2);
    expect(first!.totalRows).toBe(10);
    expect(second!.rows).toHaveLength(0);
    expect(budget.cells).toBe(0);
  });

  it('книга с паролем и битые файлы', () => {
    const enc = cfbBytes([
      { name: 'Workbook', data: xlsWorkbookStream([sheet], { encrypted: true }) },
    ]);
    expect(() => parseXls(enc)).toThrowError(new ViewError('file_encrypted'));
    expect(() =>
      parseXls(cfbBytes([{ name: 'WordDocument', data: new Uint8Array(10) }])),
    ).toThrowError(new ViewError('xls_bad'));
    expect(() => cfbStream(new Uint8Array(600), 'Workbook')).toThrowError(new ViewError('xls_bad'));
    const badShift = cfbBytes([{ name: 'Workbook', data: new Uint8Array(10) }]);
    badShift[30] = 7;
    expect(() => cfbStream(badShift, 'Workbook')).toThrowError(new ViewError('xls_bad'));
    const loop = cfbBytes([{ name: 'Workbook', data: new Uint8Array(5000) }]);
    expect(cfbStream(loop, 'workbook')).toHaveLength(5000);
    expect(cfbStream(loop, 'Нет')).toBeNull();
    // Цепочка DIFAT, замкнутая сама на себя, не раздувает таблицу размещения: «битый файл».
    const difat = cfbBytes([{ name: 'Workbook', data: new Uint8Array(5000) }]);
    const dv = new DataView(difat.buffer, difat.byteOffset, difat.byteLength);
    const k = difat.length / 512 - 2;
    dv.setUint32(68, k, true);
    for (let i = 0; i < 127; i++) dv.setUint32(512 + k * 512 + i * 4, 0, true);
    dv.setUint32(512 + k * 512 + 508, k, true);
    expect(() => cfbStream(difat, 'Workbook')).toThrowError(new ViewError('xls_bad'));
  });
});
