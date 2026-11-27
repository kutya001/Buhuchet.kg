import { describe, expect, it } from 'vitest';
import { defaultUiTexts } from '../l10n/texts';
import { dmExtColumns } from './ext';
import { dmExtHow, dmHowFormat, type DmHowWords } from './how';

// «Как подключить» по программам — прототип v160 `dmHow` (просьба заказчика 21.11.2026).

const T = defaultUiTexts();
const WORDS: DmHowWords = {
  sample: T['dm.how.sample']!,
  placeholder: T['dm.how.placeholder']!,
  token: T['dm.how.code.token']!,
  tokenSheets: T['dm.how.code.token_sheets']!,
  params: T['dm.how.code.params']!,
  paramsRefresh: T['dm.how.code.params_refresh']!,
  paramsCells: T['dm.how.code.params_cells']!,
  query: T['dm.how.code.query']!,
  load: T['dm.how.code.load']!,
  parse: T['dm.how.code.parse']!,
  guard: T['dm.how.code.guard']!,
  error: T['dm.how.code.error']!,
  askClear: T['dm.how.code.ask_clear']!,
  askClearNote: T['dm.how.code.ask_clear_note']!,
  data1c: T['dm.how.code.data_1c']!,
  row1c: T['dm.how.code.row_1c']!,
  rows: T['dm.how.code.rows']!,
  fmtDate: T['dm.how.fmt.date']!,
  fmtMonth: T['dm.how.fmt.month']!,
  fmtYear: T['dm.how.fmt.year']!,
};

const COLS = dmExtColumns([
  { code: 'name', name: 'Контрагент', type: 'text' },
  { code: 'sum', name: 'Сумма', type: 'money' },
  { code: 'n', name: 'Отчётов', type: 'num' },
  { code: 'cp', name: 'Контрагент (для области)', type: 'cp' },
]);

const BASE = 'https://buhuchet.kg/api/ext/v1/reports-due';
const TOKEN = 'bk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const PARAMS = [
  { code: 'date_from', name: 'Срок с', type: 'date', value: '2026-11-01' },
  { code: 'date_to', name: 'Срок по', type: 'date', value: '2026-11-30' },
  { code: 'status', name: 'Статус', type: 'text', value: null },
];

const how = (over: Partial<Parameters<typeof dmExtHow>[0]> = {}) =>
  dmExtHow({
    base: BASE,
    token: TOKEN,
    params: PARAMS,
    columns: COLS,
    today: '2026-11-21',
    words: WORDS,
    ...over,
  });

