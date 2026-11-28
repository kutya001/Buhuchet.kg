import type { DmParamType } from './query';
import { dmSqlDeniedWord } from './sql-rules';

/*
 * Консоль запросов «Витрины данных» Админки, этап 1 (доработки 27.11.2026: консоль запросов, блоки 1, 3–5;
 * прототип v166 `modules/vitrina-console.js`; docs/decisions.md п. О-69). Чистые правила экрана:
 * оператор под курсором («Выполнить» без выделения), быстрая проверка в браузере (незакрытые кавычки и
 * скобки — сразу, остальное — сервер, `POST …/console/check`), «Форматировать» и перестройка запроса
 * метода API в SELECT. Всё — по одному разбору текста на слова (`dmSqlLex`): без регулярных выражений с
 * перебором (docs/typical-mistakes.md № 83).
 */

/**
 * Тип параметра консоли по имени (прототип v166: поле над результатом — `month` → месяц, `date`,
 * `_from`, `_to` → дата; `dmcToTpl` — ещё `year` → год), когда тип не пришёл из шаблона: значение
 * уходит в базу с приведением, и `r.due_date >= :date_from` или `extract(year …) = :year` работают без
 * `::date` в тексте. Остальное — текст.
 */
export function dmConsoleParamType(name: string): 'month' | 'date' | 'year' | 'text' {
  if (name.includes('month')) return 'month';
  if (name.includes('date') || name.endsWith('_from') || name.endsWith('_to')) return 'date';
  if (name.includes('year')) return 'year';
  return 'text';
}

/** Типы параметров консоли: пришедший из шаблона, иначе по имени. */
export function dmConsoleParamTypes(
  names: readonly string[],
  given: Readonly<Record<string, DmParamType>> | undefined,
): DmParamType[] {
  return names.map((k) => (given && Object.hasOwn(given, k) ? given[k]! : dmConsoleParamType(k)));
}

/** Кусок текста запроса: слово, строка, комментарий, параметр, знак или пробелы. */
export interface DmSqlToken {
  kind: 'word' | 'quoted' | 'string' | 'comment' | 'number' | 'param' | 'punct' | 'space';
  text: string;
  /** С какого знака текста (с нуля). */
  start: number;
  /** У строки, имени в кавычках и многострочного комментария — нет закрывающей. */
  open?: boolean;
}

const isWordStart = (c: string | undefined) => !!c && /[A-Za-z_Ѐ-ӿ]/.test(c);
const isWordPart = (c: string | undefined) => !!c && /[A-Za-z0-9_$Ѐ-ӿ]/.test(c);
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** Разобрать текст на куски; склейка `text` всех кусков — исходный текст. */
export function dmSqlLex(sql: string): DmSqlToken[] {
  const out: DmSqlToken[] = [];
  const n = sql.length;
  let i = 0;
  const push = (kind: DmSqlToken['kind'], end: number, open?: boolean) => {
    out.push(
      open
        ? { kind, text: sql.slice(i, end), start: i, open }
        : { kind, text: sql.slice(i, end), start: i },
    );
    i = end;
  };
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (isSpace(c)) {
      let j = i + 1;
      while (j < n && isSpace(sql[j])) j += 1;
      push('space', j);
    } else if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      push('comment', end < 0 ? n : end);
    } else if (c === '/' && next === '*') {
      let depth = 0;
      let j = i;
      while (j < n) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else j += 1;
      }
      push('comment', Math.min(j, n), depth > 0);
    } else if (c === "'") {
      const prev = out[out.length - 1];
      const escaped = !!prev && prev.kind === 'word' && /^[Ee]$/.test(prev.text);
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (escaped && sql[j] === '\\') j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") {
          closed = true;
          j += 1;
          break;
        } else j += 1;
      }
      push('string', Math.min(j, n), !closed);
    } else if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') {
          closed = true;
          j += 1;
          break;
        } else j += 1;
      }
      push('quoted', Math.min(j, n), !closed);
    } else if (c === '$' && next === '{') {
      // `${…}` из кода метода — подстановка значения.
      const end = sql.indexOf('}', i + 2);
      push('param', end < 0 ? n : end + 1);
    } else if (c === '$' && isDigit(next)) {
      let j = i + 1;
      while (j < n && isDigit(sql[j])) j += 1;
      push('param', j);
    } else if (c === '$' && (next === '$' || isWordStart(next))) {
      // Строка `$метка$…$метка$`.
      let j = i + 1;
      while (j < n && sql[j] !== '$' && isWordPart(sql[j]) && sql[j] !== '$') j += 1;
      if (sql[j] !== '$') {
        push('punct', i + 1);
        continue;
      }
      const tag = sql.slice(i, j + 1);
      const end = sql.indexOf(tag, j + 1);
      push('string', end < 0 ? n : end + tag.length, end < 0);
    } else if (c === ':' && next === ':') {
      push('punct', i + 2);
    } else if (c === ':' && isWordStart(next) && !isWordPart(sql[i - 1])) {
      let j = i + 1;
      while (j < n && isWordPart(sql[j]) && sql[j] !== '$') j += 1;
      push('param', j);
    } else if (isWordStart(c)) {
      let j = i + 1;
      while (j < n && isWordPart(sql[j])) j += 1;
      push('word', j);
    } else if (isDigit(c) || (c === '.' && isDigit(next))) {
      let j = i + 1;
      while (j < n && (isDigit(sql[j]) || sql[j] === '.')) j += 1;
      push('number', j);
    } else {
      // Знаки сравнения из двух — одним куском.
      const two = sql.slice(i, i + 2);
      push('punct', ['<=', '>=', '<>', '!=', '||', '->'].includes(two) ? i + 2 : i + 1);
    }
  }
  return out;
}

