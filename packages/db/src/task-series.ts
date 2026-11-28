import {
  formatDateRu,
  pluralForm,
  seriesRuleText,
  seriesUpcoming,
  type HistoryChange,
  type IsoDate,
  type ListQuery,
  type SeriesEndKind,
  type SeriesMonthMode,
  type SeriesPlan,
  type SeriesRule,
  type SeriesState,
  type SeriesStopReason,
  type SeriesUnit,
  type ListSort,
  type TaskStatus,
  type TaskTerm,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, gt, gte, inArray, max, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import {
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import { auditLog, contractors, employees, projects, taskSeries, tasks } from './schema';
import { dateLiteral, dictLiteral } from './sql-text';
import { writeStatusChange } from './status';

/*
 * Повторяющиеся задачи (доработки 28.11.2026: повторяющиеся задачи; прототип v168
 * modules/task-series.js): серии организации из контекста `withOrgContext` (RLS). Серию ставит сотрудник
 * от своего имени, задачи серии — он же (первая) или ночной запуск «Задачи: повторы» без пользователя
 * (следующие; политика `tasks_insert_own`, миграция 0179). Правило без базы — `@buhuchet/domain`
 * (tasks/series.ts). Строки «Повтор настроен / изменён / остановлен / возобновлён», «Задача поставлена
 * по повтору», «Повтор закончился» пишет в историю задачи вызывающий (как прототип `tsLog`); правка
 * самой серии — с историей `task_series` и версией.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Открытая задача — её ещё делают (как `taskOpen` в @buhuchet/domain). */
const OPEN_TASK = sql`${tasks.status} in ('todo', 'in_progress', 'rework')`;

/** Поля задачи, которые повторяет серия (блок 1, пункт 6). */
export interface SeriesTemplate {
  title: string;
  description: string;
  categoryCode: string;
  contractorId: string | null;
  projectId: string | null;
  executorEmployeeId: string;
  term: TaskTerm;
  needFile: boolean;
  confirm: boolean;
}

/** Серия: поля задачи, правило, начало, состояние. */
export interface SeriesRecord extends SeriesTemplate {
  id: string;
  authorEmployeeId: string;
  rule: SeriesRule;
  start: IsoDate;
  state: SeriesState;
  stopReason: SeriesStopReason | null;
  nextDate: IsoDate | null;
  made: number;
  createdAt: Date;
  version: number;
}

const seriesFields = {
  id: taskSeries.id,
  title: taskSeries.title,
  description: taskSeries.description,
  categoryCode: taskSeries.categoryCode,
  contractorId: taskSeries.contractorId,
  projectId: taskSeries.projectId,
  executorEmployeeId: taskSeries.executorEmployeeId,
  authorEmployeeId: taskSeries.authorEmployeeId,
  term: taskSeries.term,
  needFile: taskSeries.needFile,
  confirm: taskSeries.confirm,
  every: taskSeries.every,
  unit: taskSeries.unit,
  weekDays: taskSeries.weekDays,
  monthMode: taskSeries.monthMode,
  startDate: taskSeries.startDate,
  endKind: taskSeries.endKind,
  endDate: taskSeries.endDate,
  endCount: taskSeries.endCount,
  state: taskSeries.state,
  stopReason: taskSeries.stopReason,
  nextDate: taskSeries.nextDate,
  made: taskSeries.made,
  createdAt: taskSeries.createdAt,
  version: taskSeries.version,
};

type SeriesRowData = {
  [K in keyof typeof seriesFields]: (typeof seriesFields)[K]['_']['data'] | null;
};

/** Правило из строки серии. */
function ruleOf(r: {
  every: number | null;
  unit: string | null;
  weekDays: number[] | null;
  monthMode: string | null;
  endKind: string | null;
  endDate: string | null;
  endCount: number | null;
}): SeriesRule {
  const kind = (r.endKind ?? 'never') as SeriesEndKind;
  return {
    every: r.every ?? 1,
    unit: (r.unit ?? 'week') as SeriesUnit,
    ...(r.weekDays ? { weekDays: [...r.weekDays].sort((a, b) => a - b) } : {}),
    ...(r.monthMode ? { monthMode: r.monthMode as SeriesMonthMode } : {}),
    end:
      kind === 'date'
        ? { kind, date: r.endDate }
        : kind === 'count'
          ? { kind, count: r.endCount }
          : { kind: 'never' },
  };
}

function toSeries(r: SeriesRowData): SeriesRecord {
  return {
    id: r.id!,
    title: r.title!,
    description: r.description ?? '',
    categoryCode: r.categoryCode!,
    contractorId: r.contractorId,
    projectId: r.projectId,
    executorEmployeeId: r.executorEmployeeId!,
    authorEmployeeId: r.authorEmployeeId!,
    term: r.term as TaskTerm,
    needFile: Boolean(r.needFile),
    confirm: Boolean(r.confirm),
    rule: ruleOf(r),
    start: r.startDate as IsoDate,
    state: r.state as SeriesState,
    stopReason: (r.stopReason as SeriesStopReason | null) ?? null,
    nextDate: (r.nextDate as IsoDate | null) ?? null,
    made: r.made ?? 0,
    createdAt: r.createdAt as Date,
    version: r.version!,
  };
}

/** Правило, начало и вид срока — для правил домена. */
export function seriesPlanOf(s: Pick<SeriesRecord, 'rule' | 'start' | 'term'>): SeriesPlan {
  return { rule: s.rule, start: s.start, term: s.term };
}

/** Правило серии словами («Каждую неделю: пн, ср · до 27.02.2027»). */
export function seriesTextOf(s: Pick<SeriesRecord, 'rule' | 'start' | 'term'>): string {
  return seriesRuleText(seriesPlanOf(s));
}

/**
 * Столбцы правила в базе: дни недели — только у «недели», «Когда» — только у «месяца» не «На месяц»
 * (без выбора — «N-го числа»), дата и число — только у своего окончания (проверки `task_series_*`).
 */
export function seriesRuleColumns(rule: SeriesRule, term: TaskTerm) {
  const end = rule.end;
  return {
    every: rule.every,
    unit: rule.unit,
    weekDays:
      rule.unit === 'week' ? [...new Set(rule.weekDays ?? [])].sort((a, b) => a - b) : null,
    monthMode:
      rule.unit === 'month' && term !== 'month' ? (rule.monthMode ?? 'date') : null,
    endKind: end.kind,
    endDate: end.kind === 'date' ? (end.date ?? null) : null,
    endCount: end.kind === 'count' ? (end.count ?? null) : null,
  };
}

/** Правило, как его хранит база (для сравнения «было → стало» и ответа API). */
export function storedRule(rule: SeriesRule, term: TaskTerm): SeriesRule {
  return ruleOf(seriesRuleColumns(rule, term));
}

/** Серия организации; null — нет такой. */
export async function getSeries(tx: Tx, id: string): Promise<SeriesRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx.select(seriesFields).from(taskSeries).where(eq(taskSeries.id, id));
  return row ? toSeries(row as SeriesRowData) : null;
}

/** Серия, заблокированная до конца транзакции (решение о действии и повторный запуск). */
export async function lockSeries(tx: Tx, id: string): Promise<SeriesRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select(seriesFields)
    .from(taskSeries)
    .where(eq(taskSeries.id, id))
    .for('update');
  return row ? toSeries(row as SeriesRowData) : null;
}

