import type { IsoDate } from '../common/dates';
import { monthOf } from '../common/months';
import { dmCell, dmParamDefault } from './query';

/*
 * Внешний адрес «Витрины данных» GET /api/ext/v1/<код шаблона> (доработки 20.11.2026: Витрина данных,
 * блок 6; блок 8, пункт 6; поток Т, этап 2, П11; docs/decisions.md п. Т-20) — прототип v155
 * `modules/vitrina.js` `dmHow`: ответ `{ columns: [{ key, title, type }], rows: [{ key: значение }],
 * total, next }`, деньги — числом в сомах, столбец «Контрагент» (вид `cp`) наружу не идёт; с
 * `format=csv` — таблица; страница — 1 000 строк, до 5 000 с `limit`.
 */

/** Строк на странице ответа по умолчанию (блок 6, пункт 3). */
export const DM_EXT_PAGE = 1000;
/** Больше строк на странице не отдаётся (`limit=5000`). */
export const DM_EXT_PAGE_MAX = 5000;
/** Пределы одного токена (блок 6, пункт 4): за минуту и за сутки; одновременно — один запрос. */
export const DM_EXT_PER_MINUTE = 30;
export const DM_EXT_PER_DAY = 5000;
/**
 * Сколько запрос считается идущим, если его не отпустили (сбой процесса): больше предела времени
 * запроса (15 с) с запасом на чтение токена и журнал.
 */
export const DM_EXT_LEASE_SECONDS = 30;
/**
 * Запусков по токенам одновременно — на всю платформу и у одной организации (docs/decisions.md п. О-62,
 * Т-20): запуск держит соединение базы до 15 с. У «Показать» с экрана — свои два места (`DM_RUN_SLOTS`,
 * п. О-96), внешним программам — одно: вместе «Витрина» держит не больше трёх соединений пула из пяти.
 */
export const DM_EXT_RUNS_PLATFORM = 1;
export const DM_EXT_RUNS_ORG = 1;
/** Сколько запрос ждёт свободного запуска, прежде чем ответить «Слишком часто» (мс). */
export const DM_EXT_QUEUE_MS = 2000;
/**
 * Обращений одного известного токена за минуту — все, и отказы (отозван, истёк, остановлен): больше —
 * «Слишком часто» без чтения фактов и без строки журнала. Вдвое больше предела запросов.
 */
export const DM_EXT_TRY_PER_MINUTE = 60;
/** Строк журнала об отказах до запуска у одного токена за минуту: дальше отказ не пишется. */
export const DM_EXT_REFUSAL_LOGS_PER_MINUTE = 10;
/** Неизвестных токенов с одного адреса за окно — дальше адрес ждёт (блок 8, пункт 6: 20 за 10 минут). */
export const DM_EXT_BAD_MAX = 20;
export const DM_EXT_BAD_WINDOW_SECONDS = 600;
/** Путь внешнего адреса (без кода шаблона). */
export const DM_EXT_PATH = '/api/ext/v1/';
/** Свои слова адреса — не параметры шаблона: вид ответа и страница. */
export const DM_EXT_RESERVED = ['format', 'page', 'limit'] as const;
/** Номер страницы — не больше: дальше 50 000 строк результата страниц всё равно нет. */
const PAGE_MAX = 50_000;

/** Столбец внешнего ответа (прототип `dmHow`). */
export interface DmExtColumn {
  key: string;
  title: string;
  type: string;
}

/** Столбцы шаблона из базы (`[{ code, name, type }]`) — наружу, без столбца «Контрагент» (`cp`). */
export function dmExtColumns(columns: unknown): DmExtColumn[] {
  if (!Array.isArray(columns)) return [];
  const out: DmExtColumn[] = [];
  for (const c of columns) {
    if (typeof c !== 'object' || c === null) continue;
    const { code, name, type } = c as { code?: unknown; name?: unknown; type?: unknown };
    if (typeof code !== 'string' || typeof type !== 'string' || type === 'cp') continue;
    out.push({ key: code, title: typeof name === 'string' ? name : code, type });
  }
  return out;
}

/**
 * Похоже ли значение адреса на токен: токен в адресе не принимается (блок 6, пункт 1) — адрес попадает
 * в журналы и историю браузера. Ловит и имя параметра (`token`, `access_token`, `api_key`, …), и
 * значение с «bk_».
 */
export function dmExtTokenInQuery(entries: readonly (readonly [string, string])[]): boolean {
  return entries.some(
    ([k, v]) =>
      /^(?:token|access_token|api_key|apikey|key|bearer|authorization|auth)$/i.test(k) ||
      /bk_[A-Za-z0-9]{20,}/.test(v) ||
      /bk_[A-Za-z0-9]{20,}/.test(k),
  );
}

export type DmExtRequest =
  | {
      ok: true;
      format: 'json' | 'csv';
      page: number;
      limit: number;
      /** Значения параметров шаблона из адреса (только свои коды шаблона). */
      input: Record<string, string>;
    }
  /** «Неверный параметр: <какой>»: повтор, неизвестный вид ответа, страница или размер не числом. */
  | { ok: false; param: string };

/**
 * Разобрать адрес: свои слова (`format`, `page`, `limit`) и параметры шаблона `codes`; остальное
 * отбрасывается (блок 8, пункт 1: «лишние отбрасываются»). Параметр, повторённый дважды, — неверный:
 * какое из значений имелось в виду, не угадать.
 */
