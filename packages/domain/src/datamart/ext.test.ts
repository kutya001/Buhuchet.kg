import { describe, expect, it } from 'vitest';
import {
  DM_EXT_PAGE,
  DM_EXT_PAGE_MAX,
  dmExtColumns,
  dmExtCsv,
  dmExtHow,
  dmExtPage,
  dmExtRequest,
  dmExtRows,
  dmExtTokenInQuery,
  dmExtUrl,
} from './ext';

// Внешний адрес «Витрины данных» — прототип v155 `dmHow` (блок 6; поток Т, этап 2, П11).

const COLS = [
  { code: 'name', name: 'Контрагент', type: 'text' },
  { code: 'sum', name: 'Сумма', type: 'money' },
  { code: 'n', name: 'Отчётов', type: 'num' },
  { code: 'cp', name: 'Контрагент (для области)', type: 'cp' },
];

describe('dmExtColumns', () => {
  it('столбцы шаблона наружу — без «Контрагента» для области (прототип: `type !== cp`)', () => {
    expect(dmExtColumns(COLS)).toEqual([
      { key: 'name', title: 'Контрагент', type: 'text' },
      { key: 'sum', title: 'Сумма', type: 'money' },
      { key: 'n', title: 'Отчётов', type: 'num' },
    ]);
  });

  it('мусор в столбцах пропускается, без названия — код', () => {
    expect(dmExtColumns('нет')).toEqual([]);
    expect(
      dmExtColumns([null, 1, { code: 'x', type: 'text' }, { name: 'y', type: 'num' }]),
    ).toEqual([{ key: 'x', title: 'x', type: 'text' }]);
  });
});

describe('dmExtTokenInQuery', () => {
  it('токен в адресе не принимается: имя параметра или значение с bk_', () => {
    const tok = `bk_${'a'.repeat(43)}`;
    expect(dmExtTokenInQuery([['token', 'x']])).toBe(true);
    expect(dmExtTokenInQuery([['Access_Token', 'x']])).toBe(true);
    expect(dmExtTokenInQuery([['api_key', '']])).toBe(true);
    expect(dmExtTokenInQuery([['month', tok]])).toBe(true);
    expect(dmExtTokenInQuery([[tok, '']])).toBe(true);
    expect(dmExtTokenInQuery([['month', '2026-11']])).toBe(false);
    expect(dmExtTokenInQuery([])).toBe(false);
  });
});

describe('dmExtRequest', () => {
  it('по умолчанию — JSON, страница 1, 1 000 строк; лишние параметры отбрасываются', () => {
    expect(
      dmExtRequest(
        [
          ['month', '2026-11'],
          ['zzz', '1'],
        ],
        ['month', 'cp'],
      ),
    ).toEqual({
      ok: true,
      format: 'json',
      page: 1,
      limit: DM_EXT_PAGE,
      input: { month: '2026-11' },
    });
  });

  it('format=csv, страница и размер до 5 000', () => {
    expect(
      dmExtRequest(
        [
          ['format', 'csv'],
          ['page', '3'],
          ['limit', String(DM_EXT_PAGE_MAX)],
        ],
        [],
      ),
    ).toMatchObject({ ok: true, format: 'csv', page: 3, limit: DM_EXT_PAGE_MAX });
  });

  it('«Неверный параметр»: повтор, вид ответа, страница и размер вне пределов', () => {
    expect(dmExtRequest([['format', 'xml']], [])).toEqual({ ok: false, param: 'format' });
    expect(dmExtRequest([['page', '0']], [])).toEqual({ ok: false, param: 'page' });
    expect(dmExtRequest([['page', '1.5']], [])).toEqual({ ok: false, param: 'page' });
    expect(dmExtRequest([['page', '50001']], [])).toEqual({ ok: false, param: 'page' });
    expect(dmExtRequest([['limit', '5001']], [])).toEqual({ ok: false, param: 'limit' });
    expect(dmExtRequest([['limit', '']], [])).toEqual({ ok: false, param: 'limit' });
    expect(
      dmExtRequest(
        [
          ['month', '2026-10'],
          ['month', '2026-11'],
        ],
        ['month'],
      ),
    ).toEqual({ ok: false, param: 'month' });
    // Повтор чужого параметра не мешает: он отбрасывается.
    expect(
      dmExtRequest(
        [
          ['x', '1'],
          ['x', '2'],
        ],
        [],
      ).ok,
    ).toBe(true);
  });

  it('параметр шаблона с кодом своего слова адреса — не параметр шаблона', () => {
    expect(dmExtRequest([['page', '2']], ['page'])).toMatchObject({ ok: true, page: 2, input: {} });
  });
});