/**
 * Новая серия: постановщик — сотрудник текущего пользователя (проверяет и база), «Действует». Начало —
 * срок первой задачи (её ставит вызывающий `insertSeriesTask`). Запись истории серии — «создана».
 */
export async function createSeries(
  tx: Tx,
  tpl: SeriesTemplate,
  rule: SeriesRule,
  start: IsoDate,
  authorEmployeeId: string,
): Promise<string> {
  const [row] = await tx
    .insert(taskSeries)
    .values({
      ...tpl,
      ...seriesRuleColumns(rule, tpl.term),
      orgId: sql`app.current_org_id()`,
      authorEmployeeId,
      startDate: start,
      state: 'active',
      made: 0,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: taskSeries.id });
  const id = row!.id;
  await writeHistory(tx, {
    entity: 'task_series',
    entityId: id,
    action: 'create',
    contractorId: tpl.contractorId,
    changes: [{ field: 'title', to: tpl.title }],
  });
  return id;
}

/** Что меняет сотрудник у серии: поля задачи, правило, начало, состояние. */
export type SeriesPatch = Partial<
  Pick<
    typeof taskSeries.$inferInsert,
    | 'title'
    | 'description'
    | 'categoryCode'
    | 'contractorId'
    | 'projectId'
    | 'executorEmployeeId'
    | 'term'
    | 'needFile'
    | 'confirm'
    | 'every'
    | 'unit'
    | 'weekDays'
    | 'monthMode'
    | 'startDate'
    | 'endKind'
    | 'endDate'
    | 'endCount'
    | 'state'
    | 'stopReason'
    | 'nextDate'
  >
