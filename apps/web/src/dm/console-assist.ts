import {
  DM_SQL_KEYWORDS,
  dmConsoleParamType,
  dmSqlFromSlots,
  dmSqlLex,
  dmSqlMoneyName,
  type DmSqlToken,
} from '@buhuchet/domain';
import type { DmSchemaField, DmSchemaMap, DmSchemaTable } from '@buhuchet/shared';

/*
 * Подсказки редактора запросов «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 3,
 * пункты 1–4; этап 1, П5; прототип v166 `modules/vitrina-console.js`: `dmcDb`, `dmcRefs`,
 * `dmcSuggest`, `dmcCard`, `dmcFieldCard`, `dmcIssues`). Чистые правила без CodeMirror: что предложить
 * у курсора, какая карточка у слова под мышью и какие таблицы и поля запроса базе неизвестны. Знания
 * о базе — карта `GET /api/admin/dm/console/schema` (поля из самой базы, закрытое роли шаблонов не
 * приходит); разбор текста — тот же лексер, что у правил консоли на сервере (`dmSqlLex`).
 */

/** Связь «поле этой таблицы → таблица.поле» и обратная. */
export interface SchemaLink {
  field: string;
  table: string;
  to: string;
}

/** Карта базы для подсказок: таблица по имени, кто на неё ссылается. */
export interface SchemaIndex {
  tables: ReadonlyMap<string, DmSchemaTable>;
  /** Ссылки на таблицу из других: `{ table: откуда, field, to: поле этой таблицы }`. */
  incoming: ReadonlyMap<string, readonly SchemaLink[]>;
  /** Группы по порядку появления (для левой панели «База»). */
  groups: readonly string[];
}

export function schemaIndex(map: DmSchemaMap): SchemaIndex {
  const tables = new Map(map.tables.map((t) => [t.name, t]));
  const incoming = new Map<string, SchemaLink[]>();
  const groups: string[] = [];
  for (const t of map.tables) {
    const g = t.group ?? '';
    if (!groups.includes(g)) groups.push(g);
    for (const f of t.fields) {
      if (!f.ref || !tables.has(f.ref.table)) continue;
      const list = incoming.get(f.ref.table) ?? [];
      list.push({ field: f.name, table: t.name, to: f.ref.field });
      incoming.set(f.ref.table, list);
    }
  }
  return { tables, incoming, groups };
}

/** Поля таблиц с типами — для перестройки запроса метода API (`dmMethodToSelect`). */
export function knownFields(index: SchemaIndex): Map<string, Map<string, string>> {
  return new Map(
    [...index.tables.values()].map((t) => [t.name, new Map(t.fields.map((f) => [f.name, f.type]))]),
  );
}

/** Поле — деньги в тыйынах: так названо или так сказано в описании (прототип `dmcDb` → `money`). */
export function fieldIsMoney(field: DmSchemaField): boolean {
  const integer = field.type === 'bigint' || field.type === 'integer';
  return (
    integer &&
    (dmSqlMoneyName(field.name) || /\u0442\u044b\u0439\u044b\u043d/i.test(field.description ?? ''))
  );
}

/**
 * Функции, разрешённые шаблонам, с коротким примером (блок 3, пункт 2; прототип `DMC_FN`); описание —
 * ключ словаря `dm.con.fn.<имя>`.
 */
export const CONSOLE_FUNCTIONS: readonly (readonly [string, string])[] = [
  ['sum', 'sum(r.amount)'],
  ['count', 'count(*)'],
  ['avg', 'avg(x.value)'],
  ['min', 'min(r.due_date)'],
  ['max', 'max(r.due_date)'],
  ['coalesce', 'coalesce(r.amount, 0)'],
  ['nullif', 'nullif(x, 0)'],
  ['round', 'round(r.amount / 100.0, 2)'],
  ['date_trunc', "date_trunc('month', r.due_date)"],
  ['to_char', "to_char(r.due_date, 'YYYY-MM')"],
  ['extract', 'extract(year from r.due_date)'],
  ['current_date', 'current_date'],
  ['now', 'now()'],
  ['string_agg', "string_agg(c.name, ', ')"],
  ['greatest', 'greatest(a, b)'],
  ['least', 'least(a, b)'],
  ['lower', 'lower(c.name)'],
  ['upper', 'upper(c.name)'],
  ['trim', 'trim(c.name)'],
  ['concat', "concat(e.last_name, ' ', e.first_name)"],
];

