import { dmCell } from './query';

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

/** Ячейка CSV: кавычки по RFC 4180; текст, похожий на формулу Excel, — с апострофом впереди. */
function csvCell(type: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (!NUMERIC.has(type) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Таблица CSV для Excel и Google Таблиц (`format=csv`): первая строка — названия столбцов, разделитель —
 * запятая, строки — CRLF, в начале — метка UTF-8 (BOM), чтобы Excel узнал кириллицу. Текст, который
 * начинается с «=», «+», «-» или «@», Excel принял бы за формулу — перед ним апостроф.
 */
export function dmExtCsv(
  cols: readonly DmExtColumn[],
  rows: readonly Record<string, unknown>[],
): string {
  const head = cols.map((c) => csvCell('text', c.title)).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(c.type, r[c.key])).join(','));
  return `\uFEFF${[head, ...body].join('\r\n')}\r\n`;
}
