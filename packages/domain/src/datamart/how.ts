import type { IsoDate } from '../common/dates';
import { monthOf } from '../common/months';
import type { DmExtColumn } from './ext';

/*
 * «Как подключить» в окне API-токена «Витрины данных» (просьба заказчика 21.11.2026; прототип v160
 * `modules/vitrina.js` `dmHow`): ссылка CSV, адрес и заголовок по отдельности и код для каждой программы
 * — Excel Power Query (он же в Power BI), Excel VBA, Google Таблицы, 1С, curl и Python. Параметры
 * шаблона стоят в коде отдельными строками в начале: их меняют, не трогая запрос. Здесь только текст
 * кода; что и где показать — экран (`apps/web/src/dm/how-box.tsx`). Слова комментариев кода приходят из
 * словаря (`DmHowWords`).
 */

/** Параметр шаблона для «Как подключить»: код, подпись, тип и значение по умолчанию на сегодня. */
export interface DmHowParamIn {
  code: string;
  name: string;
  type: string;
  value: string | null;
}

/** Слова словаря в коде и подписях «Как подключить» (комментарии кода, формат даты). */
export interface DmHowWords {
  /** Слово для текста в примере ответа («Пример»). */
  sample: string;
  /** Что стоит в коде вместо токена, когда он показан не целиком («bk_ВАШ_ТОКЕН»). */
  placeholder: string;
  /** «1. Токен (полностью, вместе с bk_)». */
  token: string;
  /** То же для Google Таблиц: «…Его видят все редакторы таблицы». */
  tokenSheets: string;
  /** «2. Параметры: меняйте значения здесь». */
  params: string;
  /** «2. Параметры: меняйте значения здесь, затем «Обновить»». */
  paramsRefresh: string;
  /** «2. Параметры: впишите значения или берите из ячеек, например Range("B1").Text». */
  paramsCells: string;
  /** «3. Запрос — менять не нужно». */
  query: string;
  /** «3. Загрузка — менять не нужно». */
  load: string;
  /** «Ошибка» — в сообщении макроса и 1С. */
  error: string;
  /** «Данные.columns — столбцы, Данные.rows — строки…» — 1С. */
  data1c: string;
  /** «Строка.<код столбца>, например Строка.{key}» — 1С; `{key}` — код первого столбца. */
  row1c: string;
  /** «строк» — Python. */
  rows: string;
  /** Формат значения: «ГГГГ-ММ-ДД», «ГГГГ-ММ», «ГГГГ». */
  fmtDate: string;
  fmtMonth: string;
  fmtYear: string;
}

/** Параметр со значением: строка таблицы и строка кода. */
export interface DmHowPair {
  code: string;
  name: string;
  /** Значение по умолчанию как есть (в коде программ). */
  value: string;
  /** `month=2026-11` — в кодировке адреса. */
  pair: string;
}

/** Что показывает «Как подключить». */
export interface DmExtHow {
  /** Токен в коде: целиком или слово-заглушка. */
  token: string;
  /** Значение заголовка Authorization: `Bearer …`. */
  bearer: string;
  /** Ссылка CSV: адрес, `format=csv` и параметры по умолчанию. */
  csv: string;
  /** Она же частями для «Части URL-адреса»: адрес с `format=csv`, дальше `&параметр=значение`. */
  parts: string[];
  /** Параметры, у которых есть значение по умолчанию. */
  pairs: DmHowPair[];
  /** Формула Power Query «значение из именованной ячейки» для первого параметра; параметров нет — null. */
  cell: string | null;
  /** Код Power Query (Excel «Пустой запрос» и Power BI). */
  powerQuery: string;
  /** Макрос Excel `LoadBuhuchet`. */
  vba: string;
  /** Скрипт Google Таблиц `load`. */
  sheets: string;
  /** Код 1С. */
  code1c: string;
  curl: string;
  python: string;
  /** Пример ответа JSON на двух строках. */
  sample: string;
}

/** Значение-образец ячейки по виду столбца (строка 0 или 1 примера ответа). */
function sampleCell(type: string, i: number, today: IsoDate, word: string): unknown {
  switch (type) {
    case 'money':
      return i === 0 ? 1250.5 : 300;
    case 'num':
    case 'int':
      return i === 0 ? 3 : 1;
    case 'date':
      return today;
    case 'datetime':
      return `${today}T10:00:00+06:00`;
    case 'month':
      return monthOf(today);
    case 'bool':
      return i === 0;
    default:
      return `${word} ${i + 1}`;
  }
}