/** Слова SQL подсказки (прототип `DMC_SQLKW`). */
const KEYWORDS = [
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'as',
  'on',
  'join',
  'left join',
  'inner join',
  'group by',
  'order by',
  'having',
  'limit',
  'offset',
  'distinct',
  'case',
  'when',
  'then',
  'else',
  'end',
  'with',
  'union all',
  'exists',
  'between',
  'like',
  'ilike',
  'asc',
  'desc',
  'over',
  'partition by',
  'filter',
];

/** Таблица запроса: где написана, её псевдоним, после какого слова. */
export interface SqlRef {
  kw: 'from' | 'join' | 'comma';
  table: string;
  alias: string;
  at: number;
  len: number;
}

const significant = (toks: readonly DmSqlToken[]) =>
  toks.filter((t) => t.kind !== 'space' && t.kind !== 'comment');

const NOT_ALIAS = new Set([
  'on',
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'group',
  'order',
  'limit',
  'offset',
  'union',
  'having',
  'using',
  'natural',
  'lateral',
  'window',
  'for',
  'except',
  'intersect',
  'and',
  'or',
  'as',
  'select',
  'from',
  'set',
  'values',
  'returning',
]);

/** Таблицы запроса по порядку и имена из WITH (прототип `dmcRefs`). */
export function sqlRefs(sql: string): {
  refs: SqlRef[];
  aliases: Map<string, string>;
  cte: Set<string>;
} {
  const sig = significant(dmSqlLex(sql));
  const refs: SqlRef[] = [];
  const aliases = new Map<string, string>();
  const cte = new Set<string>();
  const low = (k: number) => sig[k]?.text.toLowerCase() ?? '';
  // Запятая — только в списке таблиц после FROM (не «ORDER BY day, org»), docs/typical-mistakes.md № 89.
  const slots = dmSqlFromSlots(sig);
  for (let k = 0; k < sig.length; k += 1) {
    const w = low(k);
    // «WITH имя AS (» и «, имя AS (» — свои имена запроса.
    if ((w === 'with' || w === ',') && sig[k + 1]?.kind === 'word') {
      let n = k + 1;
      if (low(n) === 'recursive') n += 1;
      if (low(n + 1) === 'as' && sig[n + 2]?.text === '(') cte.add(low(n));
    }
    if (!slots.has(k)) continue;
    const comma = w === ',';
    const kw = comma ? 'comma' : w === 'join' ? 'join' : 'from';
    let p = k + 1;
    if (sig[p]?.kind !== 'word') continue;
    const first = sig[p]!;
    let table = low(p);
    let len = first.text.length;
    if (sig[p + 1]?.text === '.' && sig[p + 2]?.kind === 'word') {
      if (table !== 'public') continue;
      table = low(p + 2);
      len = sig[p + 2]!.start + sig[p + 2]!.text.length - first.start;
      p += 2;
    }
    if (sig[p + 1]?.text === '(' || DM_SQL_KEYWORDS.has(table)) continue;
    let a = p + 1;
    if (low(a) === 'as') a += 1;
    const al = sig[a];
    const alias =
      al &&
      al.kind === 'word' &&
      !NOT_ALIAS.has(al.text.toLowerCase()) &&
      !DM_SQL_KEYWORDS.has(al.text.toLowerCase())
        ? al.text.toLowerCase()
        : table;
    refs.push({ kw, table, alias, at: first.start, len });
    aliases.set(alias, table);
    if (!aliases.has(table)) aliases.set(table, table);
  }
  return { refs, aliases, cte };
}

/** Строка подсказки: что видно, пояснение, что вставить и вид (значок). */
export interface AssistItem {
  label: string;
  detail: string;
  apply: string;
  type: 'table' | 'field' | 'function' | 'keyword' | 'alias' | 'join';
  /** Поле без описания: пояснение бледнее. */
  plain?: boolean;
}

export interface AssistTexts {
  noDesc: string;
  money: string;
  closed: string;
  keyword: string;
  join: string;
  alias: (table: string) => string;
  fn: (name: string) => string;
}

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$\u0400-\u04ff]/.test(c);

/** Тип поля словами: деньги — «Деньги», иначе тип базы. */
export const fieldKind = (f: DmSchemaField, texts: Pick<AssistTexts, 'money'>) =>
  fieldIsMoney(f) ? texts.money : f.type;

/** Курсор внутри строки, имени в кавычках или комментария — подсказок нет. */
function insideLiteral(toks: readonly DmSqlToken[], pos: number): boolean {
  for (const t of toks) {
    if (t.start >= pos) break;
    const end = t.start + t.text.length;
    if (t.kind !== 'string' && t.kind !== 'comment' && t.kind !== 'quoted') continue;
    if (pos < end || (pos === end && t.open)) return true;
    // Строчный комментарий идёт до конца строки.
    if (pos === end && t.kind === 'comment' && t.text.startsWith('--')) return true;
  }
  return false;
}