describe('dmExtHow', () => {
  it('ссылка CSV, её части и заголовок — по отдельности; параметр без значения в адрес не идёт', () => {
    const x = how();
    expect(x.csv).toBe(`${BASE}?format=csv&date_from=2026-11-01&date_to=2026-11-30`);
    expect(x.parts).toEqual([`${BASE}?format=csv`, '&date_from=2026-11-01', '&date_to=2026-11-30']);
    expect(x.parts.join('')).toBe(x.csv);
    expect(x.pairs.map((p) => p.pair)).toEqual(['date_from=2026-11-01', 'date_to=2026-11-30']);
    expect(x.bearer).toBe(`Bearer ${TOKEN}`);
    expect(x.curl).toBe(`curl -H "Authorization: Bearer ${TOKEN}" \\\n  "${x.csv}"`);
  });

  it('токен — только в заголовке: ни в одном адресе его нет', () => {
    const x = how();
    for (const url of [x.csv, ...x.parts, ...x.pairs.map((p) => p.pair)]) {
      expect(url).not.toContain('bk_');
    }
    // В коде программ адрес и токен стоят в разных строках.
    for (const text of [x.powerQuery, x.vba, x.sheets, x.code1c, x.python]) {
      const line = text.split('\n').filter((l) => l.includes(TOKEN));
      expect(line).toHaveLength(1);
      expect(line[0]).not.toContain('/api/ext/v1/');
    }
  });

  it('у выпущенного токена в коде — слово-заглушка, начала токена нет', () => {
    const x = how({ token: null });
    expect(x.token).toBe('bk_ВАШ_ТОКЕН');
    expect(x.bearer).toBe('Bearer bk_ВАШ_ТОКЕН');
    for (const text of [x.powerQuery, x.vba, x.sheets, x.code1c, x.python, x.curl]) {
      expect(text).toContain('bk_ВАШ_ТОКЕН');
      expect(text).not.toContain('…');
    }
  });

  it('Power Query: параметры — отдельными строками в начале, адрес без параметров, CSV', () => {
    expect(how().powerQuery).toBe(
      [
        'let',
        '    // 1. Токен (полностью, вместе с bk_)',
        `    Token = "${TOKEN}",`,
        '    // 2. Параметры: меняйте значения здесь, затем «Обновить»',
        '    #"Срок с" = "2026-11-01",   // date_from, ГГГГ-ММ-ДД',
        '    #"Срок по" = "2026-11-30",   // date_to, ГГГГ-ММ-ДД',
        '    // 3. Запрос — менять не нужно',
        `    Source = Web.Contents("${BASE}", [`,
        '        Query = [format = "csv", date_from = #"Срок с", date_to = #"Срок по"],',
        '        Headers = [Authorization = "Bearer " & Token]',
        '    ]),',
        '    Csv = Csv.Document(Source, [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),',
        '    Result = Table.PromoteHeaders(Csv, [PromoteAllScalars = true])',
        'in',
        '    Result',
      ].join('\n'),
    );
    // Значение из именованной ячейки — по типу первого параметра.
    expect(how().cell).toBe(
      'Date.ToText(Date.From(Excel.CurrentWorkbook(){[Name="date_from"]}[Content]{0}[Column1]), "yyyy-MM-dd")',
    );
    expect(
      how({ params: [{ code: 'month', name: 'Месяц', type: 'month', value: '2026-11' }] }).cell,
    ).toContain('"yyyy-MM")');
    expect(how({ params: [{ code: 'q', name: 'Поиск', type: 'text', value: 'а' }] }).cell).toBe(
      'Text.From(Excel.CurrentWorkbook(){[Name="q"]}[Content]{0}[Column1])',
    );
  });

  it('VBA, Google Таблицы, 1С и Python: параметры в начале кода, запрос ниже', () => {
    const x = how();
    expect(x.vba).toContain(`Const TOKEN As String = "${TOKEN}"`);
    expect(x.vba).toContain(
      `    Dim p1 As String: p1 = "2026-11-01"   ' Срок с, date_from, ГГГГ-ММ-ДД`,
    );
    // Значение параметра в адресе макроса и 1С кодируется (прототип v162).
    expect(x.vba).toContain(
      `url = "${BASE}?format=csv" & "&date_from=" & WorksheetFunction.EncodeURL(p1) & "&date_to=" & WorksheetFunction.EncodeURL(p2)`,
    );
    expect(x.vba).toContain('MsgBox "Ошибка " & http.Status');
    expect(x.sheets).toContain(`const TOKEN = '${TOKEN}';`);
    expect(x.sheets).toContain('  date_from: "2026-11-01",   // Срок с, ГГГГ-ММ-ДД');
    expect(x.sheets).toContain(`UrlFetchApp.fetch('${BASE}?format=csv' + (q ? '&' + q : ''), {`);
    expect(x.code1c).toContain('Параметры_date_from = "2026-11-01"; // Срок с, ГГГГ-ММ-ДД');
    expect(x.code1c).toContain(
      'Адрес = "/api/ext/v1/reports-due" + "?date_from=" + КодироватьСтроку(Параметры_date_from, СпособКодированияСтроки.КодировкаURL) + "&date_to=" + КодироватьСтроку(Параметры_date_to, СпособКодированияСтроки.КодировкаURL);',
    );
    expect(x.code1c).toContain(
      'Соединение = Новый HTTPСоединение("buhuchet.kg", 443, , , , 60, Новый ЗащищенноеСоединениеOpenSSL);',
    );
    expect(x.code1c).toContain('    // Строка.<код столбца>, например Строка.name');
    expect(x.python).toContain(`TOKEN = "${TOKEN}"`);
    expect(x.python).toContain('PARAMS = {"date_from": "2026-11-01", "date_to": "2026-11-30"}');
    expect(x.python).toContain(`r = requests.get("${BASE}", params=PARAMS,`);
    expect(x.python).toContain('print(len(data["rows"]), "строк")');
  });

  it('шаблон без параметров: в коде нет раздела «2. Параметры», в адресе — только format=csv', () => {
    const x = how({ params: [], base: 'https://buhuchet.kg/api/ext/v1/cps' });
    expect(x.csv).toBe('https://buhuchet.kg/api/ext/v1/cps?format=csv');
    expect(x.parts).toEqual([x.csv]);
    expect(x.pairs).toEqual([]);
    expect(x.cell).toBeNull();
    for (const text of [x.powerQuery, x.vba, x.sheets, x.code1c]) {
      expect(text).not.toContain('2. Параметры');
    }
    expect(x.powerQuery).toContain('Query = [format = "csv"],');
    expect(x.vba).toContain('url = "https://buhuchet.kg/api/ext/v1/cps?format=csv"\n');
    expect(x.sheets).toContain('const PARAMS = {};');
    expect(x.code1c).toContain('Адрес = "/api/ext/v1/cps";');
    expect(x.python).toContain('PARAMS = {}');
  });

  it('адрес сайта — из настроек: стенд и свой порт без защищённого соединения', () => {
    expect(how({ base: 'https://test.buhuchet.kg/api/ext/v1/cps' }).code1c).toContain(
      'Новый HTTPСоединение("test.buhuchet.kg", 443, , , , 60, Новый ЗащищенноеСоединениеOpenSSL);',
    );
    const local = how({ base: 'http://localhost:3000/api/ext/v1/cps', params: [] }).code1c;
    expect(local).toContain('Новый HTTPСоединение("localhost", 3000, , , , 60);');
    expect(local).toContain('Адрес = "/api/ext/v1/cps";');
    expect(how({ base: 'http://x.kg/api/ext/v1/cps' }).code1c).toContain('("x.kg", 80, , , , 60);');
  });

  it('подпись и значение с кавычками и переводом строки код не ломают; значение в адресе закодировано', () => {
    const x = how({
      params: [
        {
          code: 'q',
          name: 'Имя "в кавычках"\n\'и\' \\ */ так',
          type: 'text',
          value: 'а&б "в" \'г\' \\\nд',
        },
      ],
    });
    expect(x.csv).toBe(
      `${BASE}?format=csv&q=%D0%B0%26%D0%B1%20%22%D0%B2%22%20'%D0%B3'%20%5C%0A%D0%B4`,
    );
    // Перевода строки из подписи или значения в коде нет: число строк — как у кода с простой подписью.
    const plain = how({ params: [{ code: 'q', name: 'Имя', type: 'text', value: 'а' }] });
    for (const k of ['powerQuery', 'vba', 'sheets', 'code1c', 'python'] as const) {
      expect(x[k].split('\n'), k).toHaveLength(plain[k].split('\n').length);
    }
    expect(x.powerQuery).toContain(
      `    #"Имя ""в кавычках"" 'и' \\ */ так" = "а&б ""в"" 'г' \\ д",   // q`,
    );
    expect(x.vba).toContain(`p1 = "а&б ""в"" 'г' \\ д"   ' Имя "в кавычках" 'и' \\ */ так, q`);
    expect(x.sheets).toContain(
      `  q: "а&б \\"в\\" 'г' \\\\ д",   // Имя "в кавычках" 'и' \\ */ так`,
    );
    expect(x.code1c).toContain(`Параметры_q = "а&б ""в"" 'г' \\ д"; // Имя`);
    expect(x.python).toContain(`PARAMS = {"q": "а&б \\"в\\" 'г' \\\\ д"}`);
  });

  it('макрос VBA сам разбирает CSV и пишет ячейки по одной: данные не становятся формулами (п. О-100)', () => {
    const x = how();
    // «Текст по столбцам» и запись целой строки в ячейку вводили бы значение заново — как формулу.
    expect(x.vba).not.toContain('TextToColumns');
    expect(x.vba).not.toContain('Split(');
    // Перевод строки внутри кавычек — часть значения: новая строка листа только вне кавычек.
    expect(x.vba).toContain('        ElseIf ch = "," Or ch = vbLf Then');
    expect(x.vba).toContain('            ElseIf Mid$(txt, i + 1, 1) = """" Then');
    // Текст, похожий на формулу, — с апострофом впереди; число с минусом остаётся числом.
    expect(x.vba).toContain(
      `            If v Like "[=+@-]*" And Not IsNumeric(v) Then v = "'" & v\n` +
        '            If Len(v) > 0 Then ws.Cells(r, c).Value = v',
    );
    expect(x.vba.endsWith('    Next\nEnd Sub')).toBe(true);
    // Скрипт Google Таблиц ставит апостроф так же: `setValues` вводит строку на «=» формулой.
    expect(x.sheets).toContain(
      `  // ${WORDS.guard}\n` +
        `  const cells = rows.map(row => row.map(v => /^[=+@-]/.test(v) && isNaN(v) ? "'" + v : v));`,
    );
    expect(x.vba).toContain(`    ' ${WORDS.parse}\n    Dim ws As Worksheet: Set ws = ActiveSheet`);
    expect(x.sheets).toContain('.setValues(cells);');
    const guard = (v: string) => (/^[=+@-]/.test(v) && isNaN(Number(v)) ? `'${v}` : v);
    expect(['=1+1', '+996 555', '@x', '-', '-5', '+7', 'текст', ''].map(guard)).toEqual([
      "'=1+1",
      "'+996 555",
      "'@x",
      "'-",
      '-5',
      '+7',
      'текст',
      '',
    ]);
  });

  it('макрос и скрипт спрашивают перед очисткой листа, только если на листе есть данные (прототип v165, 9Б)', () => {
    const x = how();
    expect(x.vba).toContain(
      '    If WorksheetFunction.CountA(ws.Cells) > 0 Then\n' +
        `        If MsgBox("${WORDS.askClear}", vbYesNo + vbQuestion) <> vbYes Then Exit Sub\n` +
        '    End If\n' +
        '    ws.Cells.Clear',
    );
    expect(x.sheets).toContain(
      '  if (sh.getLastRow() > 0 && !askClear()) return;\n  sh.clearContents();',
    );
    // По триггеру спросить некого: `getUi` бросает — лист обновляется сам.
    expect(x.sheets).toContain(
      `// ${WORDS.askClearNote}\n` +
        'function askClear() {\n' +
        '  try {\n' +
        '    const ui = SpreadsheetApp.getUi();\n' +
        `    return ui.alert('${WORDS.askClear}', ui.ButtonSet.YES_NO) === ui.Button.YES;\n` +
        '  } catch (e) {\n' +
        '    return true;\n' +
        '  }\n' +
        '}',
    );
    expect(WORDS.askClear).toBe('Лист будет очищен и заполнен заново. Продолжить?');
  });

  it('слова словаря с переводом строки своих строк в код не дописывают', () => {
    const plain = how();
    const words = Object.fromEntries(
      Object.entries(WORDS).map(([k, v]) => [k, `${v}\r\nShell "calc.exe"\u0085x\u2028y`]),
    ) as unknown as DmHowWords;
    const x = how({ words, token: null });
    for (const k of ['powerQuery', 'vba', 'sheets', 'code1c', 'python', 'curl'] as const) {
      expect(x[k].split(/\r\n|[\n\r\u0085\u2028\u2029]/), k).toHaveLength(
        plain[k].split('\n').length,
      );
    }
    expect(x.vba).toContain(`    ' ${WORDS.token} Shell "calc.exe" x y\n    Const TOKEN`);
  });

  it('заглушка токена в curl из кавычек оболочки не выходит', () => {
    const x = how({ token: null, words: { ...WORDS, placeholder: 'bk_$(id)"; echo `x` \\ "' } });
    expect(x.curl).toBe(
      'curl -H "Authorization: Bearer bk_\\$(id)\\"; echo \\`x\\` \\\\ \\"" \\\n' +
        `  "${BASE}?format=csv&date_from=2026-11-01&date_to=2026-11-30"`,
    );
  });

  it('Power Query: «#(» в подписи — буквально; подпись, совпавшая с шагом запроса или с другой, — с кодом', () => {
    const x = how({
      params: [
        { code: 'a', name: 'Счёт #(основной)', type: 'text', value: '#(lf)' },
        { code: 'b', name: 'Token', type: 'text', value: '1' },
        { code: 'c', name: 'Период', type: 'text', value: '2' },
        { code: 'd', name: 'Период', type: 'text', value: '3' },
        { code: 'e', name: 'Web.Contents', type: 'text', value: '4' },
      ],
    });
    expect(x.powerQuery).toContain('    #"Web.Contents (e)" = "4",   // e');
    expect(x.powerQuery).toContain('    #"Счёт #(#)(основной)" = "#(#)(lf)",   // a');
    expect(x.powerQuery).toContain('    #"Token (b)" = "1",   // b');
    expect(x.powerQuery).toContain('    #"Период" = "2",   // c');
    expect(x.powerQuery).toContain('    #"Период (d)" = "3",   // d');
    expect(x.powerQuery).toContain(
      'Query = [format = "csv", a = #"Счёт #(#)(основной)", b = #"Token (b)", c = #"Период", d = #"Период (d)", e = #"Web.Contents (e)"],',
    );
  });

  it('параметр с кодом не по правилу шаблона в адрес и в код не попадает', () => {
    const x = how({
      params: [
        ...PARAMS,
        {
          code: 'a" & Shell("calc") & "',
          name: 'Чужой',
          type: 'text',
          value: '1',
        },
      ],
    });
    expect(x).toEqual(how());
    expect(JSON.stringify(x)).not.toContain('Shell');
  });

  it('комментарий VBA не кончается переносом строки « _»', () => {
    const x = how({
      words: { ...WORDS, token: 'Токен _\u00a0', fmtDate: 'ГГГГ-ММ-ДД _ ', parse: 'Разбор CSV _ ' },
    });
    expect(x.vba).toContain("    ' Токен\n    Const TOKEN");
    expect(x.vba).toContain("    ' Разбор CSV\n    Dim ws As Worksheet");
    expect(x.vba).toContain(`p1 = "2026-11-01"   ' Срок с, date_from, ГГГГ-ММ-ДД\n`);
  });

  it('пример ответа: две строки по видам столбцов, без «Контрагента» для области (п. Т-27)', () => {
    expect(JSON.parse(how().sample)).toEqual({
      columns: COLS,
      rows: [
        { name: 'Пример 1', sum: 1250.5, n: 3 },
        { name: 'Пример 2', sum: 300, n: 1 },
      ],
      total: 2,
      next: null,
    });
    const dates = how({
      columns: [
        { key: 'd', title: 'Дата', type: 'date' },
        { key: 'm', title: 'Месяц', type: 'month' },
        { key: 'at', title: 'Когда', type: 'datetime' },
        { key: 'b', title: 'Да', type: 'bool' },
      ],
    });
    expect(JSON.parse(dates.sample).rows).toEqual([
      { d: '2026-11-21', m: '2026-11', at: '2026-11-21T10:00:00+06:00', b: true },
      { d: '2026-11-21', m: '2026-11', at: '2026-11-21T10:00:00+06:00', b: false },
    ]);
    const empty = how({ columns: [] });
    expect(JSON.parse(empty.sample)).toEqual({ columns: [], rows: [], total: 0, next: null });
    // Без столбцов пример кода 1С называет столбец словом `name`.
    expect(empty.code1c).toContain('например Строка.name');
  });
});

describe('dmHowFormat', () => {
  it('формат значения — у даты, месяца и года; у текста и числа — пусто', () => {
    expect(dmHowFormat('date', WORDS)).toBe('ГГГГ-ММ-ДД');
    expect(dmHowFormat('month', WORDS)).toBe('ГГГГ-ММ');
    expect(dmHowFormat('year', WORDS)).toBe('ГГГГ');
    expect(dmHowFormat('text', WORDS)).toBe('');
    expect(dmHowFormat('num', WORDS)).toBe('');
  });
});
