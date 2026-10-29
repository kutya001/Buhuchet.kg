import { describe, expect, it } from 'vitest';
import { buildImportTemplate } from '../modules/kpi/import-file';
import { unzipTexts } from '../testing';
import { buildXlsx, zip } from './xlsx';
import {
  DEFAULT_SHEET_LIMITS,
  readCsvRows,
  readSheetRows,
  readXlsxRows,
  SHEET_TEXT_MAX_LENGTH,
  SheetReadError,
} from './xlsx-read';

/** Книга из своих файлов листа: как сохраняют Excel и LibreOffice (общие строки, ссылки листа). */
function book(sheet: string, extra: Record<string, string> = {}) {
  const file = (name: string, xml: string) => ({ name, data: Buffer.from(xml, 'utf8') });
  return zip([
    file(
      'xl/workbook.xml',
      '<workbook xmlns:r="r"><sheets><sheet name="Данные" sheetId="1" r:id="rId7"/></sheets></workbook>',
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId7" Target="worksheets/data.xml"/></Relationships>',
    ),
    file('xl/worksheets/data.xml', `<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
    ...Object.entries(extra).map(([name, xml]) => file(name, xml)),
  ]);
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof SheetReadError ? err.code : String(err);
  }
  return null;
};

describe('Чтение загруженной таблицы (.xlsx и CSV)', () => {
  it('шаблон «Ввода из Excel» читается обратно: заголовки, ИНН текстом, значения в единицах', async () => {
    const file = await buildImportTemplate({
      sheet: 'Показатели',
      tipsSheet: 'Подсказки',
      head: ['ИНН', 'Контрагент', 'Выручка · 09.2026 (сом, сумма в сом)', 'Штат · 09.2026'],
      rows: [
        {
          inn: '03744097401851',
          name: 'ОсОО «Укс» & Ко',
          cells: [{ kind: 'checked', value: 125_000_050 }, { kind: 'off' }],
        },
        {
          inn: '02203199000124',
          name: 'ИП <Асанов>',
          cells: [
            { kind: 'input', value: null },
            { kind: 'input', value: 3_700 },
          ],
        },
      ],
      tips: ['Как заполнить шаблон', '', 'Показатели в шаблоне:'],
    });
    expect(readSheetRows(file)).toEqual([
      ['ИНН', 'Контрагент', 'Выручка · 09.2026 (сом, сумма в сом)', 'Штат · 09.2026'],
      ['03744097401851', 'ОсОО «Укс» & Ко', 1_250_000.5],
      ['02203199000124', 'ИП <Асанов>', null, 37],
    ]);
    // Лист защищён без пароля, ИНН и название — заблокированы, ячейки ввода — нет, первые столбцы закреплены.
    const xml = unzipTexts(file);
    const sheet = xml['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<sheetProtection sheet="1"');
    expect(sheet).not.toContain('password');
    expect(sheet).toContain('xSplit="2" ySplit="1"');
    expect(sheet).toMatch(/<c r="A2" t="inlineStr" s="5">/);
    expect(sheet).toMatch(/<c r="C2" s="4"><v>1250000\.5<\/v>/);
    expect(sheet).toMatch(/<c r="D2" s="3"\/>/);
    expect(sheet).toMatch(/<c r="C3" s="2"\/>/);
    const styles = xml['xl/styles.xml']!;
    expect(styles).toContain('<protection locked="0"/>');
    expect(xml['xl/workbook.xml']).toContain('name="Подсказки"');
  });

  it('выгрузка списка тоже читается: общий формат .xlsx', async () => {
    const file = await buildXlsx(
      'Лист',
      [
        { title: 'Название', kind: 'text' },
        { title: 'Сумма', kind: 'money' },
      ],
      [
        ['=1+1', 125_050],
        ['Второй', null],
      ],
    );
    expect(readXlsxRows(file)).toEqual([['Название', 'Сумма'], ['=1+1', 1250.5], ['Второй']]);
  });

  it('общие строки, форматированный текст, логические значения, формулы и пропуски строк', async () => {
    const file = await book(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3" t="str"><f>A1</f><v>&lt;итог&gt;</v></c>' +
        '<c r="C3"><f>1/3</f><v>0.33333333333333331</v></c><c r="D3" t="inlineStr"><is><t>abc</t></is></c></row>',
      {
        'xl/sharedStrings.xml':
          '<sst><si><t>ИНН</t></si><si><r><t>Выручка</t></r><r><t xml:space="preserve"> · 09.2026</t></r><rPh><t>фонетика</t></rPh></si></sst>',
      },
    );
    expect(readXlsxRows(file)).toEqual([
      ['ИНН', null, 'Выручка · 09.2026'],
      [],
      ['TRUE', '<итог>', 0.3333333333333333, 'abc'],
    ]);
  });

  it('CSV: «;», «,» или табуляция, кавычки, BOM, Windows-1251', () => {
    const rows = [
      ['ИНН', 'Контрагент', 'Выручка · 09.2026'],
      ['03744097401851', 'ОсОО «Укс»; филиал', '1 250 000,50'],
    ];
    const semicolon =
      'ИНН;Контрагент;Выручка · 09.2026\r\n03744097401851;"ОсОО «Укс»; филиал";1 250 000,50\r\n';
    expect(readCsvRows(Buffer.from(`\ufeff${semicolon}`, 'utf8'))).toEqual(rows);
    const comma =
      'ИНН,Контрагент,Выручка · 09.2026\n03744097401851,"ОсОО «Укс»; филиал","1 250 000,50"';
    expect(readSheetRows(Buffer.from(comma, 'utf8'))).toEqual(rows);
    const tab = 'ИНН\tКонтрагент\n"с ""кавычками"""\t\n';
    expect(readCsvRows(Buffer.from(tab, 'utf8'))).toEqual([
      ['ИНН', 'Контрагент'],
      ['с "кавычками"', null],
    ]);
    // «ИНН;abc» в Windows-1251: буквы — однобайтные коды 0xC8, 0xCD.
    const cp1251 = Buffer.from([0xc8, 0xcd, 0xcd, 0x3b, 0x61, 0x62, 0x63]);
    expect(readCsvRows(cp1251)).toEqual([['ИНН', 'abc']]);
  });

  it('испорченный архив, чужой формат сжатия, адрес за пределами листа — «не удалось прочитать»', async () => {
    const zipLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
    expect(code(() => readSheetRows(zipLike))).toBe('file_unreadable');
    const noSheet = await zip([{ name: 'word/document.xml', data: Buffer.from('<w/>') }]);
    expect(code(() => readXlsxRows(noSheet))).toBe('file_unreadable');
    const far = await book('<row r="1048577"><c r="A1048577"><v>1</v></c></row>');
    expect(code(() => readXlsxRows(far))).toBe('file_unreadable');
    const wide = await book('<row r="1"><c r="XFE1"><v>1</v></c></row>');
    expect(code(() => readXlsxRows(wide))).toBe('file_unreadable');
  });

  it('«архивная бомба», слишком много строк, столбцов или ячеек — «в файле слишком много»', async () => {
    const huge = await book(
      `<row r="1"><c r="A1"><v>1</v></c></row>${' '.repeat(65 * 1024 * 1024)}`,
    );
    // Сжатый файл маленький, а распакованный — больше 64 МБ.
    expect(huge.length).toBeLessThan(1024 * 1024);
    expect(code(() => readXlsxRows(huge))).toBe('sheet_too_big');
    const cells = await book(
      '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c></row>',
    );
    expect(code(() => readXlsxRows(cells, { cells: 2 }))).toBe('sheet_too_big');
    expect(code(() => readCsvRows(Buffer.from('1;2;3'), { cells: 2 }))).toBe('sheet_too_big');
    // Строка дальше предела, столбец дальше предела (но в пределах листа Excel).
    const far = await book(`<row r="${DEFAULT_SHEET_LIMITS.rows + 1}"><c><v>1</v></c></row>`);
    expect(code(() => readXlsxRows(far))).toBe('sheet_too_big');
    const xfd = await book('<row><c r="XFD1"><v>1</v></c></row>');
    expect(code(() => readXlsxRows(xfd))).toBe('sheet_too_big');
    // Строки по одной ячейке в далёком столбце: в памяти каждая — 4 000 ячеек.
    const wide = await book('<row><c r="EWV1"><v>1</v></c></row>'.repeat(1_000));
    expect(code(() => readXlsxRows(wide))).toBe('sheet_too_big');
    expect(code(() => readCsvRows(Buffer.from('\n'.repeat(DEFAULT_SHEET_LIMITS.rows + 1))))).toBe(
      'sheet_too_big',
    );
    const csvWide = Buffer.from(';'.repeat(DEFAULT_SHEET_LIMITS.columns));
    expect(code(() => readCsvRows(csvWide))).toBe('sheet_too_big');
  });

  it('испорченный XML разбирается за один проход: незакрытые строки и ячейки — «не удалось прочитать»', async () => {
    // Регулярное выражение «до </row>» на каждом из 200 000 незакрытых тегов просматривало бы весь лист.
    const rows = await book('<row>'.repeat(200_000));
    expect(code(() => readXlsxRows(rows))).toBe('file_unreadable');
    const cells = await book(`<row>${'<c>'.repeat(200_000)}</row>`);
    expect(code(() => readXlsxRows(cells))).toBe('file_unreadable');
    const nested = await book('<sheetData>'.repeat(200_000));
    expect(code(() => readXlsxRows(nested))).toBe('file_unreadable');
    const strings = await book('<row><c t="s"><v>0</v></c></row>', {
      'xl/sharedStrings.xml': `<sst>${'<si><t>a</t>'.repeat(100_000)}</sst>`,
    });
    expect(code(() => readXlsxRows(strings))).toBe('file_unreadable');
    const noEnd = await book('<row><c><v>1</v>');
    expect(code(() => readXlsxRows(noEnd))).toBe('file_unreadable');
  });

  it('текст ячейки — не длиннее 1 000 символов; теги с приставкой пространства имён читаются', async () => {
    const long = 'я '.repeat(1_000_000);
    const file = await book(
      '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c>' +
        `<x:c r="B1" t="inlineStr"><x:is><x:t>${long}</x:t><x:t>!</x:t></x:is></x:c>` +
        `<x:c r="C1" t="str"><x:v>${'&amp;'.repeat(5_000)}</x:v></x:c></x:row>`,
      { 'xl/sharedStrings.xml': `<sst><si><t>${long}</t></si></sst>` },
    );
    const [row] = readXlsxRows(file);
    expect(row!.map((v) => String(v).length)).toEqual([
      SHEET_TEXT_MAX_LENGTH + 1,
      SHEET_TEXT_MAX_LENGTH + 1,
      SHEET_TEXT_MAX_LENGTH + 1,
    ]);
    expect(row![0]).toBe(`${long.slice(0, SHEET_TEXT_MAX_LENGTH)}…`);
    expect(row![2]).toBe(`${'&'.repeat(SHEET_TEXT_MAX_LENGTH)}…`);
    const csv = readCsvRows(Buffer.from(`ИНН;"${long}"\n`));
    expect(csv[0]![1]).toBe(`${long.slice(0, SHEET_TEXT_MAX_LENGTH)}…`);
  });
});