const upper = (t: DmSqlToken) => (t.kind === 'word' ? t.text.toUpperCase() : '');

/** Операторы текста: начало и конец каждого (без «;» и пробелов вокруг); пустые не считаются. */
export function dmSqlStatements(sql: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let from = -1;
  let to = -1;
  for (const t of dmSqlLex(sql)) {
    if (t.kind === 'punct' && t.text === ';') {
      if (from >= 0) out.push({ from, to });
      from = -1;
      continue;
    }
    if (t.kind === 'space' || t.kind === 'comment') continue;
    if (from < 0) from = t.start;
    to = t.start + t.text.length;
  }
  if (from >= 0) out.push({ from, to });
  return out;
}

/**
 * «Выполнить» и Ctrl+Enter (блок 1, пункт 3): выделенный текст, а без выделения — оператор под курсором
 * (или ближайший перед ним). В базу уходит один оператор; пусто — `null`.
 */
export function dmSqlRunText(sql: string, selFrom: number, selTo: number): string | null {
  if (selTo > selFrom) {
    const picked = sql.slice(selFrom, selTo).trim();
    return picked ? picked.replace(/;$/, '').trimEnd() : null;
  }
  const list = dmSqlStatements(sql);
  if (!list.length) return null;
  let pick = list[0]!;
  for (const s of list) if (s.from <= selFrom) pick = s;
  return sql.slice(pick.from, pick.to);
}

/** Ошибка текста с местом: позиция с нуля, длина подчёркивания. */
export interface DmSqlMark {
  from: number;
  to: number;
  code:
    'unclosed_string' | 'unclosed_quoted' | 'unclosed_comment' | 'unclosed_paren' | 'extra_paren';
}

/**
 * Быстрая проверка в браузере по ходу набора (блок 3, пункт 4): незакрытые кавычки, комментарий и скобки
 * видны сразу; остальное (синтаксис, запрещённое) — разборщик на сервере с задержкой (п. О-69).
 */
export function dmSqlQuickMarks(sql: string): DmSqlMark[] {
  const marks: DmSqlMark[] = [];
  const opens: number[] = [];
  for (const t of dmSqlLex(sql)) {
    if (t.open) {
      const code =
        t.kind === 'string'
          ? 'unclosed_string'
          : t.kind === 'quoted'
            ? 'unclosed_quoted'
            : 'unclosed_comment';
      marks.push({ from: t.start, to: t.start + 1, code });
    } else if (t.kind === 'punct' && t.text === '(') opens.push(t.start);
    else if (t.kind === 'punct' && t.text === ')') {
      if (opens.length) opens.pop();
      else marks.push({ from: t.start, to: t.start + 1, code: 'extra_paren' });
    } else if (t.kind === 'punct' && t.text === ';') {
      for (const o of opens) marks.push({ from: o, to: o + 1, code: 'unclosed_paren' });
      opens.length = 0;
    }
  }
  for (const o of opens) marks.push({ from: o, to: o + 1, code: 'unclosed_paren' });
  return marks;
}

/** Слова, которые в конце выражения — не имя столбца (прототип `dmcIssues`). */
const NOT_ALIAS = new Set(['end', 'null', 'true', 'false', 'asc', 'desc']);

/**
 * Выражения первого списка SELECT без имени (блок 3, пункт 4; прототип `dmcIssues`: «Дайте столбцу имя
 * через AS»): `count(*)`, `a + 1`, `x::int`. Без отметки — `*`, `t.*`, поле, `t.поле`, «… AS имя» и
 * имя через пробел («sum(x) total»). Отрезки — от первого до последнего знака выражения.
 */
