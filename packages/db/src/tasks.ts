import {
  auditActorName,
  scaleStatuses,
  type HistoryChange,
  type IsoDate,
  type ListQuery,
  type TaskStatus,
  type TaskTerm,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { updateWithHistory, writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListTexts,
  type ListWindowFields,
} from './list';
import {
  contractors,
  employees,
  files,
  statusHistory,
  taskCategories,
  taskComments,
  tasks,
  users,
} from './schema';
import type { AuditRecord } from './staff';
import { writeStatusChange } from './status';

/**
 * Модуль «Задачи» (задача 2.23): ручные задачи организации из контекста `withOrgContext` (RLS).
 * Кто какие задачи видит — условие `taskVisibility` (ТЗ «Права»: свои — все сотрудники, все — право
 * «Видеть задачи всех», ждущие подтверждения — право «Подтверждать задачи»); вкладки, срок «с текущего
 * месяца» и плашка «На подтверждении» — как `renderTasks` прототипа. Правка — с историей `task`
 * (`updateWithHistory`), смена статуса — в «Истории статусов» (шкала `task`), в той же транзакции.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Открытая задача — её ещё делают (как `taskOpen` в @buhuchet/domain). */
const OPEN_SQL = sql`${tasks.status} in ('todo', 'in_progress', 'rework')`;

/** Просрочена: открыта, а срок прошёл (как `taskOverdue`). */
function overdueSql(today: IsoDate): SQL {
  return sql`(${OPEN_SQL} and ${tasks.dueDate} < ${today}::date)`;
}

/** Кто смотрит: сотрудник и его права «Видеть задачи всех» и «Подтверждать задачи». */
export interface TaskViewer {
  employeeId: string;
  all: boolean;
  canConfirm: boolean;
}

/**
 * Какие задачи видит сотрудник (прототип `taskScope`): с правом «Видеть задачи всех» — все; иначе свои
 * (исполнитель или постановщик) и — с правом «Подтверждать задачи» — все ждущие подтверждения.
 * undefined — все задачи организации (их отсекает RLS).
 */
export function taskVisibility(v: TaskViewer): SQL | undefined {
  if (v.all) return undefined;
  return or(
    eq(tasks.executorEmployeeId, v.employeeId),
    eq(tasks.authorEmployeeId, v.employeeId),
    v.canConfirm ? eq(tasks.status, 'on_confirm') : undefined,
  );
}

const executor = alias(employees, 'task_executor');
const author = alias(employees, 'task_author');
const confirmer = alias(employees, 'task_confirmer');
const reworker = alias(employees, 'task_reworker');
const creator = alias(employees, 'task_creator');
const updater = alias(employees, 'task_updater');

/** Есть ли у задачи загруженный файл (блок «Файлы» задачи, источник `task`). */
const HAS_FILE = sql<boolean>`exists (select 1 from ${files} where ${files.sourceKind} = 'task' and ${files.sourceId} = ${tasks.id} and ${files.state} = 'ready')`;

/** Последняя смена статуса задачи: поле записи «Истории статусов» (шкала в списке — под статусом). */
const lastStatus = (field: SQL) =>
  sql`(select ${field} from ${statusHistory} where ${statusHistory.scale} = 'task' and ${statusHistory.entityId} = ${tasks.id} order by ${statusHistory.at} desc, ${statusHistory.id} desc limit 1)`;
const LAST_STATUS_AT = lastStatus(sql`${statusHistory.at}`);
const LAST_STATUS_USER = lastStatus(sql`${statusHistory.actorUserId}`);
const LAST_STATUS_NAME = lastStatus(
  sql`(select e.short_name from ${employees} e where e.user_id = ${statusHistory.actorUserId})`,
);

function rowFields() {
  return {
    id: tasks.id,
    title: tasks.title,
    categoryCode: tasks.categoryCode,
    categoryName: taskCategories.name,
    contractorId: tasks.contractorId,
    contractorName: contractors.name,
    contractorResponsibleId: contractors.responsibleEmployeeId,
    executorId: tasks.executorEmployeeId,
    executorName: executor.shortName,
    authorId: tasks.authorEmployeeId,
    authorName: author.shortName,
    term: tasks.term,
    dueDate: tasks.dueDate,
    needFile: tasks.needFile,
    confirm: tasks.confirm,
    status: tasks.status,
    doneAt: tasks.doneAt,
    hasFile: HAS_FILE,
    confirmedById: tasks.confirmedByEmployeeId,
    confirmedByName: confirmer.shortName,
    statusAt: sql<Date | null>`${LAST_STATUS_AT}`.mapWith((v) => (v == null ? null : new Date(v))),
    statusUser: sql<string | null>`${LAST_STATUS_USER}`,
    statusName: sql<string | null>`${LAST_STATUS_NAME}`,
    createdAt: tasks.createdAt,
    createdBy: tasks.createdBy,
    createdByName: creator.shortName,
    updatedAt: tasks.updatedAt,
    updatedBy: tasks.updatedBy,
    updatedByName: updater.shortName,
    version: tasks.version,
  };
}

/** Задачи с категорией, контрагентом, исполнителем, постановщиком и именами «Создал», «Изменил». */
function fromTasks(tx: Tx, fields: object) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(tasks)
    .innerJoin(taskCategories, eq(taskCategories.code, tasks.categoryCode))
    .leftJoin(contractors, eq(contractors.id, tasks.contractorId))
    .innerJoin(executor, eq(executor.id, tasks.executorEmployeeId))
    .innerJoin(author, eq(author.id, tasks.authorEmployeeId))
    .leftJoin(confirmer, eq(confirmer.id, tasks.confirmedByEmployeeId))
    .leftJoin(creator, eq(creator.userId, tasks.createdBy))
    .leftJoin(updater, eq(updater.userId, tasks.updatedBy))
    .$dynamic();
}

const taskListFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    fromTasks(tx, fields);

type RowData = Record<keyof ReturnType<typeof rowFields>, unknown>;

/** Строка списка задач. */
export interface TaskRow {
  id: string;
  title: string;
  category: { code: string; name: string };
  /** null — общая задача. */
  contractor: { id: string; name: string; responsibleEmployeeId: string | null } | null;
  executor: { id: string; shortName: string };
  author: { id: string; shortName: string };
  term: TaskTerm;
  dueDate: IsoDate;
  needFile: boolean;
  confirm: boolean;
  status: TaskStatus;
  doneAt: Date | null;
  /** Есть ли загруженный файл. */
  hasFile: boolean;
  confirmedBy: { id: string; shortName: string } | null;
  /** Последняя смена статуса: когда и кем (null — система). */
  lastStatus: { at: Date; by: string | null } | null;
  audit: AuditRecord;
  version: number;
}

function toRow(r: RowData): TaskRow {
  const contractorId = r.contractorId as string | null;
  const confirmedById = r.confirmedById as string | null;
  return {
    id: r.id as string,
    title: r.title as string,
    category: { code: r.categoryCode as string, name: r.categoryName as string },
    contractor: contractorId
      ? {
          id: contractorId,
          name: (r.contractorName as string | null) ?? '',
          responsibleEmployeeId: r.contractorResponsibleId as string | null,
        }
      : null,
    executor: { id: r.executorId as string, shortName: (r.executorName as string) ?? '' },
    author: { id: r.authorId as string, shortName: (r.authorName as string) ?? '' },
    term: r.term as TaskTerm,
    dueDate: r.dueDate as IsoDate,
    needFile: r.needFile as boolean,
    confirm: r.confirm as boolean,
    status: r.status as TaskStatus,
    doneAt: (r.doneAt as Date | null) ?? null,
    hasFile: Boolean(r.hasFile),
    confirmedBy: confirmedById
      ? { id: confirmedById, shortName: (r.confirmedByName as string | null) ?? '' }
      : null,
    lastStatus: r.statusAt
      ? {
          at: r.statusAt as Date,
          by: auditActorName(r.statusUser as string | null, r.statusName as string | null),
        }
      : null,
    audit: {
      createdAt: r.createdAt as Date,
      createdBy: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
      updatedAt: r.updatedAt as Date,
      updatedBy: auditActorName(r.updatedBy as string | null, r.updatedByName as string | null),
    },
    version: r.version as number,
  };
}

