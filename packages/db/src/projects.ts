import {
  auditActorName,
  formatSomWithUnit,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_MEMBERS_MAX,
  PROJECT_WORKS_MAX,
  projectCancelable,
  projectOfferedForTask,
  projectProblems,
  projectWorksClean,
  RecordChangedError,
  RecordNotFoundError,
  scaleBack,
  scaleNext,
  scaleStatuses,
  type IsoDate,
  type ProjectNewStatus,
  type ProjectRefusal,
  type ProjectStatus,
  type ProjectWorkInput,
  type ListQuery,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import type { FileListPart } from './files';
import { writeHistory, type HistoryEntry } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListTexts,
  type ListWindowRow,
} from './list';
import {
  auditLog,
  contractors,
  employees,
  files,
  orgSettings,
  projectMembers,
  projectPayments,
  projects,
  projectWorks,
  tasks,
} from './schema';
import { dateLiteral, dictLiteral, textLiteral } from './sql-text';
import type { AuditRecord } from './staff';
import { writeStatusChange } from './status';

/*
 * «Проекты контрагентов» (задача 2.26; ТЗ «Модуль Проекты контрагентов»; прототип modules/projects.js).
 * Права и область проверяет API; здесь — кто какие проекты видит (`projectVisibility`, прототип
 * `projVisible`), список с вкладками и плашками, карточка, окно проекта, статусы с «Историей статусов»
 * (шкала `project`), работы и история (`project`). Проект не удаляется — «Отменить проект».
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Отказ правил проекта: код `err.<код>`, поле формы, подстановки текста. */
export class ProjectRefusedError extends Error {
  constructor(
    readonly code: ProjectRefusal,
    readonly status: 400 | 403 | 409,
    readonly field?: string,
    readonly params: Readonly<Record<string, string>> = {},
  ) {
    super(code);
    this.name = 'ProjectRefusedError';
  }
}

const refuse = (code: ProjectRefusal, status: 400 | 403 | 409, field?: string, amount?: Tyiyn) =>
  new ProjectRefusedError(
    code,
    status,
    field,
    amount !== undefined ? { amount: formatSomWithUnit(amount) } : {},
  );

/** Кто смотрит: сотрудник и область группы «Проекты контрагентов». */
export interface ProjectViewer {
  employeeId: string | null;
  /** Область «Все контрагенты» группы «Проекты контрагентов». */
  seeAll: boolean;
}

/**
 * Какие проекты видит сотрудник (прототип `projVisible`): область «Все» — все проекты организации;
 * иначе проекты своих контрагентов и проекты, где он один из ответственных. Условие — над `projects` и
 * присоединённым `contractors`; undefined — все (их отсекает RLS).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export function projectVisibility(v: ProjectViewer): SQL | undefined {
  if (v.seeAll) return undefined;
  if (!v.employeeId) return sql`false`;
  return sql`(${contractors.responsibleEmployeeId} = ${v.employeeId} or exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.employee_id = ${v.employeeId}))`;
}

/**
 * Проекты, которые видит сотрудник, — номерами (для доступа к задачам проекта и файлам): то же условие,
 * что `projectVisibility`, отдельным подзапросом.
 */
export function visibleProjectIds(v: ProjectViewer): SQL {
  return sql`(select ${projects.id} from ${projects} inner join ${contractors} on ${contractors.id} = ${projects.contractorId} where ${projectVisibility(v) ?? sql`true`})`;
}

/**
 * Задачи проектов, которые сотрудник видит (карточка проекта → «Задачи», прототип `openProject`): при
 * включённых «Проектах контрагентов» — задачи видимых ему проектов. Условие — над `tasks`.
 */
export function taskProjectAccess(v: ProjectViewer): SQL {
  return sql`(${tasks.projectId} in ${visibleProjectIds(v)} and exists (select 1 from ${orgSettings} s where s.org_id = ${tasks.orgId} and (s.features ->> 'projects') = 'true'))`;
}

const lead = alias(employees, 'project_lead');
const creator = alias(employees, 'project_creator');
const updater = alias(employees, 'project_updater');

const ACTIVE = sql`${projects.status} in ('planned', 'in_progress')`;
const WORKS_TOTAL = sql<number>`(select count(*)::int from ${projectWorks} w where w.project_id = ${projects.id})`;
const WORKS_DONE = sql<number>`(select count(*)::int from ${projectWorks} w where w.project_id = ${projects.id} and w.done)`;
const FILES_COUNT = sql<number>`(select count(*)::int from ${files} f where f.source_kind = 'project' and f.source_id = ${projects.id} and f.state = 'ready')`;
const TASKS_OPEN = sql<number>`(select count(*)::int from ${tasks} tk where tk.project_id = ${projects.id} and tk.status in ('todo', 'in_progress', 'rework'))`;
const MEMBER_NAMES = sql<string>`coalesce((select string_agg(e.short_name, ', ' order by pm.position, e.short_name) from ${projectMembers} pm join ${employees} e on e.id = pm.employee_id where pm.project_id = ${projects.id}), '')`;
const MEMBERS_JSON = sql<
  { id: string; name: string }[]
>`coalesce((select json_agg(json_build_object('id', e.id, 'name', e.short_name) order by pm.position, e.short_name) from ${projectMembers} pm join ${employees} e on e.id = pm.employee_id where pm.project_id = ${projects.id}), '[]'::json)`;
/** Получено по проекту — действующие оплаты (транши; прототип `projPaid`: без удалённых). */
const PAID = sql<number>`(select coalesce(sum(pp.amount), 0)::bigint from ${projectPayments} pp where pp.project_id = ${projects.id} and pp.deleted_at is null)`;
const LEFT = sql<number>`case when ${projects.plan} is null then null else greatest(0, ${projects.plan} - ${PAID}) end`;
const worksOverdue = (today: IsoDate) =>
  sql<boolean>`exists (select 1 from ${projectWorks} w where w.project_id = ${projects.id} and not w.done and w.due_date < ${dateLiteral(today)})`;