export function dmSqlNoAliasMarks(sql: string): { from: number; to: number }[] {
  const toks = dmSqlLex(sql);
  const lower = (t: DmSqlToken | undefined) => (t?.kind === 'word' ? t.text.toLowerCase() : '');
  let k = toks.findIndex((t) => lower(t) === 'select');
  if (k < 0) return [];
  k += 1;
  const sigAt = (j: number) => {
    let p = j;
    while (toks[p] && (toks[p]!.kind === 'space' || toks[p]!.kind === 'comment')) p += 1;
    return p;
  };
  const d = sigAt(k);
  if (lower(toks[d]) === 'distinct') k = d + 1;
  const items: DmSqlToken[][] = [];
  let cur: DmSqlToken[] = [];
  let depth = 0;
  for (; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.kind === 'punct' && t.text === '(') depth += 1;
    else if (t.kind === 'punct' && t.text === ')') {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && t.kind === 'punct' && t.text === ';') break;
    else if (depth === 0 && lower(t) === 'from') break;
    else if (depth === 0 && t.kind === 'punct' && t.text === ',') {
      items.push(cur);
      cur = [];
      continue;
    }
    if (t.kind !== 'space' && t.kind !== 'comment') cur.push(t);
  }
  items.push(cur);
  const name = (t: DmSqlToken | undefined) => t?.kind === 'word' || t?.kind === 'quoted';
  const out: { from: number; to: number }[] = [];
  for (const it of items) {
    if (!it.length) continue;
    const n = it.length;
    const last = it[n - 1]!;
    const prev = it[n - 2];
    if (n === 1 && (name(last) || last.text === '*')) continue;
    if (
      n === 3 &&
      it[0]!.kind === 'word' &&
      it[1]!.text === '.' &&
      (name(last) || last.text === '*')
    )
      continue;
    if (name(last) && lower(prev) === 'as') continue;
    if (
      last.kind === 'word' &&
      !NOT_ALIAS.has(last.text.toLowerCase()) &&
      prev &&
      (prev.kind === 'word' ||
        prev.kind === 'number' ||
        prev.kind === 'string' ||
        prev.kind === 'quoted' ||
        prev.text === ')') &&
      prev.start + prev.text.length < last.start
    )
      continue;
    out.push({ from: it[0]!.start, to: last.start + last.text.length });
  }
  return out;
}

/** Слова SQL, которые «Форматировать» пишет заглавными. */
export const DM_SQL_KEYWORDS: ReadonlySet<string> = new Set(
  (
    'select from where and or not in is null as on join left right full inner outer cross lateral group by ' +
    'order having limit offset union all distinct with recursive case when then else end asc desc nulls ' +
    'first last between like ilike exists any some true false interval filter over partition window ' +
    'cast coalesce nullif using except intersect values'
  ).split(' '),
);

/** Начало раздела оператора: перенос строки перед ним (на нулевой глубине скобок). */
const CLAUSES = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'ORDER',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'WINDOW',
  'JOIN',
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'CROSS',
]);

/**
 * «Форматировать» (блок 3, пункт 5): слова SQL заглавными, разделы оператора с новой строки, «AND» и «OR»
 * условия — с новой строки с отступом, столбцы SELECT — по одному в строке. Строки, имена в кавычках и
 * комментарии не меняются; текст без разделов (одно слово) — как был.
 */
export function dmSqlFormat(sql: string): string {
  const toks = dmSqlLex(sql.trim());
  let out = '';
  let depth = 0;
  let clause = '';
  let lineStart = true;
  const pad = () => '  '.repeat(Math.max(0, depth));
  const nl = (indent: string) => {
    out = out.trimEnd() + '\n' + indent;
    lineStart = true;
  };
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.kind === 'space') {
      if (t.text.includes('\n') && toks[k - 1]?.kind === 'comment')
        nl(pad() + (clause ? '  ' : ''));
      else if (!lineStart && !out.endsWith(' ')) out += ' ';
      continue;
    }
    const w = upper(t);
    const kw = DM_SQL_KEYWORDS.has(w.toLowerCase());
    const prevWord = (() => {
      for (let j = k - 1; j >= 0; j -= 1) {
        const p = toks[j]!;
        if (p.kind !== 'space' && p.kind !== 'comment') return upper(p);
      }
      return '';
    })();
    // Новый раздел — с новой строки: «LEFT JOIN», «GROUP BY» — одной строкой.
    const joinTail =
      w === 'JOIN' && ['LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'OUTER'].includes(prevWord);
    const outerTail = w === 'OUTER' && ['LEFT', 'RIGHT', 'FULL'].includes(prevWord);
    if (CLAUSES.has(w) && !joinTail && !outerTail && out.trim()) {
      nl(pad());
      clause = w;
    } else if (CLAUSES.has(w) && !out.trim()) clause = w;
    else if (
      (w === 'AND' || w === 'OR') &&
      (clause === 'WHERE' || clause === 'HAVING' || clause === 'JOIN')
    ) {
      // «BETWEEN … AND …» — не условие.
      let between = false;
      for (let j = k - 1; j >= 0; j -= 1) {
        const p = upper(toks[j]!);
        if (p === 'BETWEEN') {
          between = true;
          break;
        }
        if (p === 'AND' || p === 'OR' || CLAUSES.has(p)) break;
      }
      if (!between) nl(pad() + '  ');
    }
    if (t.kind === 'punct' && t.text === '(') depth += 1;
    if (t.kind === 'punct' && t.text === ')') depth -= 1;
    const text = kw ? w : t.text;
    const glue =
      t.kind === 'punct' && [',', ')', '.', ';', '::'].includes(t.text)
        ? ''
        : out.endsWith('(') ||
            out.endsWith('.') ||
            out.endsWith('::') ||
            lineStart ||
            out.endsWith(' ')
          ? ''
          : ' ';
    if (t.kind === 'punct' && t.text === '(' && out && !out.endsWith(' ') && !lineStart) {
      // «count(*)» — без пробела после имени функции, «IN (» — с пробелом.
      out += DM_SQL_KEYWORDS.has(prevWord.toLowerCase()) ? ' ' : '';
    } else out += glue;
    out += text;
    lineStart = false;
    if (t.kind === 'punct' && t.text === ',' && clause === 'SELECT' && depth === 0)
      nl(pad() + '  ');
    else if (w === 'SELECT' || (w === 'DISTINCT' && prevWord === 'SELECT')) {
      const nextTok = toks.slice(k + 1).find((x) => x.kind !== 'space' && x.kind !== 'comment');
      if (!(nextTok && upper(nextTok) === 'DISTINCT')) nl(pad() + '  ');
    }
  }
  return out
    .trimEnd()
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');
}