/** Формат значения параметра словами (прототип `dmFmt`); у текста и числа — пусто. */
export function dmHowFormat(type: string, w: Pick<DmHowWords, 'fmtDate' | 'fmtMonth' | 'fmtYear'>) {
  return type === 'date'
    ? w.fmtDate
    : type === 'month'
      ? w.fmtMonth
      : type === 'year'
        ? w.fmtYear
        : '';
}

/**
 * Подпись и значение параметра и слова словаря задаёт администратор платформы, а код вставляют в чужую
 * программу: в одну строку и в кавычках языка — текст с кавычкой или переводом строки не должен ломать
 * код и дописывать в него свои строки. Управляющие знаки (переводы строки всех видов, табуляция,
 * U+0085, U+2028, U+2029) — в один пробел.
 */
function oneLine(s: string): string {
  let out = '';
  let gap = false;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
    if (!control) out += ch;
    else if (!gap) out += ' ';
    gap = control;
  }
  return out;
}
/** Строка VBA и 1С: кавычка удваивается. */
const dq = (s: string) => `"${oneLine(s).replace(/"/g, '""')}"`;
/** Строка и имя в кавычках Power Query: ещё и `#(` — начало управляющей записи языка M. */
const mq = (s: string) => dq(s).replaceAll('#(', '#(#)(');
/** Комментарий VBA: ` _` в конце строки втянул бы в комментарий следующую строку кода. */
const vbaNote = (s: string) => oneLine(s).replace(/[\s_]+$/u, '');
/** Строка оболочки в двойных кавычках: `\`, `"`, `$` и обратная кавычка — с обратной чертой. */
const shq = (s: string) => `"${oneLine(s).replace(/[\\"$`]/g, '\\$&')}"`;
/** Строка JavaScript в одинарных кавычках. */
const jsq = (s: string) => `'${oneLine(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** Строка Python в двойных кавычках. */
const pyq = (s: string) => `"${oneLine(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** Хвост комментария: «код, формат» — без пустых частей. */
const tail = (...parts: string[]) =>
  parts
    .map(oneLine)
    .filter((x) => x !== '')
    .join(', ');

/** Сервер, порт, защищённое ли соединение и путь адреса — для HTTPСоединение 1С. */
function hostOf(base: string): { host: string; port: number; secure: boolean; path: string } {
  const secure = !base.startsWith('http://');
  const scheme = base.indexOf('://');
  const rest = scheme < 0 ? base : base.slice(scheme + 3);
  const slash = rest.indexOf('/');
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  const colon = authority.lastIndexOf(':');
  const port = colon < 0 ? NaN : Number(authority.slice(colon + 1));
  return {
    host: colon < 0 ? authority : authority.slice(0, colon),
    port: Number.isInteger(port) && port > 0 ? port : secure ? 443 : 80,
    secure,
    path: slash < 0 ? '/' : rest.slice(slash),
  };
}

/** Формула Power Query: значение параметра из именованной ячейки книги (прототип `cell`). */
function cellFormula(p: DmHowParamIn): string {
  const value = `Excel.CurrentWorkbook(){[Name="${p.code}"]}[Content]{0}[Column1]`;
  if (p.type === 'date') return `Date.ToText(Date.From(${value}), "yyyy-MM-dd")`;
  if (p.type === 'month') return `Date.ToText(Date.From(${value}), "yyyy-MM")`;
  return `Text.From(${value})`;
}

