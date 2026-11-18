import type { ListQuery, ListSort, RunAttempt, RunStatus } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from './client';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
} from './list';

/*
 * Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js; docs/decisions.md
 * п. Т-15): задачи по расписанию и журнал их запусков. Задачи — не таблица базы, а список из кода
 * (`packages/api/src/jobs`): строки с уже посчитанным состоянием идут в общий механизм списков одним
 * параметром (`jsonb_to_recordset`), как методы API в «Технической документации». Запуски — таблица
 * `scheduler_runs`: строка хранит последнюю попытку, прежние — в `prev`; в журнале каждая попытка —
 * своя строка. Таблицы расписания служебные (без организации): метод API пускает только
 * администратора платформы.
 */

/** Столбец источника: ключи — постоянные имена, не ввод пользователя. */
const field = (key: string) => sql.raw(`"r"."${key}"`);

// ───── Задачи ─────

/** Строка списка задач: значения и подписи, как на экране. */
export interface JobListRow {
  name: string;
  title: string;
  /** «Как часто» словами и минут между запусками (для сортировки). */
  every: string;
  everyMin: number;
  what: string;
  /** Последний запуск: начало (ISO) и итог; null — запусков нет. */
  lastAt: string | null;
  lastStatus: RunStatus | null;
  lastStatusText: string;
  okAt: string | null;
  fails: number;
  state: string;
  stateText: string;
  /** Порядок состояния: «Падает», «Не запускалась», «Работает». */
  stateRank: number;
}

const JOB_DEFS = [
  'name text',
  'title text',
  'every text',
  'every_min integer',
  'what text',
  'last_at timestamptz',
  'last_status text',
  'last_status_text text',
  'ok_at timestamptz',
  'fails integer',
  'state text',
  'state_text text',
  'state_rank integer',
].join(', ');

function jobRecordset(rows: readonly JobListRow[]): SQL {
  const json = rows.map((r) => ({
    name: r.name,
    title: r.title,
    every: r.every,
    every_min: r.everyMin,
    what: r.what,
    last_at: r.lastAt,
    last_status: r.lastStatus,
    last_status_text: r.lastStatusText,
    ok_at: r.okAt,
    fails: r.fails,
    state: r.state,
    state_text: r.stateText,
    state_rank: r.stateRank,
  }));
  return sql`jsonb_to_recordset(${JSON.stringify(json)}::jsonb) as r(${sql.raw(JOB_DEFS)})`;
}

/** Столбцы списка задач (прототип grid `run-jobs`): ключи — как у столбцов экрана. */
export const JOB_COLUMNS: ListColumns = {
  title: { type: 'text', label: 'runs.col.title', value: field('title') },
  every: {
    type: 'enum',
    label: 'runs.col.every',
    value: field('every'),
    sort: { value: field('every_min'), text: false },
  },
  last: {
    type: 'datetime',
    label: 'runs.col.last',
    value: field('last_at'),
    searchDisplay: sql`concat_ws(' ', to_char(${field('last_at')} at time zone 'Asia/Bishkek', 'DD.MM.YYYY HH24:MI'), ${field('last_status_text')})`,
  },
  ok: { type: 'datetime', label: 'runs.col.ok', value: field('ok_at') },
  fails: { type: 'int', label: 'runs.col.fails', value: field('fails') },
  st: {
    type: 'enum',
    label: 'runs.col.state',
    value: field('state'),
    display: field('state_text'),
    // Только порядок состояний: значения столбца для фильтра группируются и по выражению сортировки,
    // с названием задачи в нём каждая задача стала бы своим значением.
    sort: { value: field('state_rank'), text: false },
  },
  what: { type: 'text', label: 'runs.col.what', value: field('what') },
  name: { type: 'text', label: 'runs.col.name', value: field('name') },
};

/** Сначала «Падает» и «Не запускалась» (прототип `sort: {key: 'st', dir: 1}`). */
const JOB_SORT: ListSort = { key: 'st', dir: 'asc' };
const JOB_NATURAL = [field('title'), field('name')];

const fromOf =
  (tx: Tx, source: SQL): ListFrom =>
  (fields) =>
    tx.select(fields).from(source).$dynamic();

export interface JobPageRow {
  name: string;
  title: string;
  every: string;
  what: string;
  lastAt: Date | null;
  lastStatus: RunStatus | null;
  okAt: Date | null;
  fails: number;
  state: string;
}