/**
 * Что предложить у курсора (прототип `dmcSuggest`): после «псевдоним.» — поля таблицы; после FROM и
 * JOIN — таблицы (поиск и по-русски); после ON — условия по связям таблиц; иначе от двух букв —
 * функции, слова SQL и псевдонимы. `force` — Ctrl+Пробел: и без букв.
 */
export function assistAt(
  sql: string,
  pos: number,
  index: SchemaIndex,
  texts: AssistTexts,
  opts: { force?: boolean; org?: boolean } = {},
): { from: number; items: AssistItem[] } | null {
  const toks = dmSqlLex(sql);
  if (insideLiteral(toks, pos)) return null;
  let from = pos;
  while (from > 0 && isWordChar(sql[from - 1])) from -= 1;
  const pre = sql.slice(from, pos);
  const pl = pre.toLowerCase();
  const { refs, aliases } = sqlRefs(sql);

  // «псевдоним.поле»
  if (sql[from - 1] === '.') {
    let a = from - 1;
    while (a > 0 && isWordChar(sql[a - 1])) a -= 1;
    const alias = sql.slice(a, from - 1).toLowerCase();
    const table = index.tables.get(aliases.get(alias) ?? alias);
    if (!table) return null;
    // Шаблон «Для организаций» и «Выполнять как организация» закрытого не предлагают (прототип v167).
    const items = table.fields
      .filter((f) => !opts.org || f.orgVisible)
      .filter((f) => !pl || f.name.startsWith(pl) || (f.title ?? '').toLowerCase().includes(pl))
      .map<AssistItem>((f) => ({
        label: f.name,
        detail: `${fieldKind(f, texts)} · ${f.title || texts.noDesc}`,
        apply: f.name,
        type: 'field',
        ...(f.title || f.description ? {} : { plain: true }),
      }));
    return items.length ? { from, items } : null;
  }

  const before = significant(toks.filter((t) => t.start + t.text.length <= from));
  const prev = before[before.length - 1]?.text.toLowerCase();
  if (prev === 'from' || prev === 'join') {
    const rank = (t: DmSchemaTable) =>
      !pl
        ? 0
        : t.name.startsWith(pl)
          ? 0
          : (t.title ?? '').toLowerCase().startsWith(pl)
            ? 1
            : t.name.includes(pl)
              ? 2
              : 3;
    const items = [...index.tables.values()]
      .filter((t) => !opts.org || t.orgVisible)
      .filter((t) => !pl || t.name.includes(pl) || (t.title ?? '').toLowerCase().includes(pl))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .slice(0, 40)
      .map<AssistItem>((t) => ({
        label: t.name,
        detail: t.title ?? '',
        apply: t.name,
        type: 'table',
      }));
    return items.length ? { from, items } : null;
  }
  if (prev === 'on' && !pre) {
    const last = refs.filter((r) => r.kw === 'join').pop();
    const x = last && index.tables.get(last.table);
    if (!last || !x) return null;
    const out = new Set<string>();
    for (const r of refs) {
      if (r === last) continue;
      const y = index.tables.get(r.table);
      if (!y) continue;
      for (const f of x.fields)
        if (f.ref?.table === y.name) out.add(`${last.alias}.${f.name} = ${r.alias}.${f.ref.field}`);
      for (const f of y.fields)
        if (f.ref?.table === x.name) out.add(`${r.alias}.${f.name} = ${last.alias}.${f.ref.field}`);
    }
    const items = [...out].map<AssistItem>((c) => ({
      label: c,
      detail: texts.join,
      apply: c,
      type: 'join',
    }));
    return items.length ? { from: pos, items } : null;
  }
  // Место псевдонима таблицы («FROM contractors |») — без подсказки.
  const p2 = before[before.length - 2]?.text.toLowerCase();
  if (!opts.force && (p2 === 'from' || p2 === 'join') && before[before.length - 1]?.kind === 'word')
    return null;
  if (pre.length < 2 && !opts.force) return null;
  const items: AssistItem[] = [
    ...CONSOLE_FUNCTIONS.filter(([n]) => n.startsWith(pl)).map<AssistItem>(([n, ex]) => ({
      label: n,
      detail: `${texts.fn(n)} · ${ex}`,
      apply: ex,
      type: 'function',
    })),
    ...KEYWORDS.filter((k) => k.startsWith(pl) && k !== pl).map<AssistItem>((k) => ({
      label: k.toUpperCase(),
      detail: texts.keyword,
      apply: k.toUpperCase(),
      type: 'keyword',
    })),
    ...[...aliases.keys()]
      .filter((a) => a.startsWith(pl) && a !== pl)
      .map<AssistItem>((a) => ({
        label: a,
        detail: texts.alias(aliases.get(a)!),
        apply: a,
        type: 'alias',
      })),
  ].slice(0, 30);
  return items.length ? { from, items } : null;
}

