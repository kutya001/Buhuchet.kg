/**
 * Запрос шаблона «Витрины данных» перед исполнителем (доработки 20.11.2026: Витрина данных, блок 2,
 * пункт 4; блок 8, пункт 1): параметры `:month`, `:date_from` в тексте запроса становятся `$1`, `$2` с
 * приведением к типу, а значения — отдельным списком: в текст запроса они не вклеиваются. Значения
 * проверяются по типам, лишние отбрасываются, пустые берут значение по умолчанию (прототип
 * `modules/vitrina.js`: `DM_PT`, `DM_DEF`, `dmDef`). Исполнитель — `runDmOrg` / `runDmAdmin` в
 * `@buhuchet/db`; проверка текста при сохранении (разрешённые функции, «цена») — этап 2.
 */
import { addDays, isIsoDate, type IsoDate } from '../common/dates';
import { addMonths, isYearMonth, lastDayOf, monthOf } from '../common/months';

/** Типы параметров (прототип `DM_PT`): значение из списка — контрагент, сотрудник, вид отчёта, статус. */
export const DM_PARAM_TYPES = [
  'date',
  'month',
  'year',
  'num',
  'text',
  'bool',
  'list:cp',
  'list:emp',
  'list:rtype',
  'list:status',
] as const;
export type DmParamType = (typeof DM_PARAM_TYPES)[number];

/** Значения по умолчанию словами (прототип `DM_DEF`); любое другое — само значение. */
export const DM_PARAM_DEFAULTS = [
  'today',
  'month',
  'year',
  'month_start',
  'month_end',
  'days_ago_30',
  'month_ago_5',
] as const;

/** Параметр шаблона (прототип `params[]`: `k`, `type`, `req`, `def`). */
export interface DmParamDef {
  k: string;
  type: DmParamType;
  req: boolean;
  def: string | null;
}

/** Параметров в одном шаблоне — не больше, чем принимает исполнитель базы (`dm.run_org`). */
export const DM_PARAMS_MAX = 20;
/** Текстовый параметр — до 500 знаков. */
export const DM_TEXT_PARAM_MAX = 500;

/**
 * Приведение `$n` к типу в тексте запроса: значение уходит в базу текстом и приводится там. Месяц —
 * текст `YYYY-MM`: готовые шаблоны пишут `to_date(:month, 'YYYY-MM')`.
 */
const CAST: Readonly<Record<DmParamType, string>> = {
  date: 'date',
  month: 'text',
  year: 'integer',
  num: 'numeric',
  text: 'text',
  bool: 'boolean',
  'list:cp': 'uuid',
  'list:emp': 'uuid',
  'list:rtype': 'text',
  'list:status': 'text',
};

export const isDmParamType = (v: string): v is DmParamType =>
  (DM_PARAM_TYPES as readonly string[]).includes(v);

/**
 * Почему текст запроса не годится для исполнителя: позиционный `$1`, второй оператор, незакрытая
 * строка или комментарий, непарные скобки, параметров больше `DM_PARAMS_MAX`, параметр, которого нет
 * в шаблоне.
 */
export type DmSqlProblem =
  | { problem: 'positional' }
  | { problem: 'two_statements' }
  | { problem: 'unclosed' }
  | { problem: 'parens' }
  | { problem: 'too_many_params' }
  | { problem: 'unknown_param'; name: string };

export interface DmParsedSql {
  /** Текст с `($n::тип)` вместо `:имя` и без последней «;». */
  text: string;
  /** Имена параметров по номеру: `names[0]` — `$1`. */
  names: string[];
}

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_]/;

/**
 * Разбор текста запроса по знакам, как его читает PostgreSQL: строки `'…'` и `E'…'`, имена `"…"`,
 * комментарии `--` и вложенные `/* *\/`, строки `$метка$…$метка$` и приведение `::` пропускаются;
 * `:имя` вне них — параметр. Позиционные `$1` запрещены (номера ставит система), «;» — только
 * последней (два оператора подряд отклоняются; исполнитель базы отклоняет их ещё раз сам). Скобки вне
 * строк и комментариев — парные: отбор «Свои» оборачивает весь текст подзапросом (`dmScopeQuery`), и
 * лишняя «)» вывела бы часть запроса из-под отбора (`… ) a UNION ALL SELECT * FROM ( …`).
 */