/** Столбцы с деньгами по имени (как прототип `dmcRewrite`): тип «Деньги» в шаблоне, значения — тыйыны. */
export function dmSqlMoneyName(name: string): boolean {
  const n = name.toLowerCase();
  if (['amount', 'sum', 'paid', 'debt', 'price', 'fee', 'balance', 'total'].includes(n))
    return true;
  return ['amount', 'sum', 'paid', 'debt', 'price', 'fee', 'balance', 'tyiyn'].some((w) =>
    n.endsWith('_' + w),
  );
}

/** Имя параметра `:имя` из выражения кода метода или номера `$1`. */
function paramName(raw: string): string {
  const words = raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const base = words[words.length - 1] ?? 'p';
  const snake = base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  return /^[0-9]/.test(snake) ? 'p' + snake : snake || 'p';
}

/**
 * Пометка над редактором: код текста словаря (`dm.con.rw.<код>`) и подстановки — экран пишет её словами
 * «Локализации».
 */
export type DmRewriteCode =
  | 'view'
  | 'checks'
  | 'param'
  | 'user'
  | 'money'
  | 'table_param'
  | 'denied'
  | 'lock'
  | 'svc'
  | 'cut'
  | 'closed_tables'
  | 'closed_fields';
export interface DmRewriteNote {
  code: DmRewriteCode;
  vars: Record<string, string>;
}

/** Итог перестройки запроса метода API в SELECT (блок 5, пункт 2). */
export interface DmMethodRewrite {
  /** Готовый текст; `null` — запрос метода не SELECT, шаблона из него не сделать. */
  sql: string | null;
  /** Параметры `:имя` по порядку появления. */
  params: string[];
  /** Что заменено само. */
  changed: DmRewriteNote[];
  /** Что заменить руками, иначе запрос не выполнится (служебные функции, таблица параметром, обрезанный текст). */
  replace: DmRewriteNote[];
  /** Столбцы, которым ставится тип «Деньги» (значения — тыйыны). */
  money: string[];
}

/** Проверка доступа в тексте: «это администратор» или «моя организация» — `[from, to)` в кусках. */
function checkAt(toks: DmSqlToken[], k: number): number {
  const seq = (j: number, ...want: string[]): number => {
    let p = j;
    for (const w of want) {
      while (toks[p] && toks[p]!.kind === 'space') p += 1;
      const t = toks[p];
      if (!t) return -1;
      if (w === '*w') {
        if (t.kind !== 'word') return -1;
      } else if (t.text.toLowerCase() !== w) return -1;
      p += 1;
    }
    return p;
  };
  let e = seq(k, 'app', '.', 'is_platform_admin', '(', ')');
  if (e > 0) return e;
  e = seq(k, '(', 'select', 'app', '.', 'is_platform_admin', '(', ')', ')');
  if (e > 0) return e;
  e = seq(k, 'app', '.', 'current_org_id', '(', ')', '=');
  if (e > 0) {
    const e2 = seq(e, '*w', '.', 'org_id');
    if (e2 > 0) return e2;
    const e3 = seq(e, 'org_id');
    if (e3 > 0) return e3;
  }
  for (const head of [seq(k, '*w', '.', 'org_id'), seq(k, 'org_id')]) {
    if (head < 0) continue;
    const e4 = seq(head, '=', 'app', '.', 'current_org_id', '(', ')');
    if (e4 > 0) return e4;
  }
  return -1;
}

