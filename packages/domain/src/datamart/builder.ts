import type { DmModule } from './access';
import { dmSqlLex, dmSqlOutputNames, DM_SQL_KEYWORDS, type DmSqlToken } from './console';

/*
 * Консоль запросов «Витрины данных», этап 2 (доработки 27.11.2026: консоль запросов, блок 6 и блок 2,
 * пункт 8; П9 и П7; прототип v167 `modules/vitrina-builder.js`): «Собрать запрос» — путь связей по
 * внешним ключам базы, промежуточные таблицы, выбор пути, поля, «Все строки первой таблицы, даже без
 * пары» / «Только строки с парой», удалённые и заменённые записи исключены, предупреждение о задвоении
 * сумм и «Считать итоги отдельно» (подзапросы WITH); автостолбец `contractor_id` при «Сохранить в
 * шаблон». Карта базы — та же, что у подсказок консоли (поля и связи из самой базы).
 */

/** Поле таблицы для сборщика: имя, тип базы и внешний ключ (одно поле). */
export interface DmBuildField {
  name: string;
  type: string;
  ref: { table: string; field: string } | null;
}

export interface DmBuildTable {
  name: string;
  fields: readonly DmBuildField[];
}

export type DmBuildSchema = ReadonlyMap<string, DmBuildTable>;

/** Сколько таблиц можно отметить (блок 6, пункт 1) и длина пути связей в шагах. */
export const DM_BUILD_MAX = 5;
export const DM_BUILD_DEPTH = 3;
/** Сколько путей наименьшей длины предлагать на выбор. */
export const DM_BUILD_PATHS_MAX = 8;

/**
 * Связь двух таблиц: `a.ac = b.bc`. `many` — внешний ключ таблицы `a` (у неё много строк на одну
 * строку `b`).
 */
export interface DmBuildEdge {
  a: string;
  b: string;
  ac: string;
  bc: string;
  many: boolean;
}

/**
 * Поля «кто создал / изменил» (…_by) и `org_id` в путь не идут: иначе любые две таблицы соединялись бы
 * через учётные записи или организацию (прототип `dmcLinkOk`).
 */
const linkOk = (col: string) => col !== 'org_id' && !/_by$/.test(col);

const edgeCache = new WeakMap<DmBuildSchema, Map<string, DmBuildEdge[]>>();

/** Связи таблицы: сначала её внешние ключи, потом ключи соседей на неё (прототип `dmcEdges`). */
export function dmBuildEdges(schema: DmBuildSchema, name: string): DmBuildEdge[] {
  let all = edgeCache.get(schema);
  if (!all) {
    all = new Map();
    const inc = new Map<string, DmBuildEdge[]>();
    for (const t of schema.values()) {
      for (const f of t.fields) {
        if (!f.ref || !linkOk(f.name) || f.ref.table === t.name || !schema.has(f.ref.table))
          continue;
        const list = inc.get(f.ref.table) ?? [];
        list.push({ a: f.ref.table, b: t.name, ac: f.ref.field, bc: f.name, many: false });
        inc.set(f.ref.table, list);
      }
    }
    for (const t of schema.values()) {
      const out = t.fields
        .filter((f) => f.ref && linkOk(f.name) && f.ref.table !== t.name && schema.has(f.ref.table))
        .map((f) => ({ a: t.name, b: f.ref!.table, ac: f.name, bc: f.ref!.field, many: true }));
      all.set(t.name, [...out, ...(inc.get(t.name) ?? [])]);
    }
    edgeCache.set(schema, all);
  }
  return all.get(name) ?? [];
}

/**
 * Кратчайшие пути от таблицы `from` до любой из уже взятых: все пути наименьшей длины, не длиннее
 * `DM_BUILD_DEPTH` шагов, без повторов, не больше `DM_BUILD_PATHS_MAX` (прототип `dmcPaths`).
 */