describe('dmExtPage', () => {
  it('страницы по `limit`: последняя короче, за концом — пусто', () => {
    expect(dmExtPage(2500, 1, 1000)).toEqual({ from: 0, to: 1000, hasNext: true });
    expect(dmExtPage(2500, 3, 1000)).toEqual({ from: 2000, to: 2500, hasNext: false });
    expect(dmExtPage(2500, 4, 1000)).toEqual({ from: 2500, to: 2500, hasNext: false });
    expect(dmExtPage(0, 1, 1000)).toEqual({ from: 0, to: 0, hasNext: false });
  });
});

describe('dmExtRows', () => {
  const result = {
    columns: ['cp', 'name', 'sum', 'n'],
    rows: [
      ['c1', 'ОсОО «Альфа»', 125050, 3],
      ['c2', 'ИП Бета', null, null],
    ],
  };

  it('строки по ключам столбцов, деньги — сомами, пустые деньги — 0 (прототип `dmHow`)', () => {
    expect(dmExtRows(result, dmExtColumns(COLS), 0, 10)).toEqual([
      { name: 'ОсОО «Альфа»', sum: 1250.5, n: 3 },
      { name: 'ИП Бета', sum: 0, n: null },
    ]);
  });

  it('только строки страницы; столбца нет в запросе — пусто', () => {
    const cols = [{ key: 'gone', title: 'Нет', type: 'text' }];
    expect(dmExtRows(result, cols, 1, 2)).toEqual([{ gone: null }]);
  });
});

describe('dmExtCsv', () => {
  it('метка UTF-8, названия столбцов, CRLF, кавычки по RFC 4180', () => {
    const cols = dmExtColumns(COLS);
    const csv = dmExtCsv(cols, [
      { name: 'ОсОО «Альфа, Бета»', sum: 1250.5, n: 3 },
      { name: 'Say "hi"\nnext', sum: -5, n: null },
    ]);
    expect(csv).toBe(
      '\uFEFFКонтрагент,Сумма,Отчётов\r\n"ОсОО «Альфа, Бета»",1250.5,3\r\n"Say ""hi""\nnext",-5,\r\n',
    );
  });

  it('текст, похожий на формулу Excel, — с апострофом; числа не трогаются', () => {
    const cols = [
      { key: 't', title: 'Текст', type: 'text' },
      { key: 'm', title: 'Сумма', type: 'money' },
      { key: 'o', title: 'Объект', type: 'text' },
    ];
    const csv = dmExtCsv(cols, [
      { t: '=HYPERLINK("x")', m: -1, o: { a: 1 } },
      { t: '+1', m: 2, o: null },
      { t: '@SUM(A1)', m: 0, o: '-x' },
    ]);
    expect(csv.split('\r\n').slice(1, 4)).toEqual([
      `"'=HYPERLINK(""x"")",-1,"{""a"":1}"`,
      `'+1,2,`,
      `'@SUM(A1),0,'-x`,
    ]);
  });

  it('формула текстом в числовом столбце — тоже с апострофом (вид столбца задаёт администратор)', () => {
    const cols = [
      { key: 'n', title: 'Число', type: 'num' },
      { key: 'm', title: 'Сумма', type: 'money' },
    ];
    const csv = dmExtCsv(cols, [
      { n: '=cmd|"/c calc"!A1', m: '-2+3' },
      { n: '-5', m: '+1.5' },
    ]);
    expect(csv.split('\r\n').slice(1, 3)).toEqual([`"'=cmd|""/c calc""!A1",'-2+3`, `-5,+1.5`]);
  });
});