/**
 * Код и адреса «Как подключить» (прототип v160 `dmHow`). `base` — адрес шаблона без параметров,
 * `token` — токен целиком (окно выпуска) или null: тогда в коде слово-заглушка `words.placeholder`
 * (окно уже выпущенного токена: его в системе нет). В коде — только параметры со значением по
 * умолчанию, как в прототипе. Строки примера ответа — образцы по виду столбца, а не запуск шаблона
 * (docs/deviations.md п. Т-27).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-27
export function dmExtHow(o: {
  base: string;
  token: string | null;
  params: readonly DmHowParamIn[];
  columns: readonly DmExtColumn[];
  today: IsoDate;
  words: DmHowWords;
}): DmExtHow {
  // Слова словаря стоят в комментариях кода: каждое — в одну строку.
  const w = Object.fromEntries(
    Object.entries(o.words).map(([k, v]) => [k, oneLine(String(v))]),
  ) as unknown as DmHowWords;
  const token = o.token ?? w.placeholder;
  const bearer = `Bearer ${token}`;
  const ps = o.params.filter(
    (p): p is DmHowParamIn & { value: string } => p.value !== null && p.value !== '',
  );
  const pairs: DmHowPair[] = ps.map((p) => ({
    code: p.code,
    name: p.name,
    value: p.value,
    pair: `${encodeURIComponent(p.code)}=${encodeURIComponent(p.value)}`,
  }));
  const parts = [`${o.base}?format=csv`, ...pairs.map((p) => `&${p.pair}`)];
  const csv = parts.join('');
  const fmt = (p: DmHowParamIn) => dmHowFormat(p.type, w);

  const rows = [0, 1].map((i) =>
    Object.fromEntries(o.columns.map((c) => [c.key, sampleCell(c.type, i, o.today, w.sample)])),
  );
  const sample = JSON.stringify(
    {
      columns: o.columns,
      rows: o.columns.length ? rows : [],
      total: o.columns.length ? 2 : 0,
      next: null,
    },
    null,
    2,
  );

  // Power Query (Excel и Power BI): параметры — отдельными строками в начале, адрес без параметров.
  // Имя шага — подпись параметра; совпала с шагом запроса или с подписью выше — к ней код параметра.
  const steps = new Set([
    'Token',
    'Source',
    'Csv',
    'Result',
    // Имя шага, равное имени функции запроса, перекрыло бы её.
    'Web.Contents',
    'Csv.Document',
    'Table.PromoteHeaders',
    'QuoteStyle.Csv',
  ]);
  const pqNames = new Map<string, string>();
  for (const p of ps) {
    let name = oneLine(p.name);
    while (steps.has(name)) name = `${name} (${p.code})`;
    steps.add(name);
    pqNames.set(p.code, `#${mq(name)}`);
  }
  const pqName = (p: DmHowParamIn) => pqNames.get(p.code) ?? `#${mq(p.name)}`;
  const powerQuery = [
    'let',
    `    // ${w.token}`,
    `    Token = ${mq(token)},`,
    ...(ps.length
      ? [
          `    // ${w.paramsRefresh}`,
          ...ps.map((p) => `    ${pqName(p)} = ${mq(p.value)},   // ${tail(p.code, fmt(p))}`),
        ]
      : []),
    `    // ${w.query}`,
    `    Source = Web.Contents(${mq(o.base)}, [`,
    `        Query = [format = "csv"${ps.map((p) => `, ${p.code} = ${pqName(p)}`).join('')}],`,
    '        Headers = [Authorization = "Bearer " & Token]',
    '    ]),',
    '    Csv = Csv.Document(Source, [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),',
    '    Result = Table.PromoteHeaders(Csv, [PromoteAllScalars = true])',
    'in',
    '    Result',
  ].join('\n');

  // Макрос сам разбирает CSV по кавычкам и пишет каждую ячейку отдельно: перевод строки внутри значения
  // остаётся в своей ячейке, а текст, похожий на формулу, — текстом (с апострофом впереди).
  // ОТКЛОНЕНИЕ: docs/deviations.md#О-100
  const vba = [
    'Sub LoadBuhuchet()',
    `    ' ${vbaNote(w.token)}`,
    `    Const TOKEN As String = ${dq(token)}`,
    ...(ps.length
      ? [
          `    ' ${vbaNote(w.paramsCells)}`,
          ...ps.map(
            (p, i) =>
              `    Dim p${i + 1} As String: p${i + 1} = ${dq(p.value)}   ' ${vbaNote(tail(p.name, p.code, fmt(p)))}`,
          ),
        ]
      : []),
    `    ' ${vbaNote(w.query)}`,
    '    Dim url As String',
    `    url = ${dq(`${o.base}?format=csv`)}${ps.map((p, i) => ` & "&${p.code}=" & p${i + 1}`).join('')}`,
    '    Dim http As Object: Set http = CreateObject("MSXML2.XMLHTTP.6.0")',
    '    http.Open "GET", url, False',
    '    http.setRequestHeader "Authorization", "Bearer " & TOKEN',
    '    http.send',
    `    If http.Status <> 200 Then MsgBox ${dq(`${w.error} `)} & http.Status & ": " & http.responseText: Exit Sub`,
    '    Dim txt As String',
    '    With CreateObject("ADODB.Stream")',
    '        .Type = 1: .Open: .Write http.responseBody',
    '        .Position = 0: .Type = 2: .Charset = "utf-8": txt = .ReadText',
    '    End With',
    '    Dim ws As Worksheet: Set ws = ActiveSheet',
    '    ws.Cells.Clear',
    '    Dim r As Long, c As Long, i As Long, q As Boolean, ch As String, v As String',
    '    r = 1: c = 1',
    '    If Right$(txt, 1) <> vbLf Then txt = txt & vbLf',
    '    For i = 1 To Len(txt)',
    '        ch = Mid$(txt, i, 1)',
    '        If q Then',
    '            If ch <> """" Then',
    '                v = v & ch',
    '            ElseIf Mid$(txt, i + 1, 1) = """" Then',
    '                v = v & ch: i = i + 1',
    '            Else',
    '                q = False',
    '            End If',
    '        ElseIf ch = """" Then',
    '            q = True',
    '        ElseIf ch = "," Or ch = vbLf Then',
    '            If v Like "[=+@-]*" And Not IsNumeric(v) Then v = "\'" & v',
    '            If Len(v) > 0 Then ws.Cells(r, c).Value = v',
    '            v = ""',
    '            If ch = "," Then',
    '                c = c + 1',
    '            Else',
    '                r = r + 1: c = 1',
    '            End If',
    '        ElseIf ch <> vbCr Then',
    '            v = v & ch',
    '        End If',
    '    Next',
    'End Sub',
  ].join('\n');

  const sheets = [
    `// ${w.tokenSheets}`,
    `const TOKEN = ${jsq(token)};`,
    ...(ps.length
      ? [
          `// ${w.params}`,
          'const PARAMS = {',
          ...ps.map((p) => `  ${p.code}: ${jsq(p.value)},   // ${tail(p.name, fmt(p))}`),
          '};',
        ]
      : ['const PARAMS = {};']),
    `// ${w.load}`,
    'function load() {',
    "  const q = Object.keys(PARAMS).map(k => k + '=' + encodeURIComponent(PARAMS[k])).join('&');",
    `  const r = UrlFetchApp.fetch(${jsq(`${o.base}?format=csv`)} + (q ? '&' + q : ''), {`,
    "    headers: { Authorization: 'Bearer ' + TOKEN }",
    '  });',
    "  const rows = Utilities.parseCsv(r.getContentText('UTF-8'));",
    // Текст, похожий на формулу, — с апострофом впереди, как в макросе Excel (п. О-100).
    `  const cells = rows.map(row => row.map(v => /^[=+@-]/.test(v) && isNaN(v) ? "'" + v : v));`,
    '  const sh = SpreadsheetApp.getActiveSheet();',
    '  sh.clearContents();',
    '  if (cells.length) sh.getRange(1, 1, cells.length, cells[0].length).setValues(cells);',
    '}',
  ].join('\n');

  const at = hostOf(o.base);
  const query1c = ps
    .map((p, i) => ` + "${i ? '&' : '?'}${p.code}=" + Параметры_${p.code}`)
    .join('');
  const code1c = [
    `// ${w.token}`,
    `Токен = ${dq(token)};`,
    ...(ps.length
      ? [
          `// ${w.params}`,
          ...ps.map((p) => `Параметры_${p.code} = ${dq(p.value)}; // ${tail(p.name, fmt(p))}`),
        ]
      : []),
    `// ${w.query}`,
    `Адрес = ${dq(at.path)}${query1c};`,
    `Соединение = Новый HTTPСоединение(${dq(at.host)}, ${at.port}, , , , 60${at.secure ? ', Новый ЗащищенноеСоединениеOpenSSL' : ''});`,
    'Заголовки = Новый Соответствие;',
    'Заголовки.Вставить("Authorization", "Bearer " + Токен);',
    'Ответ = Соединение.Получить(Новый HTTPЗапрос(Адрес, Заголовки));',
    'Если Ответ.КодСостояния <> 200 Тогда',
    `    ВызватьИсключение ${dq(`${w.error} `)} + Ответ.КодСостояния + ": " + Ответ.ПолучитьТелоКакСтроку("UTF-8");`,
    'КонецЕсли;',
    'Чтение = Новый ЧтениеJSON;',
    'Чтение.УстановитьСтроку(Ответ.ПолучитьТелоКакСтроку("UTF-8"));',
    'Данные = ПрочитатьJSON(Чтение);',
    `// ${w.data1c}`,
    'Для Каждого Строка Из Данные.rows Цикл',
    `    // ${oneLine(w.row1c.replace('{key}', o.columns[0]?.key ?? 'name'))}`,
    'КонецЦикла;',
  ].join('\n');

  const python = [
    'import requests',
    '',
    `TOKEN = ${pyq(token)}`,
    `PARAMS = {${ps.map((p) => `${pyq(p.code)}: ${pyq(p.value)}`).join(', ')}}`,
    '',
    `r = requests.get(${pyq(o.base)}, params=PARAMS,`,
    '                 headers={"Authorization": "Bearer " + TOKEN}, timeout=60)',
    'r.raise_for_status()',
    'data = r.json()   # columns, rows, total, next',
    `print(len(data["rows"]), ${pyq(w.rows)})`,
  ].join('\n');

  return {
    token,
    bearer,
    csv,
    parts,
    pairs,
    cell: ps[0] ? cellFormula(ps[0]) : null,
    powerQuery,
    vba,
    sheets,
    code1c,
    curl: `curl -H ${shq(`Authorization: ${bearer}`)} \\\n  ${shq(csv)}`,
    python,
    sample,
  };
}