export function dmBuildPaths(
  schema: DmBuildSchema,
  from: string,
  taken: ReadonlySet<string>,
): DmBuildEdge[][] {
  let front: [string, DmBuildEdge[]][] = [[from, []]];
  const seen = new Set([from]);
  const found: DmBuildEdge[][] = [];
  for (let dep = 0; dep < DM_BUILD_DEPTH && !found.length && front.length; dep += 1) {
    const next: [string, DmBuildEdge[]][] = [];
    const level = new Set<string>();
    for (const [n, path] of front) {
      for (const e of dmBuildEdges(schema, n)) {
        if (seen.has(e.b)) continue;
        const np = [...path, e];
        if (taken.has(e.b)) found.push(np);
        else {
          next.push([e.b, np]);
          level.add(e.b);
        }
      }
    }
    for (const v of level) seen.add(v);
    front = next.slice(0, 4000);
  }
  const key = (p: DmBuildEdge[]) => p.map((e) => `${e.a}.${e.ac}=${e.b}.${e.bc}`).join(' ');
  return [...new Map(found.map((p) => [key(p), p])).values()].slice(0, DM_BUILD_PATHS_MAX);
}

/** Путь словами для выбора: «reports.contractor_id = contractors.id → …». */
export const dmBuildPathText = (p: readonly DmBuildEdge[]) =>
  p.map((e) => `${e.a}.${e.ac} = ${e.b}.${e.bc}`).join(' → ');

/** Слова, которые не годятся псевдонимом (прототип `DMC_NO_ALIAS`). */
const NO_ALIAS = new Set([
  'as',
  'at',
  'by',
  'do',
  'if',
  'in',
  'is',
  'no',
  'of',
  'on',
  'or',
  'to',
  'all',
  'and',
  'any',
  'asc',
  'end',
  'for',
  'not',
  'off',
  'set',
  'use',
]);

/** Псевдоним — первые буквы слов имени (reports → r, report_types → rt); занятый — с цифрой. */
export function dmBuildAlias(name: string, used: Set<string>): string {
  const base =
    name
      .split('_')
      .map((w) => w[0] ?? '')
      .join('') || 't';
  let a = NO_ALIAS.has(base) || DM_SQL_KEYWORDS.has(base) ? `${base}1` : base;
  for (let i = 2; used.has(a); i += 1) a = `${base}${i}`;
  used.add(a);
  return a;
}

/** Заранее отмечены названия и даты, а не номера записей (блок 6, пункт 2; прототип `dmcPreCols`). */
export function dmBuildPreFields(t: DmBuildTable): string[] {
  const names = t.fields.filter((c) => /(^|_)(name|title)$/.test(c.name) || c.name === 'inn');
  const dates = t.fields.filter((c) => c.type === 'date' && !/_base$/.test(c.name));
  const list = [...names.slice(0, 3), ...dates.slice(0, 2)].map((c) => c.name);
  if (list.length) return list;
  const f = t.fields.find((c) => c.type !== 'uuid' && !/^(id|org_id|version)$/.test(c.name));
  return f ? [f.name] : [];
}

/** Удалённые, заменённые и отменённые записи (блок 6, пункт 3; прототип `dmcAlive`). */
export function dmBuildAlive(t: DmBuildTable, alias: string): string[] {
  const has = new Set(t.fields.map((x) => x.name));
  const out: string[] = [];
  if (has.has('deleted_at')) out.push(`${alias}.deleted_at IS NULL`);
  if (has.has('superseded')) out.push(`NOT ${alias}.superseded`);
  if (has.has('cancelled_at')) out.push(`${alias}.cancelled_at IS NULL`);
  return out;
}

/** Число, которое можно сложить (деньги в базе — тоже целые тыйыны). */
const numeric = (f: DmBuildField) => /^(bigint|integer|smallint|numeric)\b/.test(f.type);

/** Что выбрал администратор в окне сборщика. */
export interface DmBuildState {
  /** Отмеченные таблицы по порядку: первая — от неё идёт запрос. */
  names: string[];
  /** Номер выбранного пути у таблицы с несколькими путями. */
  choice: Record<string, number>;
  /** «Все строки первой таблицы, даже без пары» — `left`, «Только строки с парой» — `inner`. */
  kind: 'left' | 'inner';
  /** «Считать итоги отдельно». */
  sep: boolean;
  /** Отмеченные поля по таблицам. */
  fields: Record<string, string[]>;
}