export function dmExtRequest(
  entries: readonly (readonly [string, string])[],
  codes: readonly string[],
): DmExtRequest {
  const seen = new Map<string, string>();
  const wanted = new Set<string>([...DM_EXT_RESERVED, ...codes]);
  for (const [k, v] of entries) {
    if (!wanted.has(k)) continue;
    if (seen.has(k)) return { ok: false, param: k };
    seen.set(k, v);
  }
  const format = seen.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') return { ok: false, param: 'format' };
  const page = intOf(seen.get('page'), 1, 1, PAGE_MAX);
  if (page === null) return { ok: false, param: 'page' };
  const limit = intOf(seen.get('limit'), DM_EXT_PAGE, 1, DM_EXT_PAGE_MAX);
  if (limit === null) return { ok: false, param: 'limit' };
  const input: Record<string, string> = {};
  for (const code of codes) {
    if ((DM_EXT_RESERVED as readonly string[]).includes(code)) continue;
    const v = seen.get(code);
    if (v !== undefined) input[code] = v;
  }
  return { ok: true, format, page, limit, input };
}

function intOf(raw: string | undefined, def: number, min: number, max: number): number | null {
  if (raw === undefined) return def;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/**
 * Строки страницы: значения по столбцам шаблона (по имени столбца запроса; нет такого — пусто), деньги —
 * сомами числом; пустые деньги — 0, как в примере ответа прототипа (`dmHow`: `x[c.k] || 0`).
 */
export function dmExtRows(
  result: { columns: readonly string[]; rows: readonly (readonly unknown[])[] },
  cols: readonly DmExtColumn[],
  from: number,
  to: number,
): Record<string, unknown>[] {
  const at = cols.map((c) => result.columns.indexOf(c.key));
  return result.rows.slice(from, to).map((row) => {
    const out: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      const j = at[i]!;
      const v = j < 0 ? null : (row[j] ?? null);
      out[c.key] = c.type === 'money' && v === null ? 0 : (dmCell(c.type, v) ?? null);
    });
    return out;
  });
}

/** Первая и последняя строка страницы и есть ли следующая. */
export function dmExtPage(
  total: number,
  page: number,
  limit: number,
): { from: number; to: number; hasNext: boolean } {
  const from = Math.min(total, (page - 1) * limit);
  const to = Math.min(total, from + limit);
  return { from, to, hasNext: to < total };
}

const NUMERIC = new Set(['num', 'money', 'int']);
/** Число как есть («-5», «1250.5»): минус впереди у него — не формула. */
const PLAIN_NUMBER = /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i;

/**
 * Ячейка CSV: кавычки по RFC 4180; значение, похожее на формулу Excel, — с апострофом впереди. В
 * числовом столбце без апострофа — только число: вид столбца задаёт администратор, а база может вернуть
 * в «числе» текст.
 */
function csvCell(type: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !(NUMERIC.has(type) && PLAIN_NUMBER.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV страницы: метка UTF-8, строка названий, CRLF. */
export function dmExtCsv(
  cols: readonly DmExtColumn[],
  rows: readonly Record<string, unknown>[],
): string {
  const head = cols.map((c) => csvCell('text', c.title)).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(c.type, r[c.key])).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}

/**
 * Адрес для «Как подключить» (прототип `dmHow`: `GET https://buhuchet.kg/api/ext/v1/<код>?month=…`):
 * параметры шаблона со значениями по умолчанию на сегодня по Бишкеку; пустые не пишутся. `base` —
 * адрес сайта (`APP_BASE_URL`), а не заголовок Host.
 */
export function dmExtUrl(
  base: string,
  code: string,
  params: readonly { k: string; def: string | null }[],
  today: IsoDate,
): string {
  const qs = params
    .map((p) => [p.k, dmParamDefault(p.def, today)] as const)
    .filter((x): x is readonly [string, string] => !!x[1])
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  // Косые в конце — без регулярного выражения: `/\/+$/` на длинной строке из косых работает за квадрат.
  let end = base.length;
  while (end > 0 && base[end - 1] === '/') end--;
  return `${base.slice(0, end)}${DM_EXT_PATH}${code}${qs ? `?${qs}` : ''}`;
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

/** Что показывает «Как подключить» под адресом: пример запроса, пример ответа, скрипт Google Таблиц. */
export interface DmExtHow {
  curl: string;
  sample: string;
  script: string;
}

/**
 * Примеры «Как подключить» (прототип `dmHow`): `curl` с заголовком, ответ JSON на двух строках и скрипт
 * Google Таблиц (`UrlFetchApp` с `format=csv`, `Utilities.parseCsv`). Строки примера — образцы по виду
 * столбца, а не запуск шаблона (docs/deviations.md п. Т-27); `word` — слово для текста («Пример»).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-27
export function dmExtHow(o: {
  url: string;
  token: string;
  columns: readonly DmExtColumn[];
  today: IsoDate;
  word: string;
}): DmExtHow {
  const rows = [0, 1].map((i) =>
    Object.fromEntries(o.columns.map((c) => [c.key, sampleCell(c.type, i, o.today, o.word)])),
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
  const csv = `${o.url}${o.url.includes('?') ? '&' : '?'}format=csv`;
  const script = [
    'function load() {',
    `  const r = UrlFetchApp.fetch('${csv}', {`,
    `    headers: { Authorization: 'Bearer ${o.token}' }`,
    '  });',
    '  const rows = Utilities.parseCsv(r.getContentText());',
    '  const sh = SpreadsheetApp.getActiveSheet();',
    '  sh.clearContents();',
    '  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);',
    '}',
  ].join('\n');
  return {
    curl: `curl -H "Authorization: Bearer ${o.token}" \\\n  "${o.url}"`,
    sample,
    script,
  };
}