const overdue = (today: IsoDate) =>
  sql<boolean>`(${projects.status} = 'in_progress' and ${projects.endsOn} < ${dateLiteral(today)})`;

/** Порядок статусов в сортировке — по шкале: «Планируется», «В работе», «Завершён», «Отменён». */
const STATUS_ORDER = sql.raw(
  `case "projects"."status" ${scaleStatuses('project')
    .map((s, i) => `when '${s}' then ${i}`)
    .join(' ')} end`,
);

const CREATED_BY = auditActorValue(projects.createdBy, creator.shortName);

/**
 * Столбцы списка на сервере (прототип `projCols`): ключи — как у столбцов экрана. Деньги («Планируемая
 * стоимость», «Получено / план», «Остаток») — только тому, кто видит деньги проектов (`money`, прототип
 * `moneyVis`): без права их нет ни на экране, ни в фильтре, ни в выгрузке.
 */
export function projectListColumns(t: ListTexts, money: boolean): ListColumns {
  const statusText = sql`case ${projects.status} ${sql.join(
    scaleStatuses('project').map(
      (s) => sql`when ${textLiteral(s)} then ${dictLiteral(t(`status.project.${s}`))}`,
    ),
    sql` `,
  )} end`;
  const worksText = sql`case when ${WORKS_TOTAL} = 0 then null else replace(replace(${dictLiteral(t('proj.works.of'))}, '{done}', ${WORKS_DONE}::text), '{total}', ${WORKS_TOTAL}::text) end`;
  const cols: Record<string, ListColumns[string]> = {
    name: { type: 'text', label: 'proj.col.name', value: projects.name },
    cp: {
      type: 'enum',
      label: 'proj.col.cp',
      value: projects.contractorId,
      display: contractors.name,
      sort: { value: contractors.name, text: true },
      digits: contractors.inn,
    },
    status: {
      type: 'enum',
      label: 'proj.col.status',
      value: projects.status,
      display: statusText,
      sort: { value: STATUS_ORDER, text: false },
    },
    from: { type: 'date', label: 'proj.col.from', value: projects.startsOn },
    to: { type: 'date', label: 'proj.col.to', value: projects.endsOn },
    lead: {
      type: 'enum',
      label: 'proj.col.lead',
      value: projects.leadEmployeeId,
      display: lead.shortName,
      sort: { value: lead.shortName, text: true },
    },
    resps: { type: 'text', label: 'proj.col.resps', value: MEMBER_NAMES },
    desc: { type: 'text', label: 'proj.col.desc', value: projects.description },
    // Доля сделанных работ в процентах (прототип: `done / works.length`), на экране — «N из M».
    works: {
      type: 'int',
      label: 'proj.col.works',
      value: sql`case when ${WORKS_TOTAL} = 0 then 0 else round(${WORKS_DONE} * 100.0 / ${WORKS_TOTAL})::int end`,
      display: worksText,
    },
    nworks: { type: 'int', label: 'proj.col.nworks', value: WORKS_TOTAL },
    pfiles: { type: 'int', label: 'proj.col.files', value: FILES_COUNT },
    tasks: { type: 'int', label: 'proj.col.tasks', value: TASKS_OPEN },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: projects.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: projects.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(projects.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
  if (money) {
    cols.plan = { type: 'money', label: 'proj.col.plan', value: projects.plan, total: true };
    cols.paid = { type: 'money', label: 'proj.col.paid', value: PAID, total: true };
    cols.left = { type: 'money', label: 'proj.col.left', value: LEFT, total: true };
  }
  return cols;
}

/** Вкладки модуля (прототип `projTabs`). */
export const PROJECT_TABS = ['active', 'all', 'mine'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export interface ProjectListOptions {
  t: ListTexts;
  today: IsoDate;
  viewer: ProjectViewer;
  tab: ProjectTab;
  /** Видит ли деньги проектов (прототип `moneyVis`). */
  money: boolean;
}

/** Условие вкладки (прототип `renderProjects`, `rows`): «Активные», «Мои» — где я ответственный. */
function tabCondition(o: ProjectListOptions): SQL | undefined {
  if (o.tab === 'active') return ACTIVE;
  if (o.tab === 'mine') {
    if (!o.viewer.employeeId) return sql`false`;
    return sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.employee_id = ${o.viewer.employeeId})`;
  }
  return undefined;
}

function fromProjects(tx: Tx, fields: object) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .innerJoin(lead, eq(lead.id, projects.leadEmployeeId))
    .leftJoin(creator, eq(creator.userId, projects.createdBy))
    .leftJoin(updater, eq(updater.userId, projects.updatedBy))
    .$dynamic();
}

const projectListFrom =
  (tx: Tx): ListFrom =>
  (fields) =>
    fromProjects(tx, fields);

/** Строка списка проектов. */
export interface ProjectRow {
  id: string;
  name: string;
  contractor: { id: string; name: string };
  status: ProjectStatus;
  startsOn: IsoDate;
  endsOn: IsoDate;
  lead: { id: string; name: string };
  members: { id: string; name: string }[];
  description: string;
  worksDone: number;
  worksTotal: number;
  /** Есть работы с прошедшим сроком (прототип: значок у «Работ»). */
  worksOverdue: boolean;
  files: number;
  tasksOpen: number;
  /** Деньги — только тому, кто их видит: иначе null. */
  plan: Tyiyn | null;
  paid: Tyiyn | null;
  overdue: boolean;
  audit: AuditRecord;
  version: number;
}

function rowFields(today: IsoDate) {
  return {
    id: projects.id,
    name: projects.name,
    contractorId: projects.contractorId,
    contractorName: contractors.name,
    status: projects.status,
    startsOn: projects.startsOn,
    endsOn: projects.endsOn,
    leadId: projects.leadEmployeeId,
    leadName: lead.shortName,
    members: MEMBERS_JSON,
    description: projects.description,
    worksDone: WORKS_DONE,
    worksTotal: WORKS_TOTAL,
    worksOverdue: worksOverdue(today),
    files: FILES_COUNT,
    tasksOpen: TASKS_OPEN,
    plan: projects.plan,
    paid: PAID,
    overdue: overdue(today),
    createdAt: projects.createdAt,
    createdBy: projects.createdBy,
    createdByName: creator.shortName,
    updatedAt: projects.updatedAt,
    updatedBy: projects.updatedBy,
    updatedByName: updater.shortName,
    version: projects.version,
  };
}

type RowData = Record<keyof ReturnType<typeof rowFields>, unknown>;

function toRow(r: RowData, money: boolean): ProjectRow {
  const plan = r.plan == null ? null : Number(r.plan);
  return {
    id: r.id as string,
    name: r.name as string,
    contractor: { id: r.contractorId as string, name: r.contractorName as string },
    status: r.status as ProjectStatus,
    startsOn: r.startsOn as IsoDate,
    endsOn: r.endsOn as IsoDate,
    lead: { id: r.leadId as string, name: (r.leadName as string | null) ?? '' },
    members: (r.members as { id: string; name: string | null }[]).map((m) => ({
      id: m.id,
      name: m.name ?? '',
    })),
    description: r.description as string,
    worksDone: Number(r.worksDone),
    worksTotal: Number(r.worksTotal),
    worksOverdue: Boolean(r.worksOverdue),
    files: Number(r.files),
    tasksOpen: Number(r.tasksOpen),
    plan: money ? plan : null,
    paid: money ? Number(r.paid) : null,
    overdue: Boolean(r.overdue),
    audit: {
      createdAt: r.createdAt as Date,
      createdBy: auditActorName(r.createdBy as string | null, r.createdByName as string | null),
      updatedAt: r.updatedAt as Date,
      updatedBy: auditActorName(r.updatedBy as string | null, r.updatedByName as string | null),
    },
    version: r.version as number,
  };
}

/** Естественный порядок: окончание по возрастанию (прототип `sort: { key: 'to', dir: 1 }`), название. */
const NATURAL = [projects.endsOn, projects.name, projects.id];
const DEFAULT_SORT = { key: 'to', dir: 'asc' } as const;

export async function listProjectsPage(tx: Tx, query: ListQuery, o: ProjectListOptions) {
  const scope = and(projectVisibility(o.viewer), tabCondition(o));
  const page = await selectListPage({
    query,
    columns: projectListColumns(o.t, o.money),
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope,
    select: ({ window, where, orderBy, limit, offset }) =>
      fromProjects(tx, { ...rowFields(o.today), ...window })
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<(RowData & ListWindowRow)[]>,
    from: projectListFrom(tx),
  });
  return { ...page, rows: page.rows.map((r) => toRow(r as RowData, o.money)) };
}

export function listProjectValues(tx: Tx, key: string, o: ProjectListOptions, q?: string) {
  return selectListValues({
    columns: projectListColumns(o.t, o.money),
    key,
    scope: and(projectVisibility(o.viewer), tabCondition(o)),
    from: projectListFrom(tx),
    q,
  });
}

export function exportProjects(
  tx: Tx,
  query: ListQuery,
  keys: readonly string[],
  o: ProjectListOptions,
) {
  return selectListExport({
    query,
    columns: projectListColumns(o.t, o.money),
    keys,
    natural: NATURAL,
    defaultSort: DEFAULT_SORT,
    scope: and(projectVisibility(o.viewer), tabCondition(o)),
    from: projectListFrom(tx),
  });
}

/** Числа вкладок и плашек (прототип `projTabs`, `renderProjects`) — по всем видимым проектам. */
export interface ProjectSummary {
  /** «Активные»: «Планируется» и «В работе». */
  active: number;
  /** «Мои»: активные, где я ответственный. */
  mine: number;
  inProgress: number;
  planned: number;
  /** «Срок прошёл»: «В работе» с окончанием раньше сегодня. */
  overdue: number;
  /** «Осталось получить» по активным проектам с планом; null — денег не видно. */
  left: Tyiyn | null;
  /** Есть ли в организации хоть один проект (подсказка первого входа, прототип ui/empty.js). */
  any: boolean;
}

export async function projectSummary(
  tx: Tx,
  viewer: ProjectViewer,
  today: IsoDate,
  money: boolean,
): Promise<ProjectSummary> {
  const mine = viewer.employeeId
    ? sql`exists (select 1 from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.employee_id = ${viewer.employeeId})`
    : sql`false`;
  const [row] = await tx
    .select({
      active: sql<number>`count(*) filter (where ${ACTIVE})::int`,
      mine: sql<number>`count(*) filter (where ${ACTIVE} and ${mine})::int`,
      inProgress: sql<number>`count(*) filter (where ${projects.status} = 'in_progress')::int`,
      planned: sql<number>`count(*) filter (where ${projects.status} = 'planned')::int`,
      overdue: sql<number>`count(*) filter (where ${overdue(today)})::int`,
      left: sql<number>`coalesce(sum(coalesce(${LEFT}, 0)) filter (where ${ACTIVE}), 0)`,
    })
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .where(projectVisibility(viewer));
  const [any] = await tx.select({ id: projects.id }).from(projects).limit(1);
  return {
    active: row?.active ?? 0,
    mine: row?.mine ?? 0,
    inProgress: row?.inProgress ?? 0,
    planned: row?.planned ?? 0,
    overdue: row?.overdue ?? 0,
    left: money ? Number(row?.left ?? 0) : null,
    any: !!any,
  };
}

/* ───────────── Запись ───────────── */

export interface ProjectContractor {
  id: string;
  name: string;
  archived: boolean;
  responsibleEmployeeId: string | null;
}

const contractorFields = {
  id: contractors.id,
  name: contractors.name,
  archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
  responsibleEmployeeId: contractors.responsibleEmployeeId,
};

type ProjectRecord = typeof projects.$inferSelect;

export interface LockedProject {
  project: ProjectRecord;
  contractor: ProjectContractor;
  /** Ответственные по порядку. */
  members: string[];
}

/**
 * Проект, который видит сотрудник (`where` — `projectVisibility`); `lock` — заблокировать его (правка,
 * статус, работы). Нет такого или не виден — `RecordNotFoundError`.
 */
export async function projectOf(
  tx: Tx,
  id: string,
  where: SQL | undefined,
  lock: boolean,
): Promise<LockedProject> {
  if (!UUID.test(id)) throw new RecordNotFoundError('project', id);
  const q = tx
    .select({ project: projects, contractor: contractorFields })
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .where(and(eq(projects.id, id), where));
  const [row] = lock ? await q.for('no key update', { of: projects }) : await q;
  if (!row) throw new RecordNotFoundError('project', id);
  const members = await tx
    .select({ id: projectMembers.employeeId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, id))
    .orderBy(asc(projectMembers.position));
  return { ...row, members: members.map((m) => m.id) };
}

/**
 * Сотрудники организации: новые ответственные и исполнители — действующие (прототип: выбор из `EMP.filter(x
 * => x.active)`); оставить можно и того, кто уже был у проекта (`keep`), даже если он заблокирован.
 */
async function checkEmployees(
  tx: Tx,
  ids: readonly string[],
  keep: ReadonlySet<string>,
  field: string,
  code: ProjectRefusal,
): Promise<void> {
  const fresh = [...new Set(ids.filter((id) => !keep.has(id)))];
  if (fresh.some((id) => !UUID.test(id))) throw refuse(code, 400, field);
  if (!fresh.length) return;
  const rows = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(inArray(employees.id, fresh), eq(employees.active, true)));
  if (rows.length !== fresh.length) throw refuse(code, 400, field);
}

export interface ProjectInput {
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  description: string;
  plan: Tyiyn | null;
  members: string[];
  lead: string;
  works: (ProjectWorkInput & { id?: string })[];
}

/** Первый отказ правил окна — ошибкой у своего поля. */
function throwProblems(problems: ReturnType<typeof projectProblems>): void {
  const p = problems[0];
  if (p) throw refuse(p.problem, 400, p.field, p.amount);
}

/** Общие проверки окна: правила домена, длины, сотрудники. */
async function checkInput(
  tx: Tx,
  input: ProjectInput,
  before: { members: readonly string[]; executors: readonly string[]; paid: Tyiyn } | null,
  contractorId?: string | null,
) {
  if (
    input.members.length > PROJECT_MEMBERS_MAX ||
    new Set(input.members).size !== input.members.length
  )
    throw refuse('project_members_required', 400, 'members');
  if (input.works.length > PROJECT_WORKS_MAX) throw refuse('project_work_invalid', 400, 'works');
  throwProblems(
    projectProblems(
      {
        name: input.name,
        ...(contractorId !== undefined ? { contractorId } : {}),
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        members: input.members,
        lead: input.lead,
        plan: input.plan,
        works: input.works,
      },
      before?.paid ?? 0,
    ),
  );
  if (input.description.length > PROJECT_DESCRIPTION_MAX)
    throw refuse('project_name_required', 400, 'description');
  await checkEmployees(
    tx,
    input.members,
    new Set(before?.members ?? []),
    'members',
    'project_members_required',
  );
  const works = projectWorksClean(input.works);
  await checkEmployees(
    tx,
    works.map((w) => w.executorEmployeeId),
    new Set(before?.executors ?? []),
    'works',
    'project_work_invalid',
  );
  if (works.some((w) => w.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(w.due)))
    throw refuse('project_work_invalid', 400, 'works');
}

async function writeMembers(tx: Tx, projectId: string, members: readonly string[]) {
  await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  if (members.length)
    await tx
      .insert(projectMembers)
      .values(members.map((employeeId, position) => ({ projectId, employeeId, position })));
}

/**
 * «Создать проект» (прототип `projectDlg` без `p0`): контрагент в области `scope` группы «Проекты
 * контрагентов» и не в архиве; статус — «Планируется» или «В работе». История: «Проект «…» создан»;
 * «История статусов» — первая запись.
 */
export async function createProject(
  tx: Tx,
  input: ProjectInput & { contractorId: string; status: ProjectNewStatus },
  ctx: { scope: SQL | undefined },
): Promise<{ id: string }> {
  if (!UUID.test(input.contractorId))
    throw refuse('project_contractor_required', 400, 'contractor');
  const [c] = await tx
    .select(contractorFields)
    .from(contractors)
    .where(and(eq(contractors.id, input.contractorId), ctx.scope))
    .for('no key update');
  if (!c) throw refuse('project_contractor_required', 400, 'contractor');
  if (c.archived) throw refuse('project_contractor_required', 409, 'contractor');
  await checkInput(tx, input, null, input.contractorId);
  const [row] = await tx
    .insert(projects)
    .values({
      contractorId: c.id,
      name: input.name.trim(),
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      description: input.description.trim(),
      plan: input.plan,
      status: input.status,
      leadEmployeeId: input.lead,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: projects.id });
  const id = row!.id;
  await writeMembers(tx, id, input.members);
  const works = projectWorksClean(input.works);
  if (works.length)
    await tx.insert(projectWorks).values(
      works.map((w, position) => ({
        projectId: id,
        name: w.name,
        executorEmployeeId: w.executorEmployeeId,
        dueDate: w.due,
        position,
        createdBy: sql`app.current_user_id()`,
        updatedBy: sql`app.current_user_id()`,
      })),
    );
  await writeHistory(tx, {
    entity: 'project',
    entityId: id,
    action: 'create',
    changes: [
      { field: 'name', to: input.name.trim() },
      { field: 'status', to: input.status },
    ],
    contractorId: c.id,
  });
  await writeStatusChange(tx, { scale: 'project', entityId: id, from: null, to: input.status });
  return { id };
}

/** Получено по проекту — действующие оплаты (транши) одного проекта. */
export async function projectPaid(tx: Tx, projectId: string): Promise<Tyiyn> {
  const [row] = await tx
    .select({ paid: sql<string>`coalesce(sum(${projectPayments.amount}), 0)` })
    .from(projectPayments)
    .where(and(eq(projectPayments.projectId, projectId), isNull(projectPayments.deletedAt)));
  return Number(row?.paid ?? 0);
}

/**
 * «Сохранить» в окне «Изменить проект» (прототип `projectDlg` с `p0`): поля, ответственные и работы;
 * статус здесь не меняется. Стоимость — не меньше уже полученного. Сделанную работу из проекта не
 * убирают (прототип: у неё вместо корзины — «сделано»). История: «Проект изменён» с полями «было →
 * стало».
 */
export async function updateProject(
  tx: Tx,
  { project, contractor, members }: LockedProject,
  input: ProjectInput & { version: number },
): Promise<{ changed: boolean }> {
  if (project.version !== input.version)
    throw new RecordChangedError('project', project.id, project.version);
  const current = await tx
    .select()
    .from(projectWorks)
    .where(eq(projectWorks.projectId, project.id))
    .orderBy(asc(projectWorks.position), asc(projectWorks.createdAt));
  const paid = await projectPaid(tx, project.id);
  await checkInput(tx, input, {
    members,
    executors: current.map((w) => w.executorEmployeeId),
    paid,
  });
  const byId = new Map(current.map((w) => [w.id, w]));
  const works = input.works
    .filter((w) => w.name.trim() || (w.id && byId.get(w.id)?.done))
    .map((w) => ({ ...w, name: w.name.trim() }));
  if (works.some((w) => w.id && !byId.has(w.id)))
    throw refuse('project_work_invalid', 400, 'works');
  const kept = new Set(works.map((w) => w.id).filter(Boolean));
  // Сделанная работа не убирается: если её нет во входе, она остаётся на месте.
  const removed = current.filter((w) => !kept.has(w.id) && !w.done);
  const name = input.name.trim();
  const description = input.description.trim();
  const changes: NonNullable<HistoryEntry['changes']> = [];
  const diff = (field: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to))
      changes.push({ field, from: from as never, to: to as never });
  };
  diff('name', project.name, name);
  diff('startsOn', project.startsOn, input.startsOn);
  diff('endsOn', project.endsOn, input.endsOn);
  diff('description', project.description, description);
  diff('plan', project.plan == null ? null : Number(project.plan), input.plan);
  diff('lead', project.leadEmployeeId, input.lead);
  diff('members', members, input.members);
  if (removed.length)
    diff(
      'worksRemoved',
      [],
      removed.map((w) => w.name),
    );
  const added = works.filter((w) => !w.id).map((w) => w.name);
  if (added.length) diff('worksAdded', [], added);
  const edited = works.filter((w) => {
    const was = w.id ? byId.get(w.id) : undefined;
    return (
      was &&
      (was.name !== w.name ||
        was.executorEmployeeId !== w.executorEmployeeId ||
        (was.dueDate ?? null) !== (w.due || null))
    );
  });
  if (edited.length)
    diff(
      'worksEdited',
      [],
      edited.map((w) => w.name),
    );
  await tx
    .update(projects)
    .set({
      name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      description,
      plan: input.plan,
      leadEmployeeId: input.lead,
      version: sql`${projects.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(projects.id, project.id));
  if (JSON.stringify(members) !== JSON.stringify(input.members))
    await writeMembers(tx, project.id, input.members);
  if (removed.length)
    await tx.delete(projectWorks).where(
      inArray(
        projectWorks.id,
        removed.map((w) => w.id),
      ),
    );
  let position = 0;
  for (const w of works) {
    const was = w.id ? byId.get(w.id) : undefined;
    if (was) {
      if (
        was.name !== w.name ||
        was.executorEmployeeId !== w.executorEmployeeId ||
        (was.dueDate ?? null) !== (w.due || null) ||
        was.position !== position
      )
        await tx
          .update(projectWorks)
          .set({
            name: w.name,
            executorEmployeeId: w.executorEmployeeId,
            dueDate: w.due || null,
            position,
            updatedAt: sql`now()`,
            updatedBy: sql`app.current_user_id()`,
          })
          .where(eq(projectWorks.id, was.id));
    } else {
      await tx.insert(projectWorks).values({
        projectId: project.id,
        name: w.name,
        executorEmployeeId: w.executorEmployeeId,
        dueDate: w.due || null,
        position,
        createdBy: sql`app.current_user_id()`,
        updatedBy: sql`app.current_user_id()`,
      });
    }
    position++;
  }
  // Сделанные работы, которых нет во входе, — в конец по прежнему порядку.
  for (const w of current.filter((x) => x.done && !kept.has(x.id))) {
    if (w.position !== position)
      await tx.update(projectWorks).set({ position }).where(eq(projectWorks.id, w.id));
    position++;
  }
  await writeHistory(tx, {
    entity: 'project',
    entityId: project.id,
    action: 'update',
    changes,
    contractorId: contractor.id,
  });
  return { changed: changes.length > 0 };
}

/**
 * Смена статуса (прототип `setProjStatus`, `stepTo` для `proj`, «Отменить проект», `rollbackDlg`): шаг
 * вперёд по шкале, «Отменить проект» из «Планируется» и «В работе», откат на один шаг с причиной.
 * Пишет «Историю статусов» (в ленте «История» проекта и контрагента смены статуса нет).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export async function setProjectStatus(
  tx: Tx,
  { project }: LockedProject,
  to: ProjectStatus,
  opts: { rollback?: boolean; reason?: string | null; version?: number },
): Promise<void> {
  if (opts.version !== undefined && opts.version !== project.version)
    throw new RecordChangedError('project', project.id, project.version);
  const from = project.status;
  const ok = opts.rollback
    ? scaleBack('project', from) === to
    : to === 'cancelled'
      ? projectCancelable(from)
      : scaleNext('project', from).includes(to);
  if (!ok) throw refuse('project_status_invalid', 409, 'status');
  // Причина — только у отката (шаг вперёд и «Отменить проект» её не пишут).
  const reason = opts.rollback ? opts.reason?.trim() || null : null;
  if (opts.rollback && !reason) throw refuse('project_status_invalid', 400, 'reason');
  await tx
    .update(projects)
    .set({
      status: to,
      version: sql`${projects.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(projects.id, project.id));
  await writeStatusChange(tx, {
    scale: 'project',
    entityId: project.id,
    from,
    to,
    reason,
    rollback: !!opts.rollback,
  });
}

/* ───────────── Работы ───────────── */

/**
 * «Сделано» у работы в карточке (прототип `openProject`: галочка): отметить или снять. История:
 * «Сделано: …» или «Снова в работе: …».
 */
export async function setProjectWorkDone(
  tx: Tx,
  { project, contractor }: LockedProject,
  workId: string,
  done: boolean,
): Promise<{ changed: boolean }> {
  if (!UUID.test(workId)) throw new RecordNotFoundError('project_work', workId);
  const [w] = await tx
    .select()
    .from(projectWorks)
    .where(and(eq(projectWorks.id, workId), eq(projectWorks.projectId, project.id)))
    .for('update');
  if (!w) throw new RecordNotFoundError('project_work', workId);
  if (w.done === done) return { changed: false };
  await tx
    .update(projectWorks)
    .set({ done, updatedAt: sql`now()`, updatedBy: sql`app.current_user_id()` })
    .where(eq(projectWorks.id, w.id));
  await writeHistory(tx, {
    entity: 'project',
    entityId: project.id,
    action: done ? 'work_done' : 'work_undone',
    changes: [{ field: 'work', to: w.name }],
    contractorId: contractor.id,
  });
  return { changed: true };
}

/**
 * «Добавить работу» в карточке (прототип `openProject`: строка под таблицей): название, исполнитель из
 * ответственных проекта, срок (необязательно). История: «Добавлена работа: … (исполнитель, до …)».
 * Версия проекта повышается (docs/deviations.md п. О-77).
 */
export async function addProjectWork(
  tx: Tx,
  { project, contractor, members }: LockedProject,
  input: ProjectWorkInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name || name.length > 300) throw refuse('project_work_invalid', 400, 'name');
  if (!members.includes(input.executorEmployeeId))
    throw refuse('project_work_invalid', 400, 'executor');
  if (input.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.due))
    throw refuse('project_work_invalid', 400, 'due');
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projectWorks)
    .where(eq(projectWorks.projectId, project.id))) as [{ n: number }];
  if (n >= PROJECT_WORKS_MAX) throw refuse('project_work_invalid', 400, 'name');
  const [row] = await tx
    .insert(projectWorks)
    .values({
      projectId: project.id,
      name,
      executorEmployeeId: input.executorEmployeeId,
      dueDate: input.due,
      position: n,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: projectWorks.id });
  // Версия проекта растёт: окно «Изменить проект» и смена главного с доски шлют весь список работ, и
  // сохранение со старой версией молча убрало бы только что добавленную работу — теперь оно получит
  // «запись изменена другим пользователем».
  await tx
    .update(projects)
    .set({
      version: sql`${projects.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(projects.id, project.id));
  await writeHistory(tx, {
    entity: 'project',
    entityId: project.id,
    action: 'work_add',
    changes: [
      { field: 'work', to: name },
      { field: 'executor', to: input.executorEmployeeId },
      { field: 'due', to: input.due },
    ],
    contractorId: contractor.id,
  });
  return { id: row!.id };
}

/* ───────────── Карточка ───────────── */

export interface ProjectWorkLine {
  id: string;
  name: string;
  executor: { id: string; name: string };
  due: IsoDate | null;
  done: boolean;
}

export interface ProjectTaskLine {
  id: string;
  title: string;
  executorName: string;
  dueDate: IsoDate;
  term: string;
  status: string;
  open: boolean;
}

export interface ProjectHistoryRow {
  id: number;
  at: Date;
  actorName: string | null;
  /** Транш, к которому относится запись (`project_payment`); у самого проекта — null. */
  paymentId: string | null;
  action: string;
  changes: unknown;
  reason: string | null;
}

export interface ProjectCard extends LockedProject {
  leadName: string;
  memberNames: { id: string; name: string }[];
  works: ProjectWorkLine[];
  tasks: ProjectTaskLine[];
  paid: Tyiyn;
  createdName: string | null;
  updatedName: string | null;
  history: ProjectHistoryRow[];
  /** Имена сотрудников из истории (исполнитель работы, ответственные) — по номеру. */
  names: Record<string, string>;
}

const workExec = alias(employees, 'project_work_exec');
const taskExec = alias(employees, 'project_task_exec');
const histActor = alias(employees, 'project_hist_actor');

/** Карточка проекта (прототип `openProject`); не виден — null. */
export async function projectCard(
  tx: Tx,
  id: string,
  where: SQL | undefined,
): Promise<ProjectCard | null> {
  let found: LockedProject;
  try {
    found = await projectOf(tx, id, where, false);
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
  const [names, people, works, taskRows, history] = await Promise.all([
    tx
      .select({ lead: lead.shortName, created: creator.shortName, updated: updater.shortName })
      .from(projects)
      .innerJoin(lead, eq(lead.id, projects.leadEmployeeId))
      .leftJoin(creator, eq(creator.userId, projects.createdBy))
      .leftJoin(updater, eq(updater.userId, projects.updatedBy))
      .where(eq(projects.id, id)),
    tx
      .select({ id: employees.id, name: employees.shortName })
      .from(projectMembers)
      .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
      .where(eq(projectMembers.projectId, id))
      .orderBy(asc(projectMembers.position)),
    tx
      .select({
        id: projectWorks.id,
        name: projectWorks.name,
        executorId: projectWorks.executorEmployeeId,
        executorName: workExec.shortName,
        due: projectWorks.dueDate,
        done: projectWorks.done,
      })
      .from(projectWorks)
      .innerJoin(workExec, eq(workExec.id, projectWorks.executorEmployeeId))
      .where(eq(projectWorks.projectId, id))
      .orderBy(asc(projectWorks.position), asc(projectWorks.createdAt)),
    tx
      .select({
        id: tasks.id,
        title: tasks.title,
        executorName: taskExec.shortName,
        dueDate: tasks.dueDate,
        term: tasks.term,
        status: tasks.status,
      })
      .from(tasks)
      .innerJoin(taskExec, eq(taskExec.id, tasks.executorEmployeeId))
      .where(eq(tasks.projectId, id))
      .orderBy(asc(tasks.dueDate), asc(tasks.createdAt)),
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorName: histActor.shortName,
        actorUserId: auditLog.actorUserId,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        action: auditLog.action,
        changes: auditLog.changes,
        reason: auditLog.reason,
      })
      .from(auditLog)
      .leftJoin(histActor, eq(histActor.userId, auditLog.actorUserId))
      // Записи проекта и его траншей (прототип: `log('p', p.id, …, {sub})` — в истории проекта).
      .where(
        or(
          and(eq(auditLog.entity, 'project'), eq(auditLog.entityId, id)),
          and(
            eq(auditLog.entity, 'project_payment'),
            sql`${auditLog.entityId} in (select pp.id::text from ${projectPayments} pp where pp.project_id = ${id})`,
          ),
        ),
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
  ]);
  // Имена из истории: исполнитель добавленной работы, ответственные и главный «было → стало».
  const ids = new Set<string>();
  for (const h of history)
    for (const c of (h.changes as { field: string; from?: unknown; to?: unknown }[]) ?? []) {
      for (const v of [c.from, c.to].flat()) if (typeof v === 'string' && UUID.test(v)) ids.add(v);
    }
  const known = ids.size
    ? await tx
        .select({ id: employees.id, name: employees.shortName })
        .from(employees)
        .where(inArray(employees.id, [...ids]))
    : [];
  const n = names[0];
  return {
    ...found,
    leadName: n?.lead ?? '',
    memberNames: people,
    works: works.map((w) => ({
      id: w.id,
      name: w.name,
      executor: { id: w.executorId, name: w.executorName },
      due: w.due,
      done: w.done,
    })),
    tasks: taskRows.map((t) => ({
      ...t,
      open: t.status === 'todo' || t.status === 'in_progress' || t.status === 'rework',
    })),
    paid: await projectPaid(tx, id),
    createdName: n?.created ?? null,
    updatedName: n?.updated ?? null,
    history: history.map(({ actorUserId, actorName, entity, entityId, ...h }) => ({
      ...h,
      actorName: auditActorName(actorUserId, actorName),
      paymentId: entity === 'project_payment' ? entityId : null,
    })),
    names: Object.fromEntries(known.map((k) => [k.id, k.name])),
  };
}

/* ───────────── Окно проекта ───────────── */

/**
 * Данные окна (прототип `projectDlg`): контрагенты области «Проекты» не в архиве (прототип
 * `visCps(false, 'projects')`), действующие сотрудники, ответственный выбранного контрагента.
 */
export async function projectFormData(
  tx: Tx,
  scope: SQL | undefined,
  contractorId: string | null,
): Promise<{
  contractors: { id: string; name: string; inn: string; responsible: string | null }[];
  employees: { id: string; name: string }[];
  responsible: string | null;
}> {
  const [cps, people] = await Promise.all([
    tx
      .select({
        id: contractors.id,
        name: contractors.name,
        inn: contractors.inn,
        responsible: contractors.responsibleEmployeeId,
      })
      .from(contractors)
      .where(and(sql`${contractors.serviceStatus} <> 'archived'`, scope))
      .orderBy(asc(contractors.name), asc(contractors.id)),
    tx
      .select({ id: employees.id, name: employees.shortName })
      .from(employees)
      .where(eq(employees.active, true))
      .orderBy(asc(employees.fullName), asc(employees.id)),
  ]);
  const chosen = contractorId ? cps.find((c) => c.id === contractorId) : undefined;
  return {
    contractors: cps,
    employees: people,
    responsible: chosen?.responsible ?? null,
  };
}

/* ───────────── Вкладка «Проекты» карточки контрагента ───────────── */

export interface ContractorProjectLine {
  id: string;
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  status: ProjectStatus;
  leadName: string;
  plan: Tyiyn | null;
  paid: Tyiyn;
}

/**
 * Проекты контрагента (прототип contractor-card.js, вкладка «Проекты»), которые сотрудник видит
 * (`where` — `projectVisibility`): по созданию.
 */
export async function contractorProjects(
  tx: Tx,
  contractorId: string,
  where?: SQL,
): Promise<ContractorProjectLine[]> {
  if (!UUID.test(contractorId)) return [];
  const rows = await tx
    .select({
      id: projects.id,
      name: projects.name,
      startsOn: projects.startsOn,
      endsOn: projects.endsOn,
      status: projects.status,
      leadName: lead.shortName,
      plan: projects.plan,
      paid: PAID,
    })
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .innerJoin(lead, eq(lead.id, projects.leadEmployeeId))
    .where(and(eq(projects.contractorId, contractorId), where))
    .orderBy(asc(projects.createdAt), asc(projects.id));
  return rows.map((r) => ({
    ...r,
    status: r.status as ProjectStatus,
    plan: r.plan == null ? null : Number(r.plan),
    paid: Number(r.paid),
  }));
}

/** Число проектов контрагента (вкладка карточки, запрет удаления контрагента). */
export async function contractorProjectCount(tx: Tx, contractorId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.contractorId, contractorId));
  return row?.n ?? 0;
}

/* ───────────── Задачи по проекту ───────────── */

/**
 * Проект `projectId` стоит у задачи, которую сотрудник видит (`access` — `taskAccessOf`): только тогда
 * он «уже выбранный» в поле «Проект» формы — номер из запроса не открывает названия невидимых проектов.
 */
export async function projectOfSeenTask(
  tx: Tx,
  projectId: string,
  access: SQL | undefined,
): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const [row] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), access))
    .limit(1);
  return !!row;
}

/** Проект, видимый сотруднику (`where` — `projectVisibility`), или уже выбранный у задачи. */
const seenOrCurrent = (where: SQL | undefined, current: string | null): SQL | undefined =>
  where && current && UUID.test(current) ? or(where, eq(projects.id, current)) : where;

/**
 * Проекты для поля «Проект» формы задачи (прототип `taskDlg`, `projsOf`): проекты контрагента, которые
 * сотрудник видит (`where` — `projectVisibility`), кроме «Отменён» и «Завершён»; уже выбранный у задачи
 * остаётся. По названию.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export async function projectsForTask(
  tx: Tx,
  contractorId: string,
  current: string | null,
  where: SQL | undefined,
): Promise<{ id: string; name: string; status: ProjectStatus }[]> {
  if (!UUID.test(contractorId)) return [];
  const rows = await tx
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .where(and(eq(projects.contractorId, contractorId), seenOrCurrent(where, current)))
    .orderBy(asc(projects.name), asc(projects.id));
  return rows
    .map((r) => ({ ...r, status: r.status as ProjectStatus }))
    .filter((p) => projectOfferedForTask(p, current));
}

/**
 * Проект для задачи: проект этого контрагента, который сотрудник видит (`where`) или уже выбранный у
 * задачи, и который можно выбрать (`projectOfferedForTask`); иначе false. Ссылку задачи на проект
 * другого контрагента не даёт и база (`tasks_project_fk`).
 */
export async function taskProjectAllowed(
  tx: Tx,
  projectId: string,
  contractorId: string,
  current: string | null,
  where: SQL | undefined,
): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const [row] = await tx
    .select({ id: projects.id, status: projects.status })
    .from(projects)
    .innerJoin(contractors, eq(contractors.id, projects.contractorId))
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.contractorId, contractorId),
        seenOrCurrent(where, current),
      ),
    );
  return (
    !!row && projectOfferedForTask({ id: row.id, status: row.status as ProjectStatus }, current)
  );
}

/** Включены ли «Проекты контрагентов» в учётной политике текущей организации. */
export async function projectsFeatureOn(tx: Tx): Promise<boolean> {
  const [row] = await tx
    .select({ on: sql<boolean>`(${orgSettings.features} ->> 'projects') = 'true'` })
    .from(orgSettings)
    .where(sql`${orgSettings.orgId} = app.current_org_id()`);
  return row?.on === true;
}

/* ───────────── Файлы ───────────── */

/**
 * Проект — источник файлов (прототип `filesBox(p.files, …, mine)`): виден ли он сотруднику (`where` —
 * `projectVisibility`) и кто его ответственные.
 */
export async function projectFileSource(
  tx: Tx,
  id: string,
  where: SQL | undefined,
): Promise<{ contractor: ProjectContractor; members: string[] } | null> {
  try {
    const p = await projectOf(tx, id, where, false);
    return { contractor: p.contractor, members: p.members };
  } catch (e) {
    if (e instanceof RecordNotFoundError) return null;
    throw e;
  }
}

/**
 * Файлы проектов в Файловом менеджере (прототип `allFiles`: вид «Проект», источник — название проекта,
 * «Перейти к источнику» — карточка проекта): проект, который сотрудник видит (`projectVisibility`);
 * область группы «Файловый менеджер» по контрагенту файла добавляет сам менеджер.
 */
export function projectFilesPart(viewer: ProjectViewer): FileListPart {
  return {
    visible: sql`exists (select 1 from ${projects} join ${contractors} on ${contractors.id} = ${projects.contractorId} where ${projects.id} = ${files.sourceId} and ${projectVisibility(viewer) ?? sql`true`})`,
    source: sql`(select ${projects.name} from ${projects} where ${projects.id} = ${files.sourceId})`,
    ref: sql`(${files.sourceId})::text`,
  };
}