/** Таблица в запросе: псевдоним, к какой таблице и каким полем присоединена, промежуточная ли. */
export interface DmBuildJoin {
  t: string;
  table: DmBuildTable;
  alias: string;
  parent: string | null;
  parentAlias: string | null;
  col: string | null;
  pcol: string | null;
  many: boolean;
  /** Промежуточная: её не отмечали, система добавила, чтобы соединить таблицы. */
  via: boolean;
}

/** Шаг плана по отмеченной таблице: пути на выбор и выбранный, или «связи не нашлось». */
export type DmBuildStep =
  { t: string; none: false; paths: DmBuildEdge[][]; pick: number } | { t: string; none: true };

export interface DmBuildPlan {
  joins: DmBuildJoin[];
  steps: DmBuildStep[];
  /** Таблицы «много строк на одного». */
  many: DmBuildJoin[];
  /** Суммы задвоятся: таких таблиц две и больше. */
  dbl: boolean;
  /** «Считать итоги отдельно» поможет: хотя бы одна из них — лист с родителем. */
  sepOk: boolean;
}

/** План сборки: порядок соединений, промежуточные таблицы, выбор пути, задвоение (прототип `dmcBuildPlan`). */
export function dmBuildPlan(schema: DmBuildSchema, st: DmBuildState): DmBuildPlan {
  const names = st.names.filter((n) => schema.has(n));
  if (!names.length) return { joins: [], steps: [], many: [], dbl: false, sepOk: false };
  type Raw = Omit<DmBuildJoin, 'alias' | 'parentAlias' | 'table'>;
  const raw: Raw[] = [
    { t: names[0]!, parent: null, col: null, pcol: null, many: false, via: false },
  ];
  const have = new Set([names[0]!]);
  const steps: DmBuildStep[] = [];
  for (const x of names.slice(1)) {
    if (have.has(x)) {
      steps.push({ t: x, none: false, paths: [], pick: 0 });
      continue;
    }
    const paths = dmBuildPaths(schema, x, have);
    if (!paths.length) {
      steps.push({ t: x, none: true });
      continue;
    }
    const k = Math.max(0, Math.min(Math.trunc(st.choice[x] ?? 0), paths.length - 1));
    const p = paths[k]!;
    for (let i = p.length - 1; i >= 0; i -= 1) {
      const e = p[i]!;
      if (have.has(e.a)) continue;
      raw.push({
        t: e.a,
        parent: e.b,
        col: e.ac,
        pcol: e.bc,
        many: e.many,
        via: !names.includes(e.a),
      });
      have.add(e.a);
    }
    steps.push({ t: x, none: false, paths, pick: k });
  }
  const used = new Set<string>();
  const withAlias = raw.map((j) => ({
    ...j,
    table: schema.get(j.t)!,
    alias: dmBuildAlias(j.t, used),
  }));
  const joins: DmBuildJoin[] = withAlias.map((j) => ({
    ...j,
    parentAlias: j.parent ? (withAlias.find((x) => x.t === j.parent)?.alias ?? null) : null,
  }));
  const many = joins.filter((j) => j.many);
  const leaf = (j: DmBuildJoin) => !joins.some((x) => x.parent === j.t);
  return {
    joins,
    steps,
    many,
    dbl: many.length >= 2,
    sepOk: many.some((j) => leaf(j) && j.parent),
  };
}