>;

/**
 * Правка серии сотрудником: проверка версии (устаревшая — `RecordChangedError`), история «было →
 * стало» серии, версия +1. Только в контексте пользователя: без него база меняет у серии лишь
 * состояние и счёт (`task_series_job_guard`).
 */
export async function updateSeries(
  tx: Tx,
  id: string,
  version: number,
  patch: SeriesPatch,
  contractorId: string | null,
): Promise<void> {
  await updateWithHistory(tx, {
    table: taskSeries,
    entity: 'task_series',
    id,
    version,
    patch,
    contractorId,
  });
}

/**
 * Состояние, причина, следующая дата и счёт поставленных — то, что меняет ночной запуск (и он же
 * после действия сотрудника). Версия +1; автора правки не трогает.
 */
export async function setSeriesFacts(
  tx: Tx,
  id: string,
  facts: Partial<{
    state: SeriesState;
    stopReason: SeriesStopReason | null;
    nextDate: IsoDate | null;
    made: number;
  }>,
): Promise<void> {
  await tx
    .update(taskSeries)
    .set({ ...facts, version: sql`${taskSeries.version} + 1`, updatedAt: sql`now()` })
    .where(eq(taskSeries.id, id));
}

/** Что известно о задачах серии: последняя дата по правилу, сколько поставлено, ближайшая задача. */
export interface SeriesTaskFacts {
  lastDate: IsoDate | null;
  made: number;
  /** Ближайшая задача (прототип `tsCur`): первая со сроком с сегодняшнего дня, иначе последняя. */
  currentTaskId: string | null;
  /** Срок ближайшей задачи с сегодняшнего дня (прототип `tsNear`); нет — null. */
  nearDate: IsoDate | null;
}

export async function seriesTaskFacts(
  tx: Tx,
  seriesId: string,
  today: IsoDate,
): Promise<SeriesTaskFacts> {
  const rows = await tx
    .select({ id: tasks.id, date: tasks.seriesDate, due: tasks.dueDate })
    .from(tasks)
    .where(eq(tasks.seriesId, seriesId))
    .orderBy(asc(tasks.seriesDate), asc(tasks.id));
  const last = rows[rows.length - 1];
  const near = rows.find((r) => (r.due as string) >= today);
  return {
    lastDate: (last?.date as IsoDate | undefined) ?? null,
    made: rows.length,
    currentTaskId: (near ?? last)?.id ?? null,
    nearDate: (near?.due as IsoDate | undefined) ?? null,
  };
}

/** Следующая дата серии после её задач (прототип `tsUpcoming`): то, что хранится в `next_date`. */
export function seriesNext(
  s: SeriesRecord,
  facts: Pick<SeriesTaskFacts, 'lastDate' | 'made'>,
  today: IsoDate,
  state: SeriesState = s.state,
): IsoDate | null {
  return seriesUpcoming(
    { ...seriesPlanOf(s), state, lastDate: facts.lastDate, made: facts.made },
    today,
  );
}

/**
 * Задача серии на дату: поля серии, постановщик — постановщик серии, «К выполнению»; в истории —
 * `history` («создана» у первой, «Задача поставлена по повтору» у следующих), в «Истории статусов» —
 * первая запись. Дата уже есть (повторный или одновременный запуск) — null, ничего не пишется.
 */