/** Страница списка задач по расписанию. */
export function listJobsPage(tx: Tx, rows: readonly JobListRow[], query: ListQuery) {
  const source = jobRecordset(rows);
  return selectListPage({
    query,
    columns: JOB_COLUMNS,
    natural: JOB_NATURAL,
    defaultSort: JOB_SORT,
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({
          name: sql<string>`${field('name')}`,
          title: sql<string>`${field('title')}`,
          every: sql<string>`${field('every')}`,
          what: sql<string>`${field('what')}`,
          lastAt: sql<Date | null>`${field('last_at')}`.mapWith((v) => asDate(v)),
          lastStatus: sql<RunStatus | null>`${field('last_status')}`,
          okAt: sql<Date | null>`${field('ok_at')}`.mapWith((v) => asDate(v)),
          fails: sql<number>`${field('fails')}`,
          state: sql<string>`${field('state')}`,
          ...window,
        })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
}

export function listJobValues(tx: Tx, rows: readonly JobListRow[], key: string, q?: string) {
  return selectListValues({
    columns: JOB_COLUMNS,
    key,
    scope: undefined,
    from: fromOf(tx, jobRecordset(rows)),
    q,
  });
}

export function exportJobs(
  tx: Tx,
  rows: readonly JobListRow[],
  query: ListQuery,
  keys: readonly string[],
) {
  return selectListExport({
    query,
    columns: JOB_COLUMNS,
    keys,
    natural: JOB_NATURAL,
    defaultSort: JOB_SORT,
    scope: undefined,
    from: fromOf(tx, jobRecordset(rows)),
  });
}

const asDate = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));

/** Последний запуск и последний успех каждой задачи и её ошибки с момента `since` (по всем попыткам). */
export async function jobRunFacts(
  db: Db | Tx,
  names: readonly string[],
  since: Date,
): Promise<
  Map<
    string,
    { lastAt: Date | null; lastStatus: RunStatus | null; okAt: Date | null; errors: number }
  >
> {
  const out = new Map<
    string,
    { lastAt: Date | null; lastStatus: RunStatus | null; okAt: Date | null; errors: number }
  >();
  if (!names.length) return out;
  const rows = await db.execute<{
    name: string;
    last_at: string | Date | null;
    last_status: RunStatus | null;
    ok_at: string | Date | null;
    errors: number;
  }>(sql`
    select j.name,
      l.started_at as last_at,
      l.status as last_status,
      k.started_at as ok_at,
      coalesce(e.n, 0)::integer as errors
    from unnest(array[${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )}]::text[]) as j(name)
    left join lateral (
      select r.started_at,
        case when r.finished_at is null then 'running' when r.ok then 'ok' else 'error' end as status
      from scheduler_runs r where r.job = j.name order by r.slot desc limit 1
    ) l on true
    left join lateral (
      select r.started_at from scheduler_runs r
      where r.job = j.name and r.ok order by r.slot desc limit 1
    ) k on true
    left join lateral (
      select count(*) filter (where r.ok = false and r.started_at >= ${since.toISOString()}::timestamptz)
        + coalesce(sum((
            select count(*) from jsonb_array_elements(r.prev) p
            where (p ->> 'startedAt')::timestamptz >= ${since.toISOString()}::timestamptz
          )), 0) as n
      from scheduler_runs r
      where r.job = j.name and r.slot >= ${since.toISOString()}::timestamptz - interval '1 day'
    ) e on true`);
  for (const r of rows) {
    out.set(r.name, {
      lastAt: asDate(r.last_at),
      lastStatus: r.last_status,
      okAt: asDate(r.ok_at),
      errors: Number(r.errors),
    });
  }
  return out;
}

// ───── Запуски ─────

/** Названия задач и шаблон «Что сделано» с {n} — для подписей в журнале запусков. */
export interface RunJobText {
  name: string;
  title: string;
  /** «Отправлено сообщений: {n}»; у задачи без своего текста — общий «Сделано: {n}». */
  done: string;
}

/** Подписи журнала запусков — тексты словаря с подстановками в фигурных скобках. */
export interface RunTexts {
  status: Readonly<Record<RunStatus, string>>;
  /** «{n} из {max}» с уже подставленным пределом. */
  attempt: string;
  nothing: string;
  /** «{s} с» и «{m} мин {s} с». */
  seconds: string;
  minutes: string;
}