/** Готовый SELECT (прототип `dmcBuildSql`); нет ни одной таблицы — пусто. */
export function dmBuildSql(schema: DmBuildSchema, st: DmBuildState, plan?: DmBuildPlan): string {
  const P = plan ?? dmBuildPlan(schema, st);
  if (!P.joins.length) return '';
  const join = st.kind === 'inner' ? 'JOIN' : 'LEFT JOIN';
  const sep =
    st.sep && P.dbl
      ? new Set(
          P.many.filter((j) => !P.joins.some((x) => x.parent === j.t) && j.parent).map((j) => j.t),
        )
      : new Set<string>();
  const picked = (j: DmBuildJoin) =>
    (st.fields[j.t] ?? []).filter((c) => j.table.fields.some((x) => x.name === c));
  const cnt = new Map<string, number>();
  for (const j of P.joins) {
    if (sep.has(j.t)) continue;
    for (const c of picked(j)) cnt.set(c, (cnt.get(c) ?? 0) + 1);
  }
  const sel: string[] = [];
  const withs: string[] = [];
  const from: string[] = [];
  P.joins.forEach((j, i) => {
    if (sep.has(j.t)) {
      const s = `${j.alias}_sum`;
      const nums = picked(j).filter((c) => numeric(j.table.fields.find((x) => x.name === c)!));
      const alive = dmBuildAlive(j.table, j.alias);
      withs.push(
        `${s} AS (\n  SELECT ${j.alias}.${j.col}, count(*) AS ${j.t}_n${nums
          .map((c) => `, sum(${j.alias}.${c}) AS ${j.t}_${c}`)
          .join('')}\n  FROM ${j.t} ${j.alias}${
          alive.length ? `\n  WHERE ${alive.join(' AND ')}` : ''
        }\n  GROUP BY ${j.alias}.${j.col}\n)`,
      );
      from.push(`LEFT JOIN ${s} ON ${s}.${j.col} = ${j.parentAlias}.${j.pcol}`);
      sel.push(
        `coalesce(${s}.${j.t}_n, 0) AS ${j.t}_n`,
        ...nums.map((c) => `coalesce(${s}.${j.t}_${c}, 0) AS ${j.t}_${c}`),
      );
      return;
    }
    for (const c of picked(j)) {
      sel.push((cnt.get(c) ?? 0) > 1 ? `${j.alias}.${c} AS ${j.t}_${c}` : `${j.alias}.${c}`);
    }
    if (!i) from.push(`FROM ${j.t} ${j.alias}`);
    else {
      const on = [
        `${j.alias}.${j.col} = ${j.parentAlias}.${j.pcol}`,
        ...dmBuildAlive(j.table, j.alias),
      ];
      from.push(`${join} ${j.t} ${j.alias} ON ${on.join(' AND ')}`);
    }
  });
  const base = P.joins[0]!;
  const where = dmBuildAlive(base.table, base.alias);
  return `${withs.length ? `WITH ${withs.join(', ')}\n` : ''}SELECT\n  ${(sel.length ? sel : [`${base.alias}.*`]).join(',\n  ')}\n${from.join('\n')}${where.length ? `\nWHERE ${where.join(' AND ')}` : ''}\nORDER BY 1`;
}

/**
 * Первоначальное состояние окна: таблицы без повторов (без `public.`), только те, что есть в карте,
 * не больше `DM_BUILD_MAX`; `cut` — отмечено больше (у метода, блок 5, пункт 3).
 */
export function dmBuildStart(
  schema: DmBuildSchema,
  names: readonly string[],
): { state: DmBuildState; cut: boolean } {
  const ok = [...new Set(names.map((n) => n.replace(/^public\./, '').toLowerCase()))].filter((n) =>
    schema.has(n),
  );
  return {
    state: { names: ok.slice(0, DM_BUILD_MAX), choice: {}, kind: 'left', sep: false, fields: {} },
    cut: ok.length > DM_BUILD_MAX,
  };
}

/** Поля по умолчанию у таблиц плана, которых ещё нет в выборе: промежуточные — без полей. */
export function dmBuildFill(st: DmBuildState, plan: DmBuildPlan): DmBuildState {
  let fields = st.fields;
  for (const j of plan.joins) {
    if (fields[j.t]) continue;
    fields = { ...fields, [j.t]: j.via ? [] : dmBuildPreFields(j.table) };
  }
  return fields === st.fields ? st : { ...st, fields };
}

/** Модуль шаблона по первой таблице запроса (прототип `DMC_TPL_MOD`); нет в списке — «Контрагенты». */
const TPL_MODULE: Readonly<Record<string, DmModule>> = {
  reports: 'reports',
  money_operations: 'fin',
  projects: 'projects',
  project_payments: 'projects',
  one_off_services: 'projects',
  one_off_service_payments: 'projects',
  indicator_values: 'kpi',
  tasks: 'staff',
  fee_payments: 'cps',
  contractor_tariffs: 'cps',
  contractors: 'cps',
};

const isSig = (t: DmSqlToken) => t.kind !== 'space' && t.kind !== 'comment';
const up = (t: DmSqlToken | undefined) => (t?.kind === 'word' ? t.text.toUpperCase() : '');