export async function insertSeriesTask(
  tx: Tx,
  s: SeriesRecord,
  date: IsoDate,
  history: 'create' | 'series_make',
): Promise<string | null> {
  const [row] = await tx
    .insert(tasks)
    .values({
      orgId: sql`app.current_org_id()`,
      title: s.title,
      description: s.description,
      categoryCode: s.categoryCode,
      contractorId: s.contractorId,
      projectId: s.projectId,
      executorEmployeeId: s.executorEmployeeId,
      authorEmployeeId: s.authorEmployeeId,
      term: s.term,
      dueDate: date,
      needFile: s.needFile,
      confirm: s.confirm,
      status: 'todo',
      seriesId: s.id,
      seriesDate: date,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .onConflictDoNothing({ target: [tasks.orgId, tasks.seriesId, tasks.seriesDate] })
    .returning({ id: tasks.id });
  if (!row) return null;
  await writeHistory(tx, {
    entity: 'task',
    entityId: row.id,
    action: history,
    contractorId: s.contractorId,
    changes: [{ field: 'title', to: s.title }],
  });
  await writeStatusChange(tx, { scale: 'task', entityId: row.id, from: null, to: 'todo' });
  return row.id;
}

/** Задача входит в серию (повтор добавлен существующей задаче или «Эту и следующие»). */
export async function attachTaskToSeries(
  tx: Tx,
  taskId: string,
  seriesId: string,
  date: IsoDate,
): Promise<void> {
  await tx
    .update(tasks)
    .set({ seriesId, seriesDate: date })
    .where(eq(tasks.id, taskId));
}

/**
 * «Эту и следующие» (прототип `tsApplyAll`): открытые задачи серии со сроком позже этой получают поля
 * серии, у каждой — запись истории «было → стало».
 */
export async function updateLaterSeriesTasks(
  tx: Tx,
  seriesId: string,
  after: { id: string; dueDate: IsoDate },
  tpl: SeriesTemplate,
): Promise<number> {
  const later = await tx
    .select({ id: tasks.id, version: tasks.version })
    .from(tasks)
    .where(
      and(
        eq(tasks.seriesId, seriesId),
        ne(tasks.id, after.id),
        gt(tasks.dueDate, after.dueDate),
        OPEN_TASK,
      ),
    );
  for (const t of later) {
    await updateWithHistory(tx, {
      table: tasks,
      entity: 'task',
      id: t.id,
      version: t.version,
      patch: { ...tpl },
      contractorId: tpl.contractorId,
    });
  }
  return later.length;
}

/** «Все задачи серии» (прототип `tsListDlg`): срок, исполнитель, статус — новые сверху. */
export async function seriesTaskList(tx: Tx, seriesId: string) {
  const rows = await tx
    .select({
      id: tasks.id,
      dueDate: tasks.dueDate,
      term: tasks.term,
      executor: employees.shortName,
      status: tasks.status,
    })
    .from(tasks)
    .leftJoin(employees, eq(employees.id, tasks.executorEmployeeId))
    .where(eq(tasks.seriesId, seriesId))
    .orderBy(desc(tasks.dueDate), desc(tasks.createdAt));
  return rows.map((r) => ({
    id: r.id,
    dueDate: r.dueDate as IsoDate,
    term: r.term as TaskTerm,
    executor: r.executor ?? null,
    status: r.status as TaskStatus,
  }));
}

/** Серия для ночного запуска: что останавливает её без человека и что ставит на паузу. */
export interface SeriesRunRow {
  series: SeriesRecord;
  lastDate: IsoDate | null;
  made: number;
  executorActive: boolean;
  /** Обслуживание контрагента: `archived` — в архиве, `paused` — приостановлен; null — общая задача. */
  contractorStatus: string | null;
  /** Статус проекта; null — без проекта. */
  projectStatus: string | null;
}

/** Действующие серии организации из контекста с фактами для `seriesRunStep` (ночной запуск). */
export async function seriesForRun(tx: Tx, ids?: readonly string[]): Promise<SeriesRunRow[]> {
  const last = sql<
    string | null
  >`(select max(t.series_date)::text from ${tasks} t where t.series_id = ${taskSeries.id})`;
  const made = sql<number>`(select count(*)::integer from ${tasks} t where t.series_id = ${taskSeries.id})`;
  const rows = await tx
    .select({
      ...seriesFields,
      lastDate: last,
      madeCount: made,
      executorActive: employees.active,
      contractorStatus: contractors.serviceStatus,
      projectStatus: projects.status,
    })
    .from(taskSeries)
    .innerJoin(employees, eq(employees.id, taskSeries.executorEmployeeId))
    .leftJoin(contractors, eq(contractors.id, taskSeries.contractorId))
    .leftJoin(projects, eq(projects.id, taskSeries.projectId))
    .where(
      and(
        eq(taskSeries.state, 'active'),
        ids ? inArray(taskSeries.id, [...ids]) : undefined,
      ),
    )
    .orderBy(asc(taskSeries.createdAt), asc(taskSeries.id));
  return rows.map((r) => ({
    series: toSeries(r as unknown as SeriesRowData),
    lastDate: (r.lastDate as IsoDate | null) ?? null,
    made: Number(r.madeCount ?? 0),
    executorActive: Boolean(r.executorActive),
    contractorStatus: r.contractorStatus ?? null,
    projectStatus: r.projectStatus ?? null,
  }));
}

/** Сотрудник действует (для «Возобновить»: с заблокированным исполнителем нельзя). */
export async function seriesStopFacts(tx: Tx, s: SeriesRecord) {
  const [row] = await tx
    .select({
      executorActive: employees.active,
      contractorStatus: sql<string | null>`(select c.service_status from ${contractors} c where c.id = ${s.contractorId ?? null}::uuid)`,
      projectStatus: sql<string | null>`(select p.status from ${projects} p where p.id = ${s.projectId ?? null}::uuid)`,
    })
    .from(employees)
    .where(eq(employees.id, s.executorEmployeeId));
  return {
    executorActive: Boolean(row?.executorActive),
    contractorStatus: row?.contractorStatus ?? null,
    projectStatus: row?.projectStatus ?? null,
  };
}

/**
 * Передача контрагентов (прототип `transferCp`): серии по этим контрагентам у прежнего исполнителя, кроме
 * завершённых, переходят к новому, у каждой — запись истории серии.
 */
export async function moveContractorSeries(
  tx: Tx,
  moves: readonly { contractorId: string; from: string | null }[],
  to: string,
): Promise<number> {
  let n = 0;
  for (const m of moves) {
    if (!m.from || m.from === to) continue;
    const rows = await tx
      .update(taskSeries)
      .set({
        executorEmployeeId: to,
        version: sql`${taskSeries.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(
        and(
          eq(taskSeries.contractorId, m.contractorId),
          eq(taskSeries.executorEmployeeId, m.from),
          ne(taskSeries.state, 'finished'),
        ),
      )
      .returning({ id: taskSeries.id });
    await writeHistory(
      tx,
      ...rows.map((r) => ({
        entity: 'task_series' as const,
        entityId: r.id,
        action: 'update' as const,
        contractorId: m.contractorId,
        changes: [{ field: 'executorEmployeeId', from: m.from, to }] as HistoryChange[],
      })),
    );
    n += rows.length;
  }
  return n;
}

/*
 * Вкладка «Повторы» (блок 4, пункт 3; прототип `tsRender`): одна строка на серию. Правило и окончание
 * словами считает домен — они приходят в запрос одним параметром (`jsonb_to_recordset`).
 */

/** «До 27.02.2027», «30 повторов», «Никогда» (прототип `tsEndTxt`). */
export function seriesEndText(rule: SeriesRule): string {
  const e = rule.end;
  if (e.kind === 'date' && e.date) return `До ${formatDateRu(e.date)}`;
  if (e.kind === 'count' && e.count) {
    const form = { one: 'повтор', few: 'повтора', many: 'повторов' }[pluralForm(e.count)];
    return `${e.count} ${form}`;
  }
  return 'Никогда';
}

/** Правила словами всех серий организации из контекста — для списков задач и серий. */
export async function seriesTexts(tx: Tx): Promise<SeriesTextRow[]> {
  const rows = await tx.select(seriesFields).from(taskSeries);
  return rows.map((r) => {
    const s = toSeries(r as SeriesRowData);
    return { id: s.id, text: seriesTextOf(s), end: seriesEndText(s.rule) };
  });
}

export interface SeriesTextRow {
  id: string;
  text: string;
  end: string;
}

/** Таблица текстов серий для запроса: `st(id, text, end_text)`. */
export function seriesTextTable(rows: readonly SeriesTextRow[]): SQL {
  const json = JSON.stringify(rows.map((r) => ({ id: r.id, text: r.text, end_text: r.end })));
  return sql`(select * from jsonb_to_recordset(${json}::jsonb) as r(id uuid, text text, end_text text))`;
}

const ss = (name: string) => sql.raw(`"ss"."${name}"`);
const SS = {
  id: ss('id'),
  title: ss('title'),
  executorId: ss('executor_id'),
  contractorId: ss('contractor_id'),
  authorId: ss('author_id'),
  state: ss('state'),
  stopReason: ss('stop_reason'),
  next: ss('next'),
  made: ss('made'),
  task: ss('task_id'),
  createdAt: ss('created_at'),
  version: ss('version'),
};
const st = (name: string) => sql.raw(`"st"."${name}"`);

/** Выборка `ss`: серии с ближайшей задачей, «Следующая» и числом поставленных. */
function seriesListSource(today: IsoDate): SQL {
  const d = dateLiteral(today);
  return sql`(select s.id, s.title, s.executor_employee_id as executor_id, s.contractor_id,
      s.author_employee_id as author_id, s.state::text as state, s.stop_reason::text as stop_reason,
      s.created_at, s.version,
      (select count(*)::integer from ${tasks} t where t.series_id = s.id) as made,
      case when s.state = 'active' then coalesce(
        (select min(t.due_date) from ${tasks} t where t.series_id = s.id and t.due_date >= ${d}),
        s.next_date) end as next,
      coalesce(
        (select t.id from ${tasks} t where t.series_id = s.id and t.due_date >= ${d} order by t.series_date, t.id limit 1),
        (select t.id from ${tasks} t where t.series_id = s.id order by t.series_date desc, t.id desc limit 1)) as task_id
    from ${taskSeries} s)`;
}

const sExec = alias(employees, 'series_exec');
const sAuthor = alias(employees, 'series_author');

export interface SeriesListOptions {
  t: ListTexts;
  today: IsoDate;
  texts: readonly SeriesTextRow[];
  /** Постановщик, чьи серии видны; null — все (владелец и «Видеть задачи всех»). */
  authorEmployeeId: string | null;
}

function fromSeriesList(tx: Tx, fields: object, o: SeriesListOptions) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(sql`${seriesListSource(o.today)} as "ss"`)
    .leftJoin(sql`${seriesTextTable(o.texts)} as "st"`, sql`${st('id')} = ${SS.id}`)
    .leftJoin(sExec, sql`${sExec.id} = ${SS.executorId}`)
    .leftJoin(sAuthor, sql`${sAuthor.id} = ${SS.authorId}`)
    .leftJoin(contractors, sql`${contractors.id} = ${SS.contractorId}`)
    .$dynamic();
}

const seriesListFrom =
  (tx: Tx, o: SeriesListOptions): ListFrom =>
  (fields) =>
    fromSeriesList(tx, fields, o);

/** Порядок «Следующая»: ближайшие действующие сверху, остановленные и завершённые — в конце. */
const NEXT_SORT = sql`(case ${SS.state} when 'active' then 0 when 'stopped' then 1 else 2 end, ${SS.next})`;

/** Столбцы вкладки «Повторы» (прототип `tsRender`). */
export function seriesListColumns(t: ListTexts): ListColumns {
  const state = sql`case ${SS.state} when 'active' then ${dictLiteral(t('task.series.state.active'))} when 'stopped' then ${dictLiteral(t('task.series.state.stopped'))} else ${dictLiteral(t('task.series.state.finished'))} end`;
  return {
    title: { type: 'text', label: 'task.col.title', value: SS.title },
    rule: { type: 'text', label: 'task.col.repeat', value: sql`coalesce(${st('text')}, '')` },
    exec: {
      type: 'enum',
      label: 'task.col.exec',
      value: SS.executorId,
      display: sExec.shortName,
      sort: { value: sExec.shortName, text: true },
    },
    cp: {
      type: 'enum',
      label: 'task.col.cp',
      value: sql`coalesce(${SS.contractorId}::text, 'general')`,
      display: sql`coalesce(${contractors.name}, ${dictLiteral(t('task.cp.general_filter'))})`,
      searchDisplay: sql`coalesce(${contractors.name}, ${dictLiteral(t('task.cp.general'))})`,
      digits: contractors.inn,
      sort: {
        value: sql`(${SS.contractorId} is not null, ${contractors.name} collate app.ru_natural)`,
        text: false,
      },
    },
    next: {
      type: 'date',
      label: 'task.series.col.next',
      value: SS.next,
      sort: { value: NEXT_SORT, text: false },
    },
    end: { type: 'enum', label: 'task.series.col.end', value: sql`coalesce(${st('end_text')}, '')` },
    state: { type: 'enum', label: 'task.series.col.state', value: SS.state, display: state },
    by: {
      type: 'enum',
      label: 'task.col.by',
      value: SS.authorId,
      display: sAuthor.shortName,
      sort: { value: sAuthor.shortName, text: true },
    },
    created: {
      type: 'date',
      label: 'task.series.col.created',
      value: sql`(${SS.createdAt} at time zone 'Asia/Bishkek')::date`,
    },
    made: { type: 'int', label: 'task.series.col.made', value: SS.made },
  };
}

function seriesListFields() {
  return {
    id: sql<string>`${SS.id}`,
    title: sql<string>`${SS.title}`,
    text: sql<string | null>`${st('text')}`,
    end: sql<string | null>`${st('end_text')}`,
    executorId: sql<string>`${SS.executorId}`,
    executorName: sExec.shortName,
    contractorId: sql<string | null>`${SS.contractorId}`,
    contractorName: contractors.name,
    authorId: sql<string>`${SS.authorId}`,
    authorName: sAuthor.shortName,
    state: sql<string>`${SS.state}`,
    stopReason: sql<string | null>`${SS.stopReason}`,
    next: sql<string | null>`${SS.next}::text`,
    made: sql<number>`${SS.made}`,
    task: sql<string | null>`${SS.task}`,
    createdAt: sql<Date>`${SS.createdAt}`.mapWith((v) => new Date(v as string)),
    version: sql<number>`${SS.version}`,
  };
}

/** Строка вкладки «Повторы». */
export interface SeriesListRow {
  id: string;
  title: string;
  text: string;
  end: string;
  executor: { id: string; shortName: string };
  contractor: { id: string; name: string } | null;
  author: { id: string; shortName: string };
  state: SeriesState;
  stopReason: SeriesStopReason | null;
  next: IsoDate | null;
  made: number;
  task: string | null;
  createdAt: Date;
  version: number;
}

type SeriesListData = Record<keyof ReturnType<typeof seriesListFields>, unknown>;

function toSeriesListRow(r: SeriesListData): SeriesListRow {
  const cp = r.contractorId as string | null;
  return {
    id: r.id as string,
    title: r.title as string,
    text: (r.text as string | null) ?? '',
    end: (r.end as string | null) ?? '',
    executor: { id: r.executorId as string, shortName: (r.executorName as string | null) ?? '' },
    contractor: cp ? { id: cp, name: (r.contractorName as string | null) ?? '' } : null,
    author: { id: r.authorId as string, shortName: (r.authorName as string | null) ?? '' },
    state: r.state as SeriesState,
    stopReason: (r.stopReason as SeriesStopReason | null) ?? null,
    next: (r.next as IsoDate | null) ?? null,
    made: Number(r.made ?? 0),
    task: (r.task as string | null) ?? null,
    createdAt: r.createdAt as Date,
    version: Number(r.version),
  };
}

/** Чьи серии видны: свои — постановщик; владелец и «Видеть задачи всех» — все (прототип `tsScope`). */
const seriesScope = (o: SeriesListOptions): SQL | undefined =>
  o.authorEmployeeId ? sql`${SS.authorId} = ${o.authorEmployeeId}` : undefined;

const SERIES_NATURAL = [NEXT_SORT, SS.createdAt, SS.id];
// Как в прототипе (`tsRender`): по ближайшей дате.
const SERIES_SORT: ListSort = { key: 'next', dir: 'asc' };

export async function listSeriesPage(
  tx: Tx,
  query: ListQuery,
  o: SeriesListOptions,
): Promise<ListPageResult<SeriesListRow>> {
  const fields = seriesListFields();
  const page = await selectListPage({
    query,
    columns: seriesListColumns(o.t),
    natural: SERIES_NATURAL,
    defaultSort: SERIES_SORT,
    scope: seriesScope(o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromSeriesList(tx, { ...fields, ...window } as typeof fields & ListWindowFields, o)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (SeriesListData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: seriesListFrom(tx, o),
  });
  return { ...page, rows: page.rows.map((r) => toSeriesListRow(r as SeriesListData)) };
}

export function listSeriesValues(tx: Tx, key: string, o: SeriesListOptions, q?: string) {
  return selectListValues({
    columns: seriesListColumns(o.t),
    key,
    scope: seriesScope(o),
    from: seriesListFrom(tx, o),
    q,
  });
}

export function exportSeries(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: SeriesListOptions,
) {
  return selectListExport({
    query,
    columns: seriesListColumns(o.t),
    keys,
    natural: SERIES_NATURAL,
    defaultSort: SERIES_SORT,
    scope: seriesScope(o),
    from: seriesListFrom(tx, o),
  });
}

/** Счётчик вкладки «Повторы»: действующие серии в видимости (прототип `taskTabs`). */
export async function activeSeriesCount(tx: Tx, authorEmployeeId: string | null): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(taskSeries)
    .where(
      and(
        eq(taskSeries.state, 'active'),
        authorEmployeeId ? eq(taskSeries.authorEmployeeId, authorEmployeeId) : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Последняя дата серии (для «Эту и следующие» — после правки серии). */
export async function seriesLastDate(tx: Tx, seriesId: string): Promise<IsoDate | null> {
  const [row] = await tx
    .select({ d: max(tasks.seriesDate) })
    .from(tasks)
    .where(eq(tasks.seriesId, seriesId));
  return (row?.d as IsoDate | null) ?? null;
}

/** Событие серии для сообщений (ночной запуск и действия без человека): запись истории задачи. */
export interface SeriesNotice {
  /** Номер записи истории — ключ сообщения: повтор сбора ничего не удваивает. */
  auditId: number;
  action: 'series_make' | 'series_end' | 'series_stop';
  taskId: string;
  /** Кто: пусто — система (только такие «Повтор остановлен» идут постановщику, прототип `tsHalt`). */
  byUser: boolean;
  /** Причина остановки словами (поле `why`), у прочих — пусто. */
  why: string;
}

/**
 * События серий организации из контекста с момента `since` (блок 5, пункты 2 и 4): «Задача поставлена
 * по повтору», «Повтор закончился», «Повтор остановлен» — старые сверху.
 */
export async function seriesNotices(tx: Tx, since: Date): Promise<SeriesNotice[]> {
  const rows = await tx
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityId: auditLog.entityId,
      actor: auditLog.actorUserId,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entity, 'task'),
        inArray(auditLog.action, ['series_make', 'series_end', 'series_stop']),
        gte(auditLog.at, since),
      ),
    )
    .orderBy(asc(auditLog.at), asc(auditLog.id));
  return rows.map((r) => {
    const why = (r.changes ?? []).find((c) => c.field === 'why')?.to;
    return {
      auditId: r.id,
      action: r.action as SeriesNotice['action'],
      taskId: r.entityId,
      byUser: r.actor !== null,
      why: typeof why === 'string' ? why : '',
    };
  });
}