/** Журнал запусков: каждая попытка — строка (последняя — из столбцов, прежние — из `prev`). */
function runSource(jobs: readonly RunJobText[], t: RunTexts): SQL {
  const titles = JSON.stringify(jobs.map((j) => ({ name: j.name, title: j.title, done: j.done })));
  // «Длительность» и «Что сделано» словами — столбцы источника: в значении столбца списка параметров
  // запроса быть не должно (по нему группируют), а тексты словаря — параметры.
  return sql`(
    select b.*, ${durationText(t)} as dur_text, ${doneText(t)} as done_text,
      case when b.ms < 60000 then round(b.ms / 100.0) * 100 else round(b.ms / 1000.0) * 1000 end as dur_sort
    from (
    select a.job, a.slot, a.attempt, a.started_at, a.finished_at, a.status, a.error, a.done,
      coalesce(j.title, a.job) as title, j.done as done_tpl,
      (extract(epoch from a.finished_at - a.started_at) * 1000)::bigint as ms
    from (
      select r.job, r.slot, r.attempts as attempt, r.started_at, r.finished_at,
        case when r.finished_at is null then 'running' when r.ok then 'ok' else 'error' end as status,
        r.error, r.done
      from scheduler_runs r
      union all
      select r.job, r.slot, (p ->> 'attempt')::integer, (p ->> 'startedAt')::timestamptz,
        (p ->> 'finishedAt')::timestamptz, 'error', p ->> 'error', null::integer
      from scheduler_runs r cross join lateral jsonb_array_elements(r.prev) p
    ) a
    left join jsonb_to_recordset(${titles}::jsonb) as j(name text, title text, done text)
      on j.name = a.job
    ) b
  ) as r`;
}

const STATUSES: readonly RunStatus[] = ['ok', 'error', 'running'];

function durationText(t: RunTexts): SQL {
  const ms = sql.raw('b.ms');
  const secs = sql`replace(regexp_replace(round(${ms} / 1000.0, 1)::text, '\\.0$', ''), '.', ',')`;
  const whole = sql`round(${ms} / 1000.0)::bigint`;
  return sql`case
    when ${ms} is null then ''
    when ${ms} < 60000 then replace(${t.seconds}, '{s}', ${secs})
    else replace(replace(${t.minutes}, '{m}', (${whole} / 60)::text), '{s}', (${whole} % 60)::text)
  end`;
}

function doneText(t: RunTexts): SQL {
  return sql`case
    when b.done is null then ''
    when b.done = 0 then ${t.nothing}
    else replace(coalesce(b.done_tpl, '{n}'), '{n}', b.done::text)
  end`;
}

/** Столбцы журнала запусков (прототип grid `run-list`). */
export function runColumns(t: RunTexts): ListColumns {
  return {
    start: { type: 'datetime', label: 'runs.col.start', value: field('started_at') },
    title: {
      type: 'enum',
      label: 'runs.col.title',
      value: field('job'),
      display: field('title'),
      sort: { value: field('title'), text: true },
    },
    st: {
      type: 'enum',
      label: 'runs.col.st',
      value: field('status'),
      display: sql`case ${sql.join(
        STATUSES.map((s) => sql`when ${field('status')} = ${s} then ${t.status[s]}`),
        sql` `,
      )} else ${field('status')} end`,
    },
    // Текстом, как в прототипе («0,4 с», «1 мин 30 с»); порядок — по времени.
    dur: {
      type: 'text',
      label: 'runs.col.dur',
      value: field('dur_text'),
      sort: { value: field('dur_sort'), text: false },
    },
    tr: {
      type: 'enum',
      label: 'runs.col.tr',
      value: sql`${field('attempt')}::text`,
      display: sql`replace(${t.attempt}, '{n}', ${field('attempt')}::text)`,
      sort: { value: field('attempt'), text: false },
    },
    // «Отправлено сообщений: 3», «Нечего делать» — текстом; порядок — по числу.
    done: {
      type: 'text',
      label: 'runs.col.done',
      value: field('done_text'),
      sort: { value: field('done'), text: false },
    },
    err: { type: 'text', label: 'runs.col.err', value: sql`coalesce(${field('error')}, '')` },
    slot: { type: 'datetime', label: 'runs.col.slot', value: field('slot') },
    end: { type: 'datetime', label: 'runs.col.end', value: field('finished_at') },
  };
}

/** Сначала новые (прототип `sort: {key: 'start', dir: -1}`). */
const RUN_SORT: ListSort = { key: 'start', dir: 'desc' };
const RUN_NATURAL = [field('started_at'), field('job'), field('attempt')];