describe('dmExtUrl', () => {
  it('адрес «Как подключить»: значения по умолчанию на сегодня, пустые не пишутся (прототип `dmHow`)', () => {
    const params = [
      { k: 'month', def: 'month' },
      { k: 'status', def: null },
      { k: 'date_to', def: 'today' },
    ];
    expect(dmExtUrl('https://test.buhuchet.kg/', 'reports-due', params, '2026-11-21')).toBe(
      'https://test.buhuchet.kg/api/ext/v1/reports-due?month=2026-11&date_to=2026-11-21',
    );
    expect(dmExtUrl('https://buhuchet.kg', 'cps', [], '2026-11-21')).toBe(
      'https://buhuchet.kg/api/ext/v1/cps',
    );
  });

  it('значение по умолчанию с особыми знаками — в кодировке адреса', () => {
    expect(dmExtUrl('https://x.kg', 'a-b', [{ k: 'q', def: 'а&б' }], '2026-11-21')).toBe(
      'https://x.kg/api/ext/v1/a-b?q=%D0%B0%26%D0%B1',
    );
  });
});

describe('dmExtHow', () => {
  const cols = dmExtColumns(COLS);

  it('пример запроса, ответ на двух строках по видам столбцов и скрипт Google Таблиц (п. Т-27)', () => {
    const how = dmExtHow({
      url: 'https://buhuchet.kg/api/ext/v1/x?month=2026-11',
      token: 'bk_abc…',
      columns: cols,
      today: '2026-11-21',
      word: 'Пример',
    });
    expect(how.curl).toBe(
      'curl -H "Authorization: Bearer bk_abc…" \\\n  "https://buhuchet.kg/api/ext/v1/x?month=2026-11"',
    );
    expect(JSON.parse(how.sample)).toEqual({
      columns: cols,
      rows: [
        { name: 'Пример 1', sum: 1250.5, n: 3 },
        { name: 'Пример 2', sum: 300, n: 1 },
      ],
      total: 2,
      next: null,
    });
    expect(how.script).toContain(
      "UrlFetchApp.fetch('https://buhuchet.kg/api/ext/v1/x?month=2026-11&format=csv'",
    );
    expect(how.script).toContain("headers: { Authorization: 'Bearer bk_abc…' }");
    expect(how.script).toContain('Utilities.parseCsv');
  });

  it('даты, месяц, момент и «да / нет»; адрес без параметров — «?format=csv»', () => {
    const how = dmExtHow({
      url: 'https://buhuchet.kg/api/ext/v1/x',
      token: 't',
      columns: [
        { key: 'd', title: 'Дата', type: 'date' },
        { key: 'm', title: 'Месяц', type: 'month' },
        { key: 'at', title: 'Когда', type: 'datetime' },
        { key: 'b', title: 'Да', type: 'bool' },
      ],
      today: '2026-11-21',
      word: 'Пример',
    });
    expect(JSON.parse(how.sample).rows).toEqual([
      { d: '2026-11-21', m: '2026-11', at: '2026-11-21T10:00:00+06:00', b: true },
      { d: '2026-11-21', m: '2026-11', at: '2026-11-21T10:00:00+06:00', b: false },
    ]);
    expect(how.script).toContain("fetch('https://buhuchet.kg/api/ext/v1/x?format=csv'");
    expect(
      JSON.parse(
        dmExtHow({ url: 'u', token: 't', columns: [], today: '2026-11-21', word: 'w' }).sample,
      ),
    ).toEqual({
      columns: [],
      rows: [],
      total: 0,
      next: null,
    });
  });
});