const ENDS = new Set([
  'GROUP',
  'ORDER',
  'LIMIT',
  'UNION',
  'HAVING',
  'WINDOW',
  'OFFSET',
  'EXCEPT',
  'INTERSECT',
]);

/**
 * Перестроить запрос метода API в SELECT для консоли и шаблона (блок 5, пункт 2; прототип `dmcRewrite`).
 * `svcComment` — текст комментария `-- …` у служебной функции в строке запроса, `{list}` — их имена
 * (экран берёт его из словаря).
 */
export function dmMethodToSelect(
  src: string,
  known?: ReadonlyMap<string, ReadonlyMap<string, string>>,
  svcComment = '{list}',
): DmMethodRewrite {
  const note = (code: DmRewriteCode, vars: Record<string, string> = {}): DmRewriteNote => ({
    code,
    vars,
  });
  const res: DmMethodRewrite = { sql: null, params: [], changed: [], replace: [], money: [] };
  let toks = dmSqlLex(src.trim());
  // Конец: «;» и пробелы.
  while (
    toks.length &&
    (toks[toks.length - 1]!.kind === 'space' || toks[toks.length - 1]!.text === ';')
  )
    toks.pop();
  const sig = () => toks.filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  // CREATE [OR REPLACE] VIEW имя [WITH (…)] AS
  const s0 = sig();
  if (upper(s0[0] ?? toks[0]!) === 'CREATE') {
    let p = 1;
    if (upper(s0[p]!) === 'OR' && upper(s0[p + 1]!) === 'REPLACE') p += 2;
    if (upper(s0[p]!) === 'VIEW') {
      const name: string[] = [];
      p += 1;
      while (s0[p] && upper(s0[p]!) !== 'WITH' && upper(s0[p]!) !== 'AS') name.push(s0[p++]!.text);
      if (upper(s0[p]!) === 'WITH' && s0[p + 1]?.text === '(') {
        let d = 0;
        p += 1;
        do {
          if (s0[p]!.text === '(') d += 1;
          if (s0[p]!.text === ')') d -= 1;
          p += 1;
        } while (s0[p] && d > 0);
      }
      if (upper(s0[p]!) === 'AS') {
        const cut = toks.indexOf(s0[p]!) + 1;
        toks = toks.slice(cut);
        while (toks[0]?.kind === 'space') toks.shift();
        res.changed.push(note('view', { name: name.join('') }));
      }
    }
  }
  const first = upper(sig()[0] ?? { kind: 'space', text: '', start: 0 });
  if (first !== 'SELECT' && first !== 'WITH') return res;
  // Проверки доступа: их делает роль базы.
  const drop = new Set<number>();
  for (let k = 0; k < toks.length; k += 1) {
    if (toks[k]!.kind === 'space') continue;
    const end = checkAt(toks, k);
    if (end < 0) continue;
    // Соседние слова: «AND проверка», «WHERE проверка AND», «WHERE проверка» перед концом.
    const before: number[] = [];
    let b = k - 1;
    while (b >= 0 && toks[b]!.kind === 'space') before.push(b--);
    let a = end;
    const after: number[] = [];
    while (a < toks.length && toks[a]!.kind === 'space') after.push(a++);
    const range = (x: number, y: number) => {
      for (let z = x; z < y; z += 1) drop.add(z);
    };
    const prev = b >= 0 ? upper(toks[b]!) : '';
    const nextT = toks[a];
    const next = nextT ? upper(nextT) : '';
    if (prev === 'AND') {
      range(b, end);
      while (b > 0 && toks[b - 1]!.kind === 'space') drop.add(--b);
    } else if (prev === 'WHERE' && next === 'AND') {
      range(k, a + 1);
      let c = a + 1;
      while (c < toks.length && toks[c]!.kind === 'space') drop.add(c++);
    } else if (prev === 'WHERE' && (!nextT || nextT.text === ')' || ENDS.has(next))) {
      range(b, end);
      while (b > 0 && toks[b - 1]!.kind === 'space') drop.add(--b);
    } else continue;
    k = end - 1;
  }
  if (drop.size) {
    toks = toks.filter((_, i) => !drop.has(i));
    res.changed.push(note('checks'));
  }
  // Параметры и служебные функции.
  const used = new Map<string, string>();
  const name = (key: string, raw: string) => {
    const had = used.get(key);
    if (had) return had;
    let n = paramName(raw);
    let i = 2;
    const taken = new Set(used.values());
    while (taken.has(n)) n = `${paramName(raw)}${i++}`;
    used.set(key, n);
    res.params.push(n);
    return n;
  };
  let out = '';
  let line = '';
  const svc: string[] = [];
  const lineSvc: string[] = [];
  const flush = (rest: string) => {
    out += lineSvc.length
      ? `${line} -- ${svcComment.replace('{list}', lineSvc.join(', '))}${rest}`
      : line + rest;
    line = '';
    lineSvc.length = 0;
  };
  const tableSpot = new Set(['FROM', 'JOIN']);
  let lastWord = '';
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.kind === 'param') {
      const isCode = t.text.startsWith('${');
      const raw = isCode ? t.text.slice(2, -1) : 'p' + t.text.slice(1);
      const n = name(t.text, raw);
      if (tableSpot.has(lastWord)) res.replace.push(note('table_param', { name: n }));
      res.changed.push(note('param', { from: t.text, name: n }));
      // Значения консоли — текст: после LIMIT и OFFSET без приведения — число.
      const castNext = toks[k + 1]?.text === '::';
      line +=
        ':' + n + (!castNext && (lastWord === 'LIMIT' || lastWord === 'OFFSET') ? '::integer' : '');
    } else if (
      t.kind === 'word' &&
      t.text.toLowerCase() === 'app' &&
      toks[k + 1]?.text === '.' &&
      toks[k + 2]?.kind === 'word'
    ) {
      const fn = toks[k + 2]!.text;
      if (
        fn.toLowerCase() === 'current_user_id' &&
        toks[k + 3]?.text === '(' &&
        toks[k + 4]?.text === ')'
      ) {
        const n = name('app.current_user_id', 'user_id');
        res.changed.push(note('user', { name: n }));
        line += ':' + n;
        k += 4;
      } else {
        const full = 'app.' + fn;
        if (!svc.includes(full)) svc.push(full);
        if (!lineSvc.includes(full)) lineSvc.push(full);
        line += full;
        k += 2;
      }
    } else if (
      t.kind === 'word' &&
      t.text.toLowerCase() === 'public' &&
      toks[k + 1]?.text === '.'
    ) {
      k += 1;
    } else if (t.kind === 'space' && t.text.includes('\n')) {
      const cut = t.text.lastIndexOf('\n');
      flush(t.text.slice(0, cut + 1));
      line = t.text.slice(cut + 1);
    } else line += t.text;
    if (t.kind === 'word') lastWord = t.text.toUpperCase();
    else if (t.kind !== 'space' && t.kind !== 'comment') lastWord = '';
  }
  flush('');
  if (known) out = castParams(out, known);
  const deniedWord = dmSqlDeniedWord(out);
  if (deniedWord && 'name' in deniedWord && deniedWord.name.toLowerCase().startsWith('app.')) {
    // Служебная функция — уже в «-- замените».
  } else if (deniedWord && 'name' in deniedWord)
    res.replace.push(note('denied', { word: deniedWord.name }));
  else if (deniedWord) res.replace.push(note('lock'));
  if (svc.length) res.replace.push(note('svc', { list: svc.join(', ') }));
  if (dmSqlQuickMarks(out).length) res.replace.push(note('cut'));
  // Таблицы, которых консоли не видно (закрыты роли шаблонов Админки или их нет в базе).
  if (known) {
    const closed = dmSqlTables(out).filter((t) => !known.has(t));
    if (closed.length) res.replace.push(note('closed_tables', { list: closed.join(', ') }));
    const fields = dmSqlClosedFields(out, known);
    if (fields.length) res.replace.push(note('closed_fields', { list: fields.join(', ') }));
  }
  res.money = dmSqlOutputNames(out).filter(dmSqlMoneyName);
  if (res.money.length) res.changed.push(note('money', { list: res.money.join(', ') }));
  res.sql = out;
  return res;
}