/** Что показывать: с какого момента и только «Важные» (ошибки и запуски, которые что-то сделали). */
export interface RunScope {
  from: Date;
  important: boolean;
}

function runScope(scope: RunScope): SQL {
  const since = sql`${field('started_at')} >= ${scope.from.toISOString()}::timestamptz`;
  return scope.important
    ? sql`${since} and (${field('status')} <> 'ok' or coalesce(${field('done')}, 0) > 0)`
    : since;
}

export interface RunRecord {
  job: string;
  slot: Date;
  attempt: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: RunStatus;
  error: string | null;
  done: number | null;
}

const runFields = {
  job: sql<string>`${field('job')}`,
  slot: sql<Date>`${field('slot')}`.mapWith((v) => asDate(v)!),
  attempt: sql<number>`${field('attempt')}`,
  startedAt: sql<Date>`${field('started_at')}`.mapWith((v) => asDate(v)!),
  finishedAt: sql<Date | null>`${field('finished_at')}`.mapWith((v) => asDate(v)),
  status: sql<RunStatus>`${field('status')}`,
  error: sql<string | null>`${field('error')}`,
  done: sql<number | null>`${field('done')}`,
};

/** Страница журнала запусков. */
export function listRunsPage(
  tx: Tx,
  o: { query: ListQuery; jobs: readonly RunJobText[]; texts: RunTexts; scope: RunScope },
) {
  const source = runSource(o.jobs, o.texts);
  return selectListPage({
    query: o.query,
    columns: runColumns(o.texts),
    natural: RUN_NATURAL,
    defaultSort: RUN_SORT,
    scope: runScope(o.scope),
    select: ({ window, where, orderBy, limit, offset }) =>
      tx
        .select({ ...runFields, ...window })
        .from(source)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: fromOf(tx, source),
  });
}

export function listRunValues(
  tx: Tx,
  o: { key: string; q?: string; jobs: readonly RunJobText[]; texts: RunTexts; scope: RunScope },
) {
  return selectListValues({
    columns: runColumns(o.texts),
    key: o.key,
    scope: runScope(o.scope),
    from: fromOf(tx, runSource(o.jobs, o.texts)),
    q: o.q,
  });
}

export function exportRuns(
  tx: Tx,
  o: {
    query: ListQuery;
    keys: readonly string[];
    jobs: readonly RunJobText[];
    texts: RunTexts;
    scope: RunScope;
  },
) {
  return selectListExport({
    query: o.query,
    columns: runColumns(o.texts),
    keys: o.keys,
    natural: RUN_NATURAL,
    defaultSort: RUN_SORT,
    scope: runScope(o.scope),
    from: fromOf(tx, runSource(o.jobs, o.texts)),
  });
}

/** Запуск целиком: последняя попытка и прежние — для окна «Запуск». null — такого запуска нет. */
export async function runWithAttempts(
  db: Db | Tx,
  job: string,
  slot: Date,
): Promise<{ last: RunRecord; prev: RunAttempt[] } | null> {
  const rows = await db.execute<{
    job: string;
    slot: string | Date;
    attempts: number;
    started_at: string | Date;
    finished_at: string | Date | null;
    ok: boolean | null;
    error: string | null;
    done: number | null;
    prev: unknown;
  }>(
    sql`select job, slot, attempts, started_at, finished_at, ok, error, done, prev
      from scheduler_runs where job = ${job} and slot = ${slot.toISOString()}::timestamptz`,
  );
  const r = rows[0];
  if (!r) return null;
  const raw: unknown = typeof r.prev === 'string' ? JSON.parse(r.prev) : r.prev;
  const prev: RunAttempt[] = (Array.isArray(raw) ? raw : []).flatMap((p) => {
    const x = p as Partial<RunAttempt> | null;
    return x && typeof x.attempt === 'number' && typeof x.startedAt === 'string'
      ? [
          {
            attempt: x.attempt,
            startedAt: new Date(x.startedAt).toISOString(),
            finishedAt: x.finishedAt ? new Date(x.finishedAt).toISOString() : null,
            error: typeof x.error === 'string' ? x.error : null,
          },
        ]
      : [];
  });
  return {
    last: {
      job: r.job,
      slot: asDate(r.slot)!,
      attempt: r.attempts,
      startedAt: asDate(r.started_at)!,
      finishedAt: asDate(r.finished_at),
      status: r.finished_at === null ? 'running' : r.ok ? 'ok' : 'error',
      error: r.error,
      done: r.done,
    },
    prev,
  };
}