export function dmParseSql(sql: string, defs: readonly DmParamDef[]): DmParsedSql | DmSqlProblem {
  const byName = new Map(defs.map((d) => [d.k, d]));
  const names: string[] = [];
  let out = '';
  let i = 0;
  let depth = 0;
  const n = sql.length;
  const prevIsName = () => i > 0 && NAME_PART.test(sql[i - 1]!);
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "'") {
      // E'…' — с экранированием «\»; обычная строка — только удвоенной кавычкой.
      const escaped = i > 0 && /[Ee]/.test(sql[i - 1]!) && (i < 2 || !NAME_PART.test(sql[i - 2]!));
      let j = i + 1;
      for (;;) {
        if (j >= n) return { problem: 'unclosed' };
        if (escaped && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) return { problem: 'unclosed' };
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') break;
        else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const j = end < 0 ? n : end;
      out += sql.slice(i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      let depth = 0;
      let j = i;
      do {
        if (j >= n) return { problem: 'unclosed' };
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else j += 1;
      } while (depth > 0);
      out += sql.slice(i, j);
      i = j;
    } else if (c === '$' && !prevIsName()) {
      if (next !== undefined && /[0-9]/.test(next)) return { problem: 'positional' };
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (!tag) {
        out += c;
        i += 1;
        continue;
      }
      const end = sql.indexOf(tag[0], i + tag[0].length);
      if (end < 0) return { problem: 'unclosed' };
      out += sql.slice(i, end + tag[0].length);
      i = end + tag[0].length;
    } else if (c === ':' && next === ':') {
      out += '::';
      i += 2;
    } else if (c === ':' && next !== undefined && NAME_START.test(next)) {
      let j = i + 1;
      while (j < n && NAME_PART.test(sql[j]!)) j += 1;
      const name = sql.slice(i + 1, j);
      const def = byName.get(name);
      if (!def) return { problem: 'unknown_param', name };
      let num = names.indexOf(name) + 1;
      if (num === 0) num = names.push(name);
      out += `($${num}::${CAST[def.type]})`;
      i = j;
    } else if (c === ';') {
      if (!dmRestIsEmpty(sql.slice(i + 1))) return { problem: 'two_statements' };
      break;
    } else {
      if (c === '(') depth += 1;
      // ОТКЛОНЕНИЕ: docs/deviations.md#О-96 — прототип скобки не считает.
      else if (c === ')' && --depth < 0) return { problem: 'parens' };
      out += c;
      i += 1;
    }
  }
  if (depth !== 0) return { problem: 'parens' };
  return { text: out.trimEnd(), names };
}

/** После «;» — только пробелы и комментарии. */
function dmRestIsEmpty(rest: string): boolean {
  return rest.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() === '';
}