/** Порядок статусов в сортировке и фильтре — по шкале задачи. */
const STATUS_ORDER = sql.raw(
  `case "tasks"."status" ${scaleStatuses('task')
    .map((s, i) => `when '${s}' then ${i}`)
    .join(' ')} end`,
);

const CREATED_BY = auditActorValue(tasks.createdBy, creator.shortName);

/** Срок, как на экране: у задачи на месяц — «до 31.10.2026». */
function dueText(t: ListTexts): SQL {
  const date = sql`to_char(${tasks.dueDate}, 'DD.MM.YYYY')`;
  return sql`case when ${tasks.term} = 'month' then replace(${t('task.date.month')}, '{date}', ${date}) else ${date} end`;
}

/** Отметка «Подтверждение» (прототип `taskConfTxt`): «Не требуется», «Подтвердил …», «Требуется». */
function confirmText(t: ListTexts): SQL {
  return sql`case when not ${tasks.confirm} then ${t('task.confirm.not_required')} when ${tasks.status} = 'confirmed' and ${confirmer.shortName} is not null then replace(${t('task.confirm.confirmed')}, '{name}', ${confirmer.shortName}) else ${t('task.confirm.required')} end`;
}

const CONFIRM_VALUE = sql`case when not ${tasks.confirm} then 'not_required' when ${tasks.status} = 'confirmed' and ${tasks.confirmedByEmployeeId} is not null then 'confirmed:' || ${tasks.confirmedByEmployeeId}::text else 'required' end`;

const yesNo = (t: ListTexts, value: SQL | typeof tasks.needFile) =>
  sql`case when ${value} then ${t('task.yes')} else ${t('task.no')} end`;

/**
 * Столбцы списка задач на сервере (ТЗ «Задачи» → «Общие задачи в списке», «Столбцы, видимые по
 * умолчанию»; прототип `taskCols`): ключи — как у столбцов экрана. «Общие задачи» в фильтре по
 * контрагенту — первым значением, «Вид задачи» — для фильтра, группировки и выгрузки. Столбец
 * «Проект» добавит задача 2.26, регулярные задачи — 2.24.
 */