/** Таблицы после FROM и JOIN (без схемы `public.`; подзапросы и функции пропускаются, имена CTE — тоже). */
export function dmSqlTables(sql: string): string[] {
  const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const ctes = new Set<string>();
  for (let k = 0; k < sig.length; k += 1) {
    const w = upper(sig[k]!);
    if (
      (w === 'WITH' || w === 'RECURSIVE' || sig[k]!.text === ',') &&
      sig[k + 1]?.kind === 'word'
    ) {
      if (upper(sig[k + 2] ?? sig[k]!) === 'AS') ctes.add(sig[k + 1]!.text.toLowerCase());
    }
  }
  const out: string[] = [];
  for (let k = 0; k < sig.length; k += 1) {
    const w = upper(sig[k]!);
    if (w !== 'FROM' && w !== 'JOIN') continue;
    let p = k + 1;
    if (upper(sig[p] ?? sig[k]!) === 'LATERAL') p += 1;
    const t = sig[p];
    if (!t || t.kind !== 'word') continue;
    let nameT = t.text.toLowerCase();
    if (sig[p + 1]?.text === '.' && sig[p + 2]?.kind === 'word') {
      if (nameT !== 'public') continue;
      nameT = sig[p + 2]!.text.toLowerCase();
      p += 2;
    }
    if (sig[p + 1]?.text === '(') continue;
    if (ctes.has(nameT) || DM_SQL_KEYWORDS.has(nameT)) continue;
    if (!out.includes(nameT)) out.push(nameT);
  }
  return out;
}