/** Таблицы после FROM и JOIN основного запроса (глубина 0, не имена WITH): имя, псевдоним. */
function topRefs(sql: string): { table: string; alias: string }[] {
  const sig = dmSqlLex(sql).filter(isSig);
  const ctes = new Set<string>();
  const out: { table: string; alias: string }[] = [];
  let depth = 0;
  // Имена WITH — до основного SELECT: запятая списка полей «a, b AS c» именем WITH не считается.
  let inWith = false;
  for (let k = 0; k < sig.length; k += 1) {
    const t = sig[k]!;
    if (t.text === '(') depth += 1;
    else if (t.text === ')') depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const w = up(t);
    if (w === 'WITH') inWith = true;
    else if (w === 'SELECT') inWith = false;
    if (
      inWith &&
      (w === 'WITH' || w === 'RECURSIVE' || t.text === ',') &&
      sig[k + 1]?.kind === 'word'
    ) {
      if (up(sig[k + 2]) === 'AS') ctes.add(sig[k + 1]!.text.toLowerCase());
    }
    if (w !== 'FROM' && w !== 'JOIN') continue;
    let p = k + 1;
    if (up(sig[p]) === 'LATERAL') continue;
    const n = sig[p];
    if (!n || n.kind !== 'word') continue;
    let table = n.text.toLowerCase();
    if (sig[p + 1]?.text === '.' && sig[p + 2]?.kind === 'word') {
      if (table !== 'public') continue;
      table = sig[p + 2]!.text.toLowerCase();
      p += 2;
    }
    if (sig[p + 1]?.text === '(' || ctes.has(table) || DM_SQL_KEYWORDS.has(table)) continue;
    let a = p + 1;
    if (up(sig[a]) === 'AS') a += 1;
    const al = sig[a];
    const alias =
      al && al.kind === 'word' && !DM_SQL_KEYWORDS.has(al.text.toLowerCase())
        ? al.text.toLowerCase()
        : table;
    out.push({ table, alias });
  }
  return out;
}

/**
 * «Сохранить в шаблон» (блок 2, пункт 8; П7; прототип `dmcAutoCp`): в основном запросе есть таблица
 * контрагента, а столбца `contractor_id` нет — он добавляется первым в список SELECT основного
 * запроса (`added` — что добавлено). Модуль шаблона — по первой таблице, `fee` — нужно право «Видеть
 * плату за обслуживание». Таблиц карты в основном запросе нет — `null`.
 */
export function dmConsoleAutoCp(
  sql: string,
  schema: DmBuildSchema,
): { sql: string; added: string | null; module: DmModule; fee: boolean } | null {
  const top = topRefs(sql).filter((r) => schema.has(r.table));
  if (!top.length) return null;
  const module = top.map((r) => TPL_MODULE[r.table]).find(Boolean) ?? 'cps';
  const fee = top.some((r) => r.table === 'fee_payments' || r.table === 'contractor_tariffs');
  const same = { sql, added: null, module, fee };
  if (dmSqlOutputNames(sql).includes('contractor_id')) return same;
  const cp =
    top.find((r) => r.table === 'contractors') ??
    top.find((r) => schema.get(r.table)!.fields.some((f) => f.name === 'contractor_id'));
  if (!cp) return same;
  const added = `${cp.alias}.${cp.table === 'contractors' ? 'id' : 'contractor_id'} AS contractor_id`;
  // Место — сразу после SELECT [DISTINCT] основного запроса.
  const toks = dmSqlLex(sql);
  let depth = 0;
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    if (t.text === '(') depth += 1;
    else if (t.text === ')') depth = Math.max(0, depth - 1);
    if (depth !== 0 || up(t) !== 'SELECT') continue;
    let j = k + 1;
    const skip = () => {
      while (toks[j] && !isSig(toks[j]!)) j += 1;
    };
    skip();
    if (up(toks[j]) === 'DISTINCT') {
      j += 1;
      skip();
    }
    const at = toks[j]?.start ?? sql.length;
    return { sql: `${sql.slice(0, at)}${added}, ${sql.slice(at)}`, added, module, fee };
  }
  return same;
}