export function taskListColumns(t: ListTexts): ListColumns {
  return {
    title: { type: 'text', label: 'task.col.title', value: tasks.title },
    cp: {
      type: 'enum',
      label: 'task.col.cp',
      value: sql`coalesce(${tasks.contractorId}::text, 'general')`,
      display: sql`coalesce(${contractors.name}, ${t('task.cp.general_filter')})`,
      // «Общие задачи» — первыми (прототип: pin), остальные — по названию по-русски.
      sort: {
        value: sql`(${tasks.contractorId} is not null, ${contractors.name} collate app.ru_natural)`,
        text: false,
      },
    },
    cat: {
      type: 'enum',
      label: 'task.col.cat',
      value: tasks.categoryCode,
      display: taskCategories.name,
      sort: { value: taskCategories.name, text: true },
    },
    exec: {
      type: 'enum',
      label: 'task.col.exec',
      value: tasks.executorEmployeeId,
      display: executor.shortName,
      sort: { value: executor.shortName, text: true },
    },
    date: { type: 'date', label: 'task.col.date', value: tasks.dueDate, display: dueText(t) },
    status: {
      type: 'enum',
      label: 'task.col.status',
      value: tasks.status,
      display: sql`case ${tasks.status} ${sql.join(
        scaleStatuses('task').map((s) => sql`when ${s} then ${t(`status.task.${s}`)}`),
        sql` `,
      )} end`,
      sort: { value: STATUS_ORDER, text: false },
    },
    needFile: {
      type: 'enum',
      label: 'task.col.need_file',
      value: sql`case when ${tasks.needFile} then 'yes' else 'no' end`,
      display: yesNo(t, tasks.needFile),
    },
    doneAt: {
      type: 'date',
      label: 'task.col.done_at',
      value: sql`(${tasks.doneAt} at time zone 'Asia/Bishkek')::date`,
    },
    file: {
      type: 'enum',
      label: 'task.col.file',
      value: sql`case when not ${tasks.needFile} then null when ${HAS_FILE} then 'attached' else 'needed' end`,
      display: sql`case when not ${tasks.needFile} then null when ${HAS_FILE} then ${t('task.file.attached')} else ${t('task.file.needed')} end`,
    },
    by: {
      type: 'enum',
      label: 'task.col.by',
      value: tasks.authorEmployeeId,
      display: author.shortName,
      sort: { value: author.shortName, text: true },
    },
    confirm: {
      type: 'enum',
      label: 'task.col.confirm',
      value: CONFIRM_VALUE,
      display: confirmText(t),
    },
    scope: {
      type: 'enum',
      label: 'task.col.scope',
      value: sql`case when ${tasks.contractorId} is null then 'general' else 'contractor' end`,
      display: sql`case when ${tasks.contractorId} is null then ${t('task.scope.general')} else ${t('task.scope.contractor')} end`,
    },
    tkind: {
      type: 'enum',
      label: 'task.col.tkind',
      value: sql`'manual'`,
      display: sql`${t('task.tkind.manual')}::text`,
    },
    term: {
      type: 'enum',
      label: 'task.col.term',
      value: tasks.term,
      display: sql`case when ${tasks.term} = 'month' then ${t('task.term.month')} else ${t('task.term.day')} end`,
    },
    open: {
      type: 'enum',
      label: 'task.col.open',
      value: sql`case when ${OPEN_SQL} then 'yes' else 'no' end`,
      display: yesNo(t, OPEN_SQL),
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: tasks.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: tasks.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(tasks.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
}

/** Вкладки модуля (прототип `taskTabs`). */
export const TASK_TABS = ['mine', 'byme', 'all', 'overdue'] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export interface TaskListOptions {
  t: ListTexts;
  today: IsoDate;
  viewer: TaskViewer;
  tab: TaskTab;
}

/** Первый день месяца даты. */
const monthStartOf = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

/** Фильтр «Статус» выбирает «На подтверждении» (плашка): тогда вкладка и месяц не сужают список. */
function pendingFilter(query: Pick<ListQuery, 'filters'>): boolean {
  const f = query.filters.status;
  return !!f && f.type === 'enum' && f.vals.includes('on_confirm');
}

/**
 * Условие списка (прототип `renderTasks` → rows): видимость; вкладка — «Мои» (исполнитель), «Поставленные
 * мной», «Все», «Просроченные» (все просроченные); остальные вкладки — с текущего месяца, вперёд и всё
 * просроченное. Плашка «На подтверждении» (фильтр статуса) показывает все видимые ждущие задачи.
 */
function listScope(query: Pick<ListQuery, 'filters'>, o: TaskListOptions): SQL | undefined {
  const visible = taskVisibility(o.viewer);
  if (o.tab === 'overdue') return and(visible, overdueSql(o.today));
  if (pendingFilter(query)) return visible;
  const tab =
    o.tab === 'mine'
      ? eq(tasks.executorEmployeeId, o.viewer.employeeId)
      : o.tab === 'byme'
        ? eq(tasks.authorEmployeeId, o.viewer.employeeId)
        : undefined;
  const fromMonth = or(
    sql`${tasks.dueDate} >= ${monthStartOf(o.today)}::date`,
    overdueSql(o.today),
  );
  // «Поставленные мной» — все поставленные, даже вне видимости (прототип: TASKS.filter(by === me)).
  return o.tab === 'byme' ? and(tab, fromMonth) : and(visible, tab, fromMonth);
}

const TASK_NATURAL = [tasks.createdAt, tasks.id];

/** Страница списка задач: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listTasksPage(
  tx: Tx,
  query: ListQuery,
  o: TaskListOptions,
): Promise<ListPageResult<TaskRow>> {
  const fields = rowFields();
  const page = await selectListPage({
    query,
    columns: taskListColumns(o.t),
    natural: TASK_NATURAL,
    scope: listScope(query, o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromTasks(tx, { ...fields, ...window } as typeof fields & ListWindowFields)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (RowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: taskListFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r as RowData)) };
}

/** Значения столбца для фильтра-галочек — в той же области и вкладке. */
export function listTaskValues(
  tx: Tx,
  key: string,
  o: TaskListOptions,
  query: Pick<ListQuery, 'filters'>,
  q?: string,
) {
  return selectListValues({
    columns: taskListColumns(o.t),
    key,
    scope: listScope(query, o),
    from: taskListFrom(tx),
    q,
  });
}

/** Задачи для выгрузки в Excel: все под поиском и фильтрами вкладки. */
export function exportTasks(tx: Tx, query: ListQuery, keys: readonly string[], o: TaskListOptions) {
  return selectListExport({
    query,
    columns: taskListColumns(o.t),
    keys,
    natural: TASK_NATURAL,
    scope: listScope(query, o),
    from: taskListFrom(tx),
  });
}

/**
 * Счётчики вкладок (прототип `taskTabs`): «Мои» — мои открытые, «Поставленные мной» — поставленные
 * мной открытые, «Просроченные» — просроченные среди видимых.
 */
export async function taskTabCounts(
  tx: Tx,
  viewer: TaskViewer,
  today: IsoDate,
): Promise<{ mine: number; byme: number; overdue: number }> {
  const visible = taskVisibility(viewer);
  const [row] = await tx
    .select({
      mine: sql<number>`count(*) filter (where ${tasks.executorEmployeeId} = ${viewer.employeeId} and ${OPEN_SQL})::int`,
      byme: sql<number>`count(*) filter (where ${tasks.authorEmployeeId} = ${viewer.employeeId} and ${OPEN_SQL})::int`,
      overdue: sql<number>`count(*) filter (where ${overdueSql(today)} and ${visible ?? sql`true`})::int`,
    })
    .from(tasks)
    .where(
      or(
        visible,
        eq(tasks.authorEmployeeId, viewer.employeeId),
        eq(tasks.executorEmployeeId, viewer.employeeId),
      ),
    );
  return { mine: row?.mine ?? 0, byme: row?.byme ?? 0, overdue: row?.overdue ?? 0 };
}

/**
 * Плашка «На подтверждении» (прототип `renderTasks`): ждущие подтверждения среди видимых и сколько из
 * них сотрудник может подтвердить (не свои; постановщик или право «Подтверждать задачи»).
 */
export async function taskPendingStats(
  tx: Tx,
  viewer: TaskViewer,
): Promise<{ pending: number; canConfirm: number }> {
  const mayConfirm = viewer.canConfirm
    ? sql`${tasks.executorEmployeeId} <> ${viewer.employeeId}`
    : sql`${tasks.executorEmployeeId} <> ${viewer.employeeId} and ${tasks.authorEmployeeId} = ${viewer.employeeId}`;
  const [row] = await tx
    .select({
      pending: sql<number>`count(*)::int`,
      canConfirm: sql<number>`count(*) filter (where ${mayConfirm})::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.status, 'on_confirm'), taskVisibility(viewer)));
  return { pending: row?.pending ?? 0, canConfirm: row?.canConfirm ?? 0 };
}

/** Карточка задачи: строка списка, описание, причины, подтверждение. */
export interface TaskRecord extends TaskRow {
  description: string;
  executorFullName: string;
  executorActive: boolean;
  categoryActive: boolean;
  failReason: string;
  reworkReason: string;
  reworkBy: { id: string; shortName: string } | null;
  confirmedByFullName: string | null;
  confirmedAt: Date | null;
  confirmNote: string;
}

/**
 * Задача, если сотрудник её видит (`where` — видимость и доступ через контрагента); null — нет такой в
 * организации или она не видна.
 */
export async function getTask(
  tx: Tx,
  id: string,
  where: SQL | undefined,
): Promise<TaskRecord | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await fromTasks(tx, {
    ...rowFields(),
    description: tasks.description,
    executorFullName: executor.fullName,
    executorActive: executor.active,
    categoryActive: taskCategories.active,
    failReason: tasks.failReason,
    reworkReason: tasks.reworkReason,
    reworkById: tasks.reworkByEmployeeId,
    reworkByName: reworker.shortName,
    confirmedByFullName: confirmer.fullName,
    confirmedAt: tasks.confirmedAt,
    confirmNote: tasks.confirmNote,
  })
    .leftJoin(reworker, eq(reworker.id, tasks.reworkByEmployeeId))
    .where(and(eq(tasks.id, id), where));
  if (!row) return null;
  const r = row as RowData & Record<string, unknown>;
  const reworkById = r.reworkById as string | null;
  return {
    ...toRow(r),
    description: r.description as string,
    executorFullName: r.executorFullName as string,
    executorActive: r.executorActive as boolean,
    categoryActive: r.categoryActive as boolean,
    failReason: r.failReason as string,
    reworkReason: r.reworkReason as string,
    reworkBy: reworkById
      ? { id: reworkById, shortName: (r.reworkByName as string | null) ?? '' }
      : null,
    confirmedByFullName: (r.confirmedByFullName as string | null) ?? null,
    confirmedAt: (r.confirmedAt as Date | null) ?? null,
    confirmNote: r.confirmNote as string,
  };
}

/**
 * Доступ к задаче через контрагента (вкладка «Задачи» карточки контрагента показывает все его задачи):
 * задача по контрагенту, который виден в области `scope` (`contractorScope`). Условие ссылается на
 * присоединённого контрагента — только для `getTask` и `contractorTasks`.
 */
export function taskContractorAccess(scope: SQL | undefined): SQL {
  return and(isNotNull(tasks.contractorId), scope)!;
}

/** Что нужно для решения о действии: строка задачи, заблокированная до конца транзакции. */
export interface TaskLock {
  id: string;
  status: TaskStatus;
  confirm: boolean;
  needFile: boolean;
  executorEmployeeId: string;
  authorEmployeeId: string;
  contractorId: string | null;
  dueDate: IsoDate;
  version: number;
}

export async function lockTask(tx: Tx, id: string): Promise<TaskLock | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select({
      id: tasks.id,
      status: tasks.status,
      confirm: tasks.confirm,
      needFile: tasks.needFile,
      executorEmployeeId: tasks.executorEmployeeId,
      authorEmployeeId: tasks.authorEmployeeId,
      contractorId: tasks.contractorId,
      dueDate: tasks.dueDate,
      version: tasks.version,
    })
    .from(tasks)
    .where(eq(tasks.id, id))
    .for('update');
  return (row as TaskLock | undefined) ?? null;
}

/** Поля задачи, которые задаёт форма. */
export interface TaskFields {
  title: string;
  description: string;
  categoryCode: string;
  contractorId: string | null;
  executorEmployeeId: string;
  term: TaskTerm;
  dueDate: IsoDate;
  needFile: boolean;
  confirm: boolean;
}

/**
 * Поставить задачу: постановщик — сотрудник текущего пользователя (`authorEmployeeId`, проверяет и
 * база), статус «К выполнению»; в истории — «создана», в «Истории статусов» — первая запись.
 */
export async function createTask(
  tx: Tx,
  fields: TaskFields,
  authorEmployeeId: string,
): Promise<string> {
  const [row] = await tx
    .insert(tasks)
    .values({
      ...fields,
      orgId: sql`app.current_org_id()`,
      authorEmployeeId,
      status: 'todo',
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: tasks.id });
  const id = row!.id;
  await writeHistory(tx, {
    entity: 'task',
    entityId: id,
    action: 'create',
    contractorId: fields.contractorId,
    changes: [{ field: 'title', to: fields.title }],
  });
  await writeStatusChange(tx, { scale: 'task', entityId: id, from: null, to: 'todo' });
  return id;
}

/** Смена статуса вместе с правкой: что меняется у задачи и запись «Истории статусов». */
export interface TaskStatusChange {
  from: TaskStatus;
  to: TaskStatus;
  reason?: string | null;
  rollback?: boolean;
  fileId?: string | null;
}

/**
 * «Изменить» (прототип `taskDlg`): поля формы с историей «было → стало» и проверкой версии; если снят
 * «Требуется подтверждение» у ждущей подтверждения или возвращённой на доработку, статус меняется в той
 * же транзакции (`status`).
 */
export async function updateTask(
  tx: Tx,
  id: string,
  version: number,
  fields: TaskFields,
  status: TaskStatusChange | null,
  contractorBefore: string | null,
): Promise<void> {
  await updateWithHistory(tx, {
    table: tasks,
    entity: 'task',
    id,
    version,
    patch: { ...fields, ...(status ? { status: status.to } : {}) },
    contractorId: fields.contractorId ?? contractorBefore,
  });
  if (status) await writeStatusChange(tx, { scale: 'task', entityId: id, ...status });
}

/** Поля, которые меняет действие со статусом (выполнение, подтверждение, причины, откат). */
export type TaskStatusPatch = Partial<
  Pick<
    typeof tasks.$inferInsert,
    | 'doneAt'
    | 'failReason'
    | 'reworkReason'
    | 'reworkByEmployeeId'
    | 'confirmedByEmployeeId'
    | 'confirmedAt'
    | 'confirmNote'
  >
>;

/**
 * Действие со статусом (взять в работу, выполнена, не выполнена, подтвердить, на доработку, отменить,
 * откат): статус и поля действия, версия +1, запись «Истории статусов». Строка уже заблокирована
 * (`lockTask`), можно ли действие — решил вызывающий по правилам @buhuchet/domain.
 */
export async function changeTaskStatus(
  tx: Tx,
  id: string,
  change: TaskStatusChange,
  patch: TaskStatusPatch = {},
): Promise<void> {
  await tx
    .update(tasks)
    .set({
      ...patch,
      status: change.to,
      version: sql`${tasks.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, change.from)));
  await writeStatusChange(tx, { scale: 'task', entityId: id, ...change });
}

export interface TaskComment {
  id: string;
  author: string | null;
  text: string;
  at: Date;
}

/** Комментарии задачи по порядку (прототип: `t.comments`). */
export async function listTaskComments(tx: Tx, taskId: string): Promise<TaskComment[]> {
  const who = alias(employees, 'comment_author');
  const rows = await tx
    .select({
      id: taskComments.id,
      userId: taskComments.authorUserId,
      name: who.shortName,
      text: taskComments.text,
      at: taskComments.createdAt,
    })
    .from(taskComments)
    .leftJoin(who, eq(who.userId, taskComments.authorUserId))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id));
  return rows.map((r) => ({
    id: r.id,
    author: auditActorName(r.userId, r.name),
    text: r.text,
    at: r.at,
  }));
}

/** Написать комментарий от своего имени (автор и время ставит база). */
export async function addTaskComment(tx: Tx, taskId: string, text: string): Promise<void> {
  await tx.insert(taskComments).values({ orgId: sql`app.current_org_id()`, taskId, text });
}

/** Сколько задач в карточке контрагента (прототип: последние 40, остальные — в модуле «Задачи»). */
export const CONTRACTOR_TASKS_SHOWN = 40;

/**
 * Вкладка «Задачи» карточки контрагента (ТЗ: «Задач: N · открытых M», последние 40): все задачи
 * контрагента, сначала новые.
 */
export async function contractorTasks(
  tx: Tx,
  contractorId: string,
): Promise<{ total: number; open: number; items: TaskRow[] }> {
  const [counts] = await tx
    .select({ total: count(), open: sql<number>`count(*) filter (where ${OPEN_SQL})::int` })
    .from(tasks)
    .where(eq(tasks.contractorId, contractorId));
  const rows = await fromTasks(tx, rowFields())
    .where(eq(tasks.contractorId, contractorId))
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(CONTRACTOR_TASKS_SHOWN);
  return {
    total: Number(counts?.total ?? 0),
    open: Number(counts?.open ?? 0),
    items: rows.map((r) => toRow(r as RowData)),
  };
}

/** Загруженные файлы задачи — для «Файл» в карточке и проверки «Требуется файл». */
export async function taskReadyFiles(
  tx: Tx,
  taskId: string,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(and(eq(files.sourceKind, 'task'), eq(files.sourceId, taskId), eq(files.state, 'ready')))
    .orderBy(asc(files.createdAt), asc(files.id));
}

/** Категория задачи: есть ли и действует ли; null — нет такой. */
export async function taskCategoryActive(tx: Tx, code: string): Promise<boolean | null> {
  const [row] = await tx
    .select({ active: taskCategories.active })
    .from(taskCategories)
    .where(eq(taskCategories.code, code));
  return row ? row.active : null;
}

/** Сотрудник текущего пользователя: исполнитель и постановщик задач — сотрудники. */
export async function currentEmployeeId(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(users.id, sql`app.current_user_id()`));
  return row?.id ?? null;
}