const TEXT_TYPES = new Set(['text', 'character varying', 'varchar', 'citext', 'character', 'name']);
const COMPARE = new Set(['=', '<>', '!=', '<', '>', '<=', '>=']);

/**
 * Значения параметров консоли — текст: параметр, который сравнивают с полем другого типа («v.id = :p1»,
 * поле uuid), получает приведение к типу поля из карты базы (`:p1::uuid`).
 */
function castParams(sql: string, known: ReadonlyMap<string, ReadonlyMap<string, string>>): string {
  const aliasAt = dmSqlAliasScopes(sql);
  const toks = dmSqlLex(sql);
  const sigIdx = toks
    .map((t, i) => (t.kind === 'space' || t.kind === 'comment' ? -1 : i))
    .filter((i) => i >= 0);
  const typeOf = (j: number): string | null => {
    // Поле «а.поле» кончается на куске j.
    const p = sigIdx.indexOf(j);
    if (p < 2) return null;
    const [a, dot, f] = [toks[sigIdx[p - 2]!]!, toks[sigIdx[p - 1]!]!, toks[j]!];
    if (a.kind !== 'word' || dot.text !== '.' || f.kind !== 'word') return null;
    const table = aliasAt(p - 2, a.text.toLowerCase());
    return (table && known.get(table)?.get(f.text.toLowerCase())) ?? null;
  };
  const casts = new Map<number, string>();
  for (let p = 0; p < sigIdx.length; p += 1) {
    const t = toks[sigIdx[p]!]!;
    if (t.kind !== 'param' || toks[sigIdx[p + 1] ?? -1]?.text === '::') continue;
    const before = toks[sigIdx[p - 1] ?? -1];
    let type: string | null = null;
    if (before && COMPARE.has(before.text)) type = typeOf(sigIdx[p - 2] ?? -1);
    const after = toks[sigIdx[p + 1] ?? -1];
    if (!type && after && COMPARE.has(after.text)) {
      const e = sigIdx[p + 4];
      if (e !== undefined) type = typeOf(e);
    }
    if (type && !TEXT_TYPES.has(type.toLowerCase())) casts.set(sigIdx[p]!, type);
  }
  return toks.map((t, i) => (casts.has(i) ? `${t.text}::${casts.get(i)}` : t.text)).join('');
}

/**
 * Псевдонимы по уровням запроса (исправление этапа 2: прежде один общий список путал псевдоним, заново
 * объявленный в подзапросе, — «GET /admin/files» давал ложное «поля не видно»; docs/typical-mistakes.md
 * № 86). Уровень — скобки: подзапрос, WITH, LATERAL. Имя ищется на уровне ссылки, потом на внешних — так
 * работает и коррелированный подзапрос. Ответ — функция: номер значимого куска (без пробелов и
 * комментариев) и псевдоним → таблица или `undefined`.
 */
export function dmSqlAliasScopes(sql: string): (at: number, alias: string) => string | undefined {
  const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const parent: number[] = [-1];
  const blockOf: number[] = [];
  const decl = new Map<number, Map<string, string>>();
  const stack = [0];
  for (const t of sig) {
    // Открывающая скобка — ещё внешний уровень, закрывающая — уже внешний.
    if (t.text === ')' && stack.length > 1) stack.pop();
    blockOf.push(stack[stack.length - 1]!);
    if (t.text === '(') {
      parent.push(stack[stack.length - 1]!);
      stack.push(parent.length - 1);
    }
  }
  const put = (b: number, name: string, table: string) => {
    if (!decl.has(b)) decl.set(b, new Map());
    decl.get(b)!.set(name, table);
  };
  for (let k = 0; k < sig.length; k += 1) {
    const w = upper(sig[k]!);
    const b = blockOf[k]!;
    if (w !== 'FROM' && w !== 'JOIN' && !(sig[k]!.text === ',' && decl.has(b))) continue;
    let p = k + 1;
    if (sig[p]?.kind !== 'word') continue;
    let table = sig[p]!.text.toLowerCase();
    if (sig[p + 1]?.text === '.' && sig[p + 2]?.kind === 'word') {
      if (table !== 'public') continue;
      table = sig[p + 2]!.text.toLowerCase();
      p += 2;
    }
    if (sig[p + 1]?.text === '(' || DM_SQL_KEYWORDS.has(table)) continue;
    put(b, table, table);
    let a = p + 1;
    if (upper(sig[a] ?? sig[p]!) === 'AS') a += 1;
    const alias = sig[a];
    if (
      alias &&
      alias.kind === 'word' &&
      !DM_SQL_KEYWORDS.has(alias.text.toLowerCase()) &&
      !CLAUSES.has(upper(alias))
    )
      put(b, alias.text.toLowerCase(), table);
  }
  return (at, alias) => {
    for (let b = blockOf[at] ?? 0; b >= 0; b = parent[b]!) {
      const t = decl.get(b)?.get(alias);
      if (t) return t;
    }
    return undefined;
  };
}