/** Что под мышью: таблица или поле таблицы запроса (прототип `dmcCard`, `dmcFieldCard`). */
export type HoverTarget =
  | { kind: 'table'; table: DmSchemaTable; from: number; to: number }
  | { kind: 'field'; table: DmSchemaTable; field: DmSchemaField; from: number; to: number };

export function hoverAt(sql: string, pos: number, index: SchemaIndex): HoverTarget | null {
  const toks = dmSqlLex(sql);
  const k = toks.findIndex(
    (t) => t.kind === 'word' && t.start <= pos && pos <= t.start + t.text.length,
  );
  if (k < 0) return null;
  const w = toks[k]!;
  const span = { from: w.start, to: w.start + w.text.length };
  const name = w.text.toLowerCase();
  const { aliases } = sqlRefs(sql);
  if (toks[k - 1]?.text === '.' && toks[k - 2]?.kind === 'word') {
    const table = index.tables.get(aliases.get(toks[k - 2]!.text.toLowerCase()) ?? '');
    const field = table?.fields.find((f) => f.name === name);
    return table && field ? { kind: 'field', table, field, ...span } : null;
  }
  const table = index.tables.get(toks[k + 1]?.text === '.' ? (aliases.get(name) ?? name) : name);
  return table ? { kind: 'table', table, ...span } : null;
}

/** Неизвестная таблица или поле: отрезок текста и что не так (прототип `dmcIssues`, часть про базу). */
export interface SchemaMark {
  from: number;
  to: number;
  code: 'no_table' | 'no_field' | 'org_closed';
  table: string;
  field?: string;
}

/** Функции на месте таблицы (FROM generate_series(…)) — не таблицы базы. */
const TABLE_FUNCTIONS = /^(generate_series|unnest|jsonb_\w+|json_\w+)$/;
/** Схемы, поля которых карта не описывает. */
const SKIP_PREFIX = new Set(['app', 'public', 'pg_catalog', 'dm']);

export function schemaMarks(
  sql: string,
  index: SchemaIndex,
  opts: { org?: boolean } = {},
): SchemaMark[] {
  const out: SchemaMark[] = [];
  const { refs, aliases, cte } = sqlRefs(sql);
  for (const r of refs) {
    if (cte.has(r.table) || TABLE_FUNCTIONS.test(r.table)) continue;
    const t = index.tables.get(r.table);
    if (!t) out.push({ from: r.at, to: r.at + r.len, code: 'no_table', table: r.table });
    else if (opts.org && !t.orgVisible)
      out.push({ from: r.at, to: r.at + r.len, code: 'org_closed', table: r.table });
  }
  const toks = dmSqlLex(sql);
  for (let k = 0; k + 2 < toks.length; k += 1) {
    const a = toks[k]!;
    if (a.kind !== 'word' || toks[k + 1]!.text !== '.' || toks[k + 2]!.kind !== 'word') continue;
    if (toks[k + 3]?.text === '(' || toks[k - 1]?.text === '.') continue;
    const alias = a.text.toLowerCase();
    if (SKIP_PREFIX.has(alias)) continue;
    const tn = aliases.get(alias);
    if (!tn || cte.has(tn)) continue;
    const t = index.tables.get(tn);
    const f = toks[k + 2]!;
    const name = f.text.toLowerCase();
    if (t && !t.fields.some((x) => x.name === name)) {
      out.push({
        from: f.start,
        to: f.start + f.text.length,
        code: 'no_field',
        table: tn,
        field: name,
      });
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** Параметры `:имя` текста по порядку появления (без `::тип`). */
export function consoleParamNames(sql: string): string[] {
  const out: string[] = [];
  for (const t of dmSqlLex(sql)) {
    if (t.kind !== 'param' || !t.text.startsWith(':')) continue;
    const name = t.text.slice(1);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Поле параметра: месяц, дата или текст — по имени (прототип: `month`, `date`, `_from`, `_to`). */
export function consoleParamType(name: string): 'month' | 'date' | 'text' {
  const type = dmConsoleParamType(name);
  return type === 'year' ? 'text' : type;
}