/**
 * Передача контрагентов (прототип `transferCp`): открытые задачи по этим контрагентам у прежнего
 * ответственного переходят к новому, у каждой — запись истории.
 */
export async function moveContractorTasks(
  tx: Tx,
  moves: readonly { contractorId: string; from: string | null }[],
  to: string,
): Promise<number> {
  const changes: { id: string; contractorId: string; from: string }[] = [];
  for (const m of moves) {
    if (!m.from || m.from === to) continue;
    const rows = await tx
      .update(tasks)
      .set({
        executorEmployeeId: to,
        version: sql`${tasks.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(
        and(
          eq(tasks.contractorId, m.contractorId),
          eq(tasks.executorEmployeeId, m.from),
          OPEN_SQL,
        ),
      )
      .returning({ id: tasks.id });
    for (const r of rows) changes.push({ id: r.id, contractorId: m.contractorId, from: m.from });
  }
  await writeHistory(
    tx,
    ...changes.map((c) => ({
      entity: 'task' as const,
      entityId: c.id,
      action: 'update' as const,
      contractorId: c.contractorId,
      changes: [{ field: 'executorEmployeeId', from: c.from, to }] as HistoryChange[],
    })),
  );
  return changes.length;
}

/** Открытые задачи сотрудника по его контрагентам — «Что перейдёт» при передаче дел. */
export async function openTasksOfContractors(
  tx: Tx,
  contractorIds: readonly string[],
  executorEmployeeId: string,
): Promise<number> {
  if (contractorIds.length === 0) return 0;
  const [row] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(
      and(
        inArray(tasks.contractorId, [...contractorIds]),
        eq(tasks.executorEmployeeId, executorEmployeeId),
        OPEN_SQL,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Открытые задачи сотрудника (плашка «Открытых задач» в карточке сотрудника). */
export async function openTasksOf(tx: Tx, executorEmployeeId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(tasks)
    .where(and(eq(tasks.executorEmployeeId, executorEmployeeId), OPEN_SQL));
  return Number(row?.n ?? 0);
}