/** Значение по умолчанию на дату «сегодня» по Бишкеку (прототип `dmDef`). */
export function dmParamDefault(def: string | null, today: IsoDate): string | null {
  const month = monthOf(today);
  switch (def) {
    case null:
    case '':
      return null;
    case 'today':
      return today;
    case 'month':
      return month;
    case 'year':
      return today.slice(0, 4);
    case 'month_start':
      return `${month}-01`;
    case 'month_end':
      return lastDayOf(month);
    case 'days_ago_30':
      return addDays(today, -30);
    case 'month_ago_5':
      return addMonths(month, -5);
    default:
      return def;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const NUM = /^-?\d{1,18}(\.\d{1,6})?$/;

/** Значение параметра в виде, который примет база, или null — не подходит по типу. */
export function dmParamValue(type: DmParamType, raw: string): string | null {
  const v = raw.trim();
  switch (type) {
    case 'date':
      return isIsoDate(v) ? v : null;
    case 'month':
      return isYearMonth(v) ? v : null;
    case 'year':
      return /^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2100 ? v : null;
    case 'num':
      return NUM.test(v) ? v : null;
    case 'text':
      // Знак с кодом 0 база в тексте не принимает (22P05) — это неверный параметр, а не ошибка шаблона.
      return raw.length <= DM_TEXT_PARAM_MAX && !raw.includes('\u0000') ? raw : null;
    case 'bool':
      // Список «Да / Нет» прототипа отдаёт 1 и 0 (`dmParHtml`), адрес — true и false.
      if (v === 'true' || v === '1') return 'true';
      return v === 'false' || v === '0' ? 'false' : null;
    case 'list:cp':
    case 'list:emp':
      return UUID.test(v) ? v.toLowerCase() : null;
    case 'list:rtype':
    case 'list:status':
      return CODE.test(v) ? v : null;
  }
}

export type DmBound =
  | { ok: true; text: string; params: (string | null)[] }
  | ({ ok: false; error: 'sql' } & DmSqlProblem)
  /**
   * «Неверный параметр: <какой>» (блок 6, пункт 5): не подходит по типу, обязательный пуст или конец
   * периода раньше начала (прототип `dmParRead`: «По дату» раньше «С даты», «Месяц раньше начального»).
   */
  | { ok: false; error: 'param'; param: string; why: 'type' | 'required' | 'range' };

/** Пары «начало — конец» периода (прототип `dmParRead`): конец не раньше начала. */
const DM_RANGES = [
  ['date_from', 'date_to'],
  ['month_from', 'month_to'],
] as const;

/**
 * Запрос и значения для исполнителя: `input` — что пришло с экрана или из адреса (`?month=2026-11`);
 * параметров, которых нет в шаблоне, исполнитель не получает. Не передан — значение по умолчанию
 * (прототип `dmDef`, как в примере адреса `dmHow`); передан пустым — пусто, как форма прототипа
 * (`dmParRead`: `v || null`); обязательный без значения — ошибка параметра.
 */
export function dmBind(
  sql: string,
  defs: readonly DmParamDef[],
  input: Readonly<Record<string, string | null | undefined>>,
  today: IsoDate,
): DmBound {
  if (defs.length > DM_PARAMS_MAX) return { ok: false, error: 'sql', problem: 'too_many_params' };
  const parsed = dmParseSql(sql, defs);
  if ('problem' in parsed) return { ok: false, error: 'sql', ...parsed };
  const values = new Map<string, string | null>();
  for (const d of defs) {
    // Только свои поля входа: параметр `constructor` или `toString` не берёт метод объекта.
    const own = Object.hasOwn(input, d.k) ? input[d.k] : undefined;
    const given = typeof own === 'string' || own === null ? own : undefined;
    const raw = given === undefined ? dmParamDefault(d.def, today) : given;
    if (raw == null || raw === '') {
      if (d.req) return { ok: false, error: 'param', param: d.k, why: 'required' };
      values.set(d.k, null);
      continue;
    }
    const v = dmParamValue(d.type, raw);
    if (v === null) return { ok: false, error: 'param', param: d.k, why: 'type' };
    values.set(d.k, v);
  }
  for (const [from, to] of DM_RANGES) {
    const a = values.get(from);
    const b = values.get(to);
    if (a && b && a > b) return { ok: false, error: 'param', param: to, why: 'range' };
  }
  return { ok: true, text: parsed.text, params: parsed.names.map((k) => values.get(k) ?? null) };
}

/**
 * Значение ячейки во внешнем ответе и в таблице «Вывода» (блок 2, пункт 5): тип «деньги» — тыйыны из
 * базы в сомы числом (125050 → 1250.5); остальное — как ответила база. Пустые деньги остаются пустыми:
 * на экране — пустая ячейка (прототип `dmNumTxt`); во внешнем ответе прототип даёт 0 (`dmHow`) — это
 * решает внешний адрес (этап 2).
 */
export function dmCell(type: string, value: unknown): unknown {
  if (type !== 'money' || value === null || value === undefined) return value;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n / 100 : value;
}