/** Поля «псевдоним.поле» известных таблиц, которых консоли не видно (секретные столбцы). */
export function dmSqlClosedFields(
  sql: string,
  known: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string[] {
  const aliasAt = dmSqlAliasScopes(sql);
  const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  const out: string[] = [];
  for (let k = 0; k + 2 < sig.length; k += 1) {
    if (sig[k]!.kind !== 'word' || sig[k + 1]!.text !== '.' || sig[k + 2]!.kind !== 'word')
      continue;
    if (sig[k + 3]?.text === '(') continue;
    const table = aliasAt(k, sig[k]!.text.toLowerCase());
    const cols = table ? known.get(table) : undefined;
    const col = sig[k + 2]!.text.toLowerCase();
    if (table && cols && !cols.has(col) && !out.includes(`${table}.${col}`))
      out.push(`${table}.${col}`);
  }
  return out;
}

/** Имена столбцов вывода первого SELECT: псевдоним после AS, иначе последнее имя выражения. */
export function dmSqlOutputNames(sql: string): string[] {
  const sig = dmSqlLex(sql).filter((t) => t.kind !== 'space' && t.kind !== 'comment');
  let k = 0;
  let depth = 0;
  // Первый SELECT на глубине 0 после WITH … (…).
  for (; k < sig.length; k += 1) {
    const t = sig[k]!;
    if (t.text === '(') depth += 1;
    if (t.text === ')') depth -= 1;
    if (depth === 0 && upper(t) === 'SELECT') break;
  }
  const names: string[] = [];
  let last = '';
  let alias = '';
  depth = 0;
  for (k += 1; k < sig.length; k += 1) {
    const t = sig[k]!;
    if (t.text === '(') depth += 1;
    else if (t.text === ')') depth -= 1;
    if (depth < 0) break;
    if (depth === 0 && (t.text === ',' || upper(t) === 'FROM')) {
      names.push(alias || last);
      alias = '';
      last = '';
      if (upper(t) === 'FROM') break;
      continue;
    }
    if (depth !== 0) continue;
    if (
      upper(t) === 'AS' &&
      sig[k + 1] &&
      (sig[k + 1]!.kind === 'word' || sig[k + 1]!.kind === 'quoted')
    ) {
      alias = sig[k + 1]!.text.replace(/^"|"$/g, '');
      k += 1;
    } else if (t.kind === 'word' && !DM_SQL_KEYWORDS.has(t.text.toLowerCase())) last = t.text;
  }
  return names.filter(Boolean).map((x) => x.toLowerCase());
}

/** Запрос метода: SQL-вставка или представление — текст с SELECT, WITH или CREATE VIEW. */
export interface DmMethodSqlSource {
  k: string;
  t: string;
}

/**
 * Точный SQL метода API (блок 5, пункт 1; прототип `dmcMethodSql`): только у GET, первый запрос метода,
 * который начинается с SELECT, WITH или CREATE VIEW. Нет — `null`: метод показывается для справки.
 */
export function dmMethodSql(
  method: { m: string; q?: readonly number[] },
  sql: readonly (DmMethodSqlSource | undefined)[],
): string | null {
  if (method.m !== 'GET') return null;
  for (const i of method.q ?? []) {
    const q = sql[i];
    if (!q || (q.k !== 'sql' && q.k !== 'view')) continue;
    const head = dmSqlLex(q.t).find((t) => t.kind !== 'space' && t.kind !== 'comment');
    const w = head ? upper(head) : '';
    if (w === 'SELECT' || w === 'WITH' || w === 'CREATE') {
      if (w !== 'CREATE' || dmMethodToSelect(q.t).changed.some((x) => x.code === 'view'))
        return q.t;
    }
  }
  return null;
}

/**
 * Таблицы метода (для «Собрать запрос по таблицам метода», этап 2, П9; правило стыков — кнопка ещё
 * не показывается): из всех его запросов — таблицы после FROM и JOIN, по порядку, без повторов.
 */
export function dmMethodTables(
  method: { q?: readonly number[] },
  sql: readonly (DmMethodSqlSource | undefined)[],
): string[] {
  const out: string[] = [];
  for (const i of method.q ?? []) {
    const q = sql[i];
    if (!q) continue;
    for (const t of dmSqlTables(q.t)) if (!out.includes(t)) out.push(t);
  }
  return out;
}
