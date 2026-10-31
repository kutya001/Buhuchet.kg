import {
  auditActorName,
  scaleStatuses,
  type HistoryChange,
  type HistoryValue,
  type IsoDate,
  type ListQuery,
  type ReportAct,
  type ReportStatus,
  type TaskStatus,
  type TaskTerm,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { moveSourceFiles } from './files';
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
  auditLog,
  contractors,
  employees,
  files,
  orgReportTypes,
  orgSettings,
  reports,
  reportTypes,
  statusHistory,
  taskCategories,
  taskComments,
  tasks,
  users,
} from './schema';
import { REPORT_PERIOD_FULL } from './report-list';
import { dateLiteral, dictLiteral, textLiteral } from './sql-text';
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

/*
 * Список задач (задача 2.24; ТЗ «Задачи» → «Регулярные задачи — по отчётам»; прототип `allTasks`):
 * ручные задачи и регулярные задачи по отчётам — одной выборкой `tl`. Регулярная задача не хранится
 * отдельной записью: это сам отчёт месяца (и несданный просроченный за последние 75 дней) — без прежних
 * версий, «Не требуется» и архивных контрагентов (docs/deviations.md п. Б-11). Поэтому повторный
 * запуск ничего не дублирует, смена ответственного сразу переносит задачу, а «Не требуется» и архив её
 * убирают. Название — по метке «Что нужно сделать»; статус и шкала — отчёта; выполнена — когда отчёт
 * «Сдан» и сдача подтверждена (при выключенном подтверждении — когда «Сдан»).
 */

/** Сколько дней назад ещё показывается несданная регулярная задача (прототип `allTasks`: 75). */
export const REGULAR_TASK_OVERDUE_DAYS = 75;

/** Столбец выборки списка `tl`. */
const tl = (name: string) => sql.raw(`"tl"."${name}"`);
const TL = {
  id: tl('id'),
  kind: tl('kind'),
  scale: tl('scale'),
  title: tl('title'),
  categoryCode: tl('category_code'),
  contractorId: tl('contractor_id'),
  executorId: tl('executor_id'),
  authorId: tl('author_id'),
  term: tl('term'),
  dueDate: tl('due_date'),
  needFile: tl('need_file'),
  confirm: tl('confirm'),
  status: tl('status'),
  doneAt: tl('done_at'),
  confirmedById: tl('confirmed_by_id'),
  act: tl('act'),
  amount: tl('amount'),
  paid: tl('paid'),
  repMark: tl('rep_mark'),
  repConfirmedBy: tl('rep_confirmed_by'),
  repSubmittedDay: tl('rep_submitted_day'),
  open: tl('is_open'),
  overdue: tl('is_overdue'),
  hasFile: tl('has_file'),
  createdAt: tl('created_at'),
  createdBy: tl('created_by'),
  updatedAt: tl('updated_at'),
  updatedBy: tl('updated_by'),
  version: tl('version'),
};
const REGULAR = sql`(${TL.kind} = 'regular')`;

/** Что нужно выборке: сегодня по Бишкеку, «Сдача отчётов требует подтверждения», тексты словаря. */
export interface TaskSourceOptions {
  t: ListTexts;
  today: IsoDate;
  reportConfirm: boolean;
}

const OPEN_REPORT = sql`${reports.status} in ('todo', 'in_progress', 'needs_fix')`;

/** Запись текстов `lt` регулярной задачи: период полностью, название по метке. */
function regularTexts(t: ListTexts): SQL {
  const record = {
    m_full: t('report.period.m_full'),
    q_full: t('report.period.q_full'),
    h_full: t('report.period.h_full'),
    y_full: t('report.period.y_full'),
    event_full: t('report.period.event_full'),
    event_default: t('report.event.default'),
    months: Array.from({ length: 12 }, (_, i) => t(`report.month.${i + 1}`)),
    title: t('task.reg.title'),
    verb_sub: t('task.reg.verb.sub'),
    verb_pay: t('task.reg.verb.pay'),
    verb_both: t('task.reg.verb.both'),
  };
  const text = [
    'm_full',
    'q_full',
    'h_full',
    'y_full',
    'event_full',
    'event_default',
    'title',
    'verb_sub',
    'verb_pay',
    'verb_both',
  ].map((f) => `${f} text`);
  return sql`jsonb_to_record(${JSON.stringify(record)}::jsonb) as lt(${sql.raw([...text, 'months text[]'].join(', '))})`;
}

const lt = (name: string) => sql.raw(`"lt"."${name}"`);
const PF = sql.raw(`"rp"."pf"`);
/**
 * Название регулярной задачи (ТЗ «Метка «Что нужно сделать»»; прототип `allTasks`, `REG_VERB`): глагол по
 * метке, краткое название вида (у «Уплата» — полное строчными), период полностью — как в отчёте
 * («Сдать НДС за Сентябрь 2026 — …»), контрагент.
 */
const REGULAR_TITLE = sql`replace(replace(replace(replace(${lt('title')}, '{verb}', case ${reports.act} when 'pay' then ${lt('verb_pay')} when 'both' then ${lt('verb_both')} else ${lt('verb_sub')} end), '{what}', case when ${reports.act} = 'pay' then lower(${reportTypes.name}) else ${reportTypes.shortName} end), '{period}', ${PF}), '{contractor}', ${contractors.name})`;

/**
 * Выборка `tl`: ручные задачи и регулярные задачи по отчётам. Регулярная — отчёт со сроком в текущем
 * месяце или несданный просроченный не старше 75 дней (прототип `allTasks`); открыта, пока отчёт не
 * сдан или сдача ждёт подтверждения; просрочена, пока не сдан после срока (прототип `taskOver`).
 */
function taskListSource(o: TaskSourceOptions): SQL {
  const today = dateLiteral(o.today);
  const month = dateLiteral(monthStartOf(o.today));
  const mark = o.reportConfirm
    ? sql`case when ${reports.status} = 'submitted' and ${reports.act} <> 'pay' then case when ${reports.confirmedAt} is null then 'waiting' else 'confirmed' end end`
    : sql`null::text`;
  const waiting = o.reportConfirm
    ? sql`(${reports.status} = 'submitted' and ${reports.act} <> 'pay' and ${reports.confirmedAt} is null)`
    : sql`false`;
  const manual = sql`select ${tasks.id} as id, 'manual'::text as kind, 'task'::text as scale,
    ${tasks.title} as title, ${tasks.categoryCode} as category_code, ${tasks.contractorId} as contractor_id,
    ${tasks.executorEmployeeId} as executor_id, ${tasks.authorEmployeeId} as author_id, ${tasks.term}::text as term,
    ${tasks.dueDate} as due_date, ${tasks.needFile} as need_file, ${tasks.confirm} as confirm,
    ${tasks.status}::text as status, ${tasks.doneAt} as done_at, ${tasks.confirmedByEmployeeId} as confirmed_by_id,
    null::text as act, null::bigint as amount, null::bigint as paid, null::text as rep_mark,
    null::uuid as rep_confirmed_by, null::date as rep_submitted_day,
    ${OPEN_SQL} as is_open, ${overdueSql(o.today)} as is_overdue, ${HAS_FILE} as has_file,
    ${tasks.createdAt} as created_at, ${tasks.createdBy} as created_by, ${tasks.updatedAt} as updated_at,
    ${tasks.updatedBy} as updated_by, ${tasks.version} as version
    from ${tasks}`;
  const regular = sql`select ${reports.id}, 'regular'::text, 'report'::text, ${REGULAR_TITLE},
    case when ${reports.act} = 'pay' then 'reg:pay' else 'reg:sub' end, ${reports.contractorId},
    ${reports.responsibleEmployeeId}, null::uuid, 'day'::text, ${reports.dueDate},
    coalesce(${orgReportTypes.needFile}, false), false, ${reports.status}::text, null::timestamptz, null::uuid,
    ${reports.act}::text, ${reports.amount}, ${reports.paid}, ${mark}, ${reports.confirmedBy},
    coalesce((${reports.submittedAt} at time zone 'Asia/Bishkek')::date, ${reports.submittedOn}),
    (${OPEN_REPORT} or ${waiting}), (${OPEN_REPORT} and ${reports.dueDate} < ${today}),
    exists (select 1 from ${files} where ${files.sourceKind} = 'report' and ${files.sourceId} = ${reports.id} and ${files.state} = 'ready'),
    ${reports.createdAt}, null::uuid, ${reports.updatedAt}, ${reports.updatedBy}, ${reports.version}
    from ${reports}
    inner join ${contractors} on ${contractors.id} = ${reports.contractorId}
    inner join ${reportTypes} on ${reportTypes.code} = ${reports.reportTypeCode}
    left join ${orgReportTypes} on ${orgReportTypes.orgId} = ${reports.orgId} and ${orgReportTypes.reportTypeCode} = ${reports.reportTypeCode}
    cross join ${regularTexts(o.t)}
    cross join lateral (select ${REPORT_PERIOD_FULL} as pf) rp
    where not ${reports.superseded} and ${reports.status} <> 'not_required'
      and ${contractors.serviceStatus} <> 'archived'
      and ((${reports.dueDate} >= ${month} and ${reports.dueDate} < (${month} + interval '1 month')::date)
        or (${OPEN_REPORT} and ${reports.dueDate} < ${today} and ${reports.dueDate} >= ${today} - ${sql.raw(String(REGULAR_TASK_OVERDUE_DAYS))}))`;
  return sql`(${manual} union all ${regular})`;
}

const repConfirmer = alias(employees, 'task_rep_confirmer');

/** Выборка `tl` с категорией, контрагентом, исполнителем, постановщиком и именами «Создал», «Изменил». */
function fromTaskList(tx: Tx, fields: object, o: TaskSourceOptions) {
  return tx
    .select(fields as Record<string, SQL>)
    .from(sql`${taskListSource(o)} as "tl"`)
    .leftJoin(taskCategories, sql`${taskCategories.code} = ${TL.categoryCode}`)
    .leftJoin(contractors, sql`${contractors.id} = ${TL.contractorId}`)
    .leftJoin(executor, sql`${executor.id} = ${TL.executorId}`)
    .leftJoin(author, sql`${author.id} = ${TL.authorId}`)
    .leftJoin(confirmer, sql`${confirmer.id} = ${TL.confirmedById}`)
    .leftJoin(repConfirmer, sql`${repConfirmer.userId} = ${TL.repConfirmedBy}`)
    .leftJoin(creator, sql`${creator.userId} = ${TL.createdBy}`)
    .leftJoin(updater, sql`${updater.userId} = ${TL.updatedBy}`)
    .$dynamic();
}

const taskListFrom =
  (tx: Tx, o: TaskSourceOptions): ListFrom =>
  (fields) =>
    fromTaskList(tx, fields, o);

/** Последняя смена статуса задачи или отчёта регулярной задачи (шкала в списке — под статусом). */
const listLastStatus = (field: SQL) =>
  sql`(select ${field} from ${statusHistory} where ${statusHistory.scale} = ${TL.scale} and ${statusHistory.entityId} = ${TL.id} order by ${statusHistory.at} desc, ${statusHistory.id} desc limit 1)`;

/** Категория: у регулярной — «Сдача отчёта» или «Оплата» (прототип `allTasks`). */
function categoryName(t: ListTexts): SQL {
  return sql`coalesce(${taskCategories.name}, case ${TL.categoryCode} when 'reg:pay' then ${dictLiteral(t('task.reg.cat.pay'))} else ${dictLiteral(t('task.reg.cat.sub'))} end)`;
}

function listFields(t: ListTexts) {
  const moment = (v: unknown) => (v == null ? null : new Date(v as string));
  return {
    kind: sql<string>`${TL.kind}`,
    id: sql<string>`${TL.id}`,
    title: sql<string>`${TL.title}`,
    categoryCode: sql<string>`${TL.categoryCode}`,
    categoryName: categoryName(t),
    contractorId: sql<string | null>`${TL.contractorId}`,
    contractorName: contractors.name,
    contractorResponsibleId: contractors.responsibleEmployeeId,
    executorId: sql<string | null>`${TL.executorId}`,
    executorName: executor.shortName,
    authorId: sql<string | null>`${TL.authorId}`,
    authorName: author.shortName,
    term: sql<string>`${TL.term}`,
    dueDate: sql<string>`${TL.dueDate}::text`,
    needFile: sql<boolean>`${TL.needFile}`,
    confirm: sql<boolean>`${TL.confirm}`,
    status: sql<string>`${TL.status}`,
    doneAt: sql<Date | null>`${TL.doneAt}`.mapWith(moment),
    hasFile: sql<boolean>`${TL.hasFile}`,
    confirmedById: sql<string | null>`${TL.confirmedById}`,
    confirmedByName: confirmer.shortName,
    open: sql<boolean>`${TL.open}`,
    overdue: sql<boolean>`${TL.overdue}`,
    act: sql<string | null>`${TL.act}`,
    amount: sql<number | null>`${TL.amount}`.mapWith((v) => (v == null ? null : Number(v))),
    paid: sql<number | null>`${TL.paid}`.mapWith((v) => (v == null ? null : Number(v))),
    repMark: sql<string | null>`${TL.repMark}`,
    repConfirmedByName: repConfirmer.shortName,
    repSubmittedDay: sql<string | null>`${TL.repSubmittedDay}::text`,
    statusAt: sql<Date | null>`${listLastStatus(sql`${statusHistory.at}`)}`.mapWith(moment),
    statusUser: sql<string | null>`${listLastStatus(sql`${statusHistory.actorUserId}`)}`,
    statusName: sql<string | null>`${listLastStatus(
      sql`(select e.short_name from ${employees} e where e.user_id = ${statusHistory.actorUserId})`,
    )}`,
    createdAt: sql<Date>`${TL.createdAt}`.mapWith(moment),
    createdBy: sql<string | null>`${TL.createdBy}`,
    createdByName: creator.shortName,
    updatedAt: sql<Date>`${TL.updatedAt}`.mapWith(moment),
    updatedBy: sql<string | null>`${TL.updatedBy}`,
    updatedByName: updater.shortName,
    version: sql<number>`${TL.version}`,
  };
}

type ListRowData = Record<keyof ReturnType<typeof listFields>, unknown>;

/** Отчёт регулярной задачи: статус, метка, сумма — для шкалы, «Подтверждения» и «Отметить сданным». */
export interface RegularTaskReport {
  status: ReportStatus;
  act: ReportAct;
  /** Сумма к уплате и оплачено, тыйыны (null — суммы нет или не указана). */
  amount: number | null;
  paid: number;
  /** Отметка на шаге «Сдан»: ждёт подтверждения или подтверждена (при включённом подтверждении). */
  mark: 'waiting' | 'confirmed' | null;
  /** Кто подтвердил (сотрудник), если он ещё есть в организации. */
  confirmedBy: string | null;
  /** День сдачи по Бишкеку — «Ждёт подтверждения · N дн.». */
  submittedOn: IsoDate | null;
}

/** Регулярная задача по отчёту (прототип `allTasks`): номер — номер отчёта. */
export interface RegularTaskRow {
  kind: 'regular';
  id: string;
  title: string;
  category: { code: string; name: string };
  contractor: { id: string; name: string; responsibleEmployeeId: string | null };
  /** Ответственный за отчёт; null — не назначен. */
  executor: { id: string; shortName: string } | null;
  dueDate: IsoDate;
  needFile: boolean;
  hasFile: boolean;
  open: boolean;
  overdue: boolean;
  report: RegularTaskReport;
  lastStatus: { at: Date; by: string | null } | null;
  audit: AuditRecord;
  version: number;
}

/** Строка списка: ручная задача или регулярная по отчёту. */
export type TaskListRow = (TaskRow & { kind: 'manual'; open: boolean; overdue: boolean }) | RegularTaskRow;

function toListRow(r: ListRowData): TaskListRow {
  const base = toRow(r as unknown as RowData);
  if (r.kind !== 'regular') {
    return { ...base, kind: 'manual', open: Boolean(r.open), overdue: Boolean(r.overdue) };
  }
  const executorId = r.executorId as string | null;
  return {
    kind: 'regular',
    id: base.id,
    title: base.title,
    category: base.category,
    contractor: base.contractor!,
    executor: executorId ? { id: executorId, shortName: (r.executorName as string | null) ?? '' } : null,
    dueDate: base.dueDate,
    needFile: base.needFile,
    hasFile: base.hasFile,
    open: Boolean(r.open),
    overdue: Boolean(r.overdue),
    report: {
      status: r.status as ReportStatus,
      act: r.act as ReportAct,
      amount: r.amount as number | null,
      paid: (r.paid as number | null) ?? 0,
      mark: r.repMark as RegularTaskReport['mark'],
      confirmedBy: (r.repConfirmedByName as string | null) ?? null,
      submittedOn: (r.repSubmittedDay as IsoDate | null) ?? null,
    },
    lastStatus: base.lastStatus,
    audit: base.audit,
    version: base.version,
  };
}

/** Порядок статусов в сортировке: шкала задачи, затем шкала отчёта. */
const STATUS_ORDER = sql.raw(
  `case when "tl"."kind" = 'regular' then 100 + (case "tl"."status" ${scaleStatuses('report')
    .map((s, i) => `when '${s}' then ${i}`)
    .join(' ')} end) else (case "tl"."status" ${scaleStatuses('task')
    .map((s, i) => `when '${s}' then ${i}`)
    .join(' ')} end) end`,
);

const CREATED_BY = auditActorValue(TL.createdBy, creator.shortName);

/** Срок, как на экране: у задачи на месяц — «до 31.10.2026». */
function dueText(t: ListTexts): SQL {
  const date = sql`to_char(${TL.dueDate}, 'DD.MM.YYYY')`;
  return sql`case when ${TL.term} = 'month' then replace(${dictLiteral(t('task.date.month'))}, '{date}', ${date}) else ${date} end`;
}

/**
 * Отметка «Подтверждение» (прототип `taskConfTxt`): у ручной — «Не требуется», «Подтвердил …»,
 * «Требуется»; у регулярной — отметка её отчёта («Ждёт подтверждения», «Подтвердил …», «Подтверждено»).
 */
function confirmText(t: ListTexts): SQL {
  const by = (name: SQL) =>
    sql`replace(${dictLiteral(t('task.confirm.confirmed'))}, '{name}', ${name})`;
  return sql`case when ${REGULAR} then (case ${TL.repMark} when 'waiting' then ${dictLiteral(t('status.report.waiting'))} when 'confirmed' then coalesce(${by(sql`${repConfirmer.shortName}`)}, ${dictLiteral(t('status.report.confirmed'))}) end)
    when not ${TL.confirm} then ${dictLiteral(t('task.confirm.not_required'))}
    when ${TL.status} = 'confirmed' and ${confirmer.shortName} is not null then ${by(sql`${confirmer.shortName}`)}
    else ${dictLiteral(t('task.confirm.required'))} end`;
}

const CONFIRM_VALUE = sql`case when ${REGULAR} then (case ${TL.repMark} when 'waiting' then 'rep:waiting' when 'confirmed' then coalesce('rep:confirmed:' || ${repConfirmer.id}::text, 'rep:confirmed') end)
  when not ${TL.confirm} then 'not_required'
  when ${TL.status} = 'confirmed' and ${TL.confirmedById} is not null then 'confirmed:' || ${TL.confirmedById}::text
  else 'required' end`;

const yesNo = (t: ListTexts, value: SQL) =>
  sql`case when ${value} then ${dictLiteral(t('task.yes'))} else ${dictLiteral(t('task.no'))} end`;

/** Значение столбца «Статус»: у регулярной — статус отчёта с приставкой (шкалы разные). */
const STATUS_VALUE = sql`case when ${REGULAR} then 'rep:' || ${TL.status} else ${TL.status} end`;

/**
 * Столбцы списка задач на сервере (ТЗ «Задачи» → «Общие задачи в списке», «Столбцы, видимые по
 * умолчанию»; прототип `taskCols`): ключи — как у столбцов экрана. «Общие задачи» в фильтре по
 * контрагенту — первым значением, «Вид задачи» — для фильтра, группировки и выгрузки; у регулярной
 * задачи — статус её отчёта, «Поставил» — «Система», «Тип задачи» — «Регулярная». Столбец «Проект»
 * добавит задача 2.26.
 */
export function taskListColumns(t: ListTexts): ListColumns {
  return {
    title: { type: 'text', label: 'task.col.title', value: TL.title },
    cp: {
      type: 'enum',
      label: 'task.col.cp',
      value: sql`coalesce(${TL.contractorId}::text, 'general')`,
      display: sql`coalesce(${contractors.name}, ${dictLiteral(t('task.cp.general_filter'))})`,
      // На экране у общей задачи — «Общая» (по нему ищет поиск), в Excel колонка контрагента пустая
      // (ТЗ «Задачи» → «Общие задачи в списке»).
      searchDisplay: sql`coalesce(${contractors.name}, ${dictLiteral(t('task.cp.general'))})`,
      exportDisplay: contractors.name,
      // «Общие задачи» — первыми (прототип: pin), остальные — по названию по-русски.
      sort: {
        value: sql`(${TL.contractorId} is not null, ${contractors.name} collate app.ru_natural)`,
        text: false,
      },
    },
    cat: {
      type: 'enum',
      label: 'task.col.cat',
      value: TL.categoryCode,
      display: categoryName(t),
      sort: { value: categoryName(t), text: true },
    },
    exec: {
      type: 'enum',
      label: 'task.col.exec',
      value: TL.executorId,
      display: executor.shortName,
      sort: { value: executor.shortName, text: true },
    },
    date: { type: 'date', label: 'task.col.date', value: TL.dueDate, display: dueText(t) },
    status: {
      type: 'enum',
      label: 'task.col.status',
      value: STATUS_VALUE,
      display: sql`case when ${REGULAR} then (case ${TL.status} ${sql.join(
        scaleStatuses('report').map(
          (s) => sql`when ${textLiteral(s)} then ${dictLiteral(t(`status.report.${s}`))}`,
        ),
        sql` `,
      )} end) else (case ${TL.status} ${sql.join(
        scaleStatuses('task').map(
          (s) => sql`when ${textLiteral(s)} then ${dictLiteral(t(`status.task.${s}`))}`,
        ),
        sql` `,
      )} end) end`,
      sort: { value: STATUS_ORDER, text: false },
    },
    needFile: {
      type: 'enum',
      label: 'task.col.need_file',
      value: sql`case when ${TL.needFile} then 'yes' else 'no' end`,
      display: yesNo(t, TL.needFile),
    },
    doneAt: {
      type: 'date',
      label: 'task.col.done_at',
      value: sql`(${TL.doneAt} at time zone 'Asia/Bishkek')::date`,
    },
    file: {
      type: 'enum',
      label: 'task.col.file',
      value: sql`case when not ${TL.needFile} then null when ${TL.hasFile} then 'attached' else 'needed' end`,
      display: sql`case when not ${TL.needFile} then null when ${TL.hasFile} then ${dictLiteral(t('task.file.attached'))} else ${dictLiteral(t('task.file.needed'))} end`,
    },
    by: {
      type: 'enum',
      label: 'task.col.by',
      value: sql`coalesce(${TL.authorId}::text, 'system')`,
      display: sql`coalesce(${author.shortName}, ${dictLiteral(t('task.reg.system'))})`,
      sort: {
        value: sql`coalesce(${author.shortName}, ${dictLiteral(t('task.reg.system'))})`,
        text: true,
      },
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
      value: sql`case when ${TL.contractorId} is null then 'general' else 'contractor' end`,
      display: sql`case when ${TL.contractorId} is null then ${dictLiteral(t('task.scope.general'))} else ${dictLiteral(t('task.scope.contractor'))} end`,
    },
    tkind: {
      type: 'enum',
      label: 'task.col.tkind',
      value: TL.kind,
      display: sql`case when ${REGULAR} then ${dictLiteral(t('task.tkind.regular'))} else ${dictLiteral(t('task.tkind.manual'))} end`,
    },
    term: {
      type: 'enum',
      label: 'task.col.term',
      value: TL.term,
      display: sql`case when ${TL.term} = 'month' then ${dictLiteral(t('task.term.month'))} else ${dictLiteral(t('task.term.day'))} end`,
    },
    open: {
      type: 'enum',
      label: 'task.col.open',
      value: sql`case when ${TL.open} then 'yes' else 'no' end`,
      display: yesNo(t, TL.open),
    },
    createdAt: { type: 'datetime', label: 'grid.col.created_at', value: TL.createdAt },
    updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: TL.updatedAt },
    createdBy: { type: 'enum', label: 'grid.col.created_by', value: CREATED_BY },
    updatedBy: {
      type: 'enum',
      label: 'grid.col.updated_by',
      value: sql`coalesce(${auditActorValue(TL.updatedBy, updater.shortName)}, ${CREATED_BY})`,
    },
  };
}

/** Вкладки модуля (прототип `taskTabs`). */
export const TASK_TABS = ['mine', 'byme', 'all', 'overdue'] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export interface TaskListOptions extends TaskSourceOptions {
  viewer: TaskViewer;
  tab: TaskTab;
}

/** Первый день месяца даты. */
const monthStartOf = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

/**
 * Какие строки выборки видит сотрудник (прототип `taskScope`): с правом «Видеть задачи всех» — все;
 * иначе свои (исполнитель — и регулярные по своим отчётам — или постановщик) и — с правом
 * «Подтверждать задачи» — все ручные, ждущие подтверждения.
 */
function listVisibility(v: TaskViewer): SQL | undefined {
  if (v.all) return undefined;
  return or(
    sql`${TL.executorId} = ${v.employeeId}`,
    sql`${TL.authorId} = ${v.employeeId}`,
    v.canConfirm ? sql`(${TL.status} = 'on_confirm' and not ${REGULAR})` : undefined,
  );
}

/** Фильтр «Статус» выбирает «На подтверждении» (плашка): тогда вкладка и месяц не сужают список. */
function pendingFilter(query: Pick<ListQuery, 'filters'>): boolean {
  const f = query.filters.status;
  return !!f && f.type === 'enum' && f.vals.includes('on_confirm');
}

/**
 * Условие списка (прототип `renderTasks` → rows): видимость; вкладка — «Мои» (исполнитель), «Поставленные
 * мной» (только ручные), «Все», «Просроченные» (все просроченные); остальные вкладки — с текущего
 * месяца, вперёд и всё просроченное. Плашка «На подтверждении» (фильтр статуса) показывает все видимые
 * ждущие задачи.
 */
function listScope(query: Pick<ListQuery, 'filters'>, o: TaskListOptions): SQL | undefined {
  const visible = listVisibility(o.viewer);
  if (o.tab === 'overdue') return and(visible, sql`${TL.overdue}`);
  if (pendingFilter(query)) return visible;
  const tab =
    o.tab === 'mine'
      ? sql`${TL.executorId} = ${o.viewer.employeeId}`
      : o.tab === 'byme'
        ? sql`${TL.authorId} = ${o.viewer.employeeId}`
        : undefined;
  const fromMonth = sql`(${TL.dueDate} >= ${dateLiteral(monthStartOf(o.today))} or ${TL.overdue})`;
  // «Поставленные мной» — все поставленные, даже вне видимости (прототип: TASKS.filter(by === me)).
  return o.tab === 'byme' ? and(tab, fromMonth) : and(visible, tab, fromMonth);
}

const TASK_NATURAL = [TL.createdAt, TL.id];

/** Страница списка задач: сортировка, страница, фильтры, поиск и группы — на сервере. */
export async function listTasksPage(
  tx: Tx,
  query: ListQuery,
  o: TaskListOptions,
): Promise<ListPageResult<TaskListRow>> {
  const fields = listFields(o.t);
  const page = await selectListPage({
    query,
    columns: taskListColumns(o.t),
    natural: TASK_NATURAL,
    scope: listScope(query, o),
    select: ({ window, where, orderBy, limit, offset }) =>
      fromTaskList(tx, { ...fields, ...window } as typeof fields & ListWindowFields, o)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset) as unknown as Promise<
        (ListRowData & {
          listTotal: number;
          listTotals: Record<string, number> | null;
          listGroups: string[] | null;
        })[]
      >,
    from: taskListFrom(tx, o),
  });
  return { ...page, rows: page.rows.map((r) => toListRow(r as ListRowData)) };
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
    from: taskListFrom(tx, o),
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
    from: taskListFrom(tx, o),
  });
}

/** Отчёты месяца — сдано из всех (прототип `renderTasks`: «Отчёты мои/всех за месяц: сдано N из M»). */
export interface RegularMonthProgress {
  done: number;
  total: number;
}

/**
 * Счётчики вкладок (прототип `taskTabs`): «Мои» — мои открытые (и регулярные), «Поставленные мной» —
 * поставленные мной открытые, «Просроченные» — просроченные среди видимых; строка «Отчёты за месяц:
 * сдано N из M» — регулярные задачи со сроком в текущем месяце: мои и все видимые.
 */
export async function taskTabCounts(
  tx: Tx,
  viewer: TaskViewer,
  o: TaskSourceOptions,
): Promise<{
  mine: number;
  byme: number;
  overdue: number;
  progress: { mine: RegularMonthProgress; all: RegularMonthProgress };
}> {
  const visible = listVisibility(viewer) ?? sql`true`;
  const mine = sql`${TL.executorId} = ${viewer.employeeId}`;
  const month = sql`(${REGULAR} and ${TL.dueDate} >= ${dateLiteral(monthStartOf(o.today))})`;
  const done = sql`${TL.status} = 'submitted'`;
  const [row] = await fromTaskList(
    tx,
    {
      mine: sql<number>`count(*) filter (where ${mine} and ${TL.open})::int`,
      byme: sql<number>`count(*) filter (where ${TL.authorId} = ${viewer.employeeId} and ${TL.open})::int`,
      overdue: sql<number>`count(*) filter (where ${TL.overdue} and ${visible})::int`,
      mineTotal: sql<number>`count(*) filter (where ${month} and ${mine})::int`,
      mineDone: sql<number>`count(*) filter (where ${month} and ${mine} and ${done})::int`,
      allTotal: sql<number>`count(*) filter (where ${month} and ${visible})::int`,
      allDone: sql<number>`count(*) filter (where ${month} and ${visible} and ${done})::int`,
    },
    o,
  ).where(or(sql`${visible}`, sql`${TL.authorId} = ${viewer.employeeId}`, mine));
  const n = (v: unknown) => Number(v ?? 0);
  return {
    mine: n(row?.mine),
    byme: n(row?.byme),
    overdue: n(row?.overdue),
    progress: {
      mine: { done: n(row?.mineDone), total: n(row?.mineTotal) },
      all: { done: n(row?.allDone), total: n(row?.allTotal) },
    },
  };
}

/**
 * В организации ещё нет ни одной задачи — ни ручной, ни регулярной (прототип ui/empty.js, `firstEmpty`:
 * `!allTasks().length`): список показывает «Регулярные задачи создадутся сами по отчётам; ручную
 * задачу можно поставить сейчас».
 */
export async function tasksOrgEmpty(tx: Tx, o: TaskSourceOptions): Promise<boolean> {
  const [row] = await fromTaskList(tx, { id: TL.id }, o).limit(1);
  return !row;
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
  // Файлы задачи — за её контрагентом (область «Свои» в Файловом менеджере).
  if (fields.contractorId !== contractorBefore) {
    await moveSourceFiles(tx, 'task', id, fields.contractorId);
  }
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
 * Вкладка «Задачи» карточки контрагента (ТЗ: «Задач: N · открытых M», последние 40; прототип
 * modules/contractor-card.js): все задачи контрагента — и регулярные по его отчётам, сначала с поздним
 * сроком; открытая регулярная — пока отчёт не сдан (прототип: `OPEN.has(t.status)`).
 */
export async function contractorTasks(
  tx: Tx,
  contractorId: string,
  o: TaskSourceOptions,
): Promise<{ total: number; open: number; items: TaskListRow[] }> {
  const where = sql`${TL.contractorId} = ${contractorId}`;
  const [counts] = await fromTaskList(
    tx,
    {
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where case when ${REGULAR} then ${TL.status} in ('todo', 'in_progress', 'needs_fix') else ${TL.open} end)::int`,
    },
    o,
  ).where(where);
  const rows = await fromTaskList(tx, listFields(o.t), o)
    .where(where)
    .orderBy(desc(TL.dueDate), desc(TL.createdAt), desc(TL.id))
    .limit(CONTRACTOR_TASKS_SHOWN);
  return {
    total: Number(counts?.total ?? 0),
    open: Number(counts?.open ?? 0),
    items: rows.map((r) => toListRow(r as ListRowData)),
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

/**
 * Контрагент для формы задачи: виден ли в области `scope` (`contractorScope`), в архиве ли и кто
 * ответственный (исполнитель по умолчанию); null — нет такого или он вне области.
 */
export async function taskContractorOf(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{ id: string; archived: boolean; responsibleEmployeeId: string | null } | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await tx
    .select({
      id: contractors.id,
      status: contractors.serviceStatus,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
    })
    .from(contractors)
    .where(and(eq(contractors.id, id), scope));
  return row
    ? {
        id: row.id,
        archived: row.status === 'archived',
        responsibleEmployeeId: row.responsibleEmployeeId,
      }
    : null;
}

/**
 * Учётная политика для задач: включён ли модуль «Задачи», «Файлы в карточках», значение «Требуется
 * подтверждение» для новых задач («Задачи требуют подтверждения») и «Сдача отчётов требует
 * подтверждения» (когда закрывается регулярная задача). Записи нет — всё выключено. Без
 * `orgId` — организация из контекста.
 */
export async function taskOrgSettings(
  tx: Tx,
  orgId?: string,
): Promise<{ tasks: boolean; files: boolean; confirmDefault: boolean; reportConfirm: boolean }> {
  const [row] = await tx
    .select({
      features: orgSettings.features,
      taskConfirm: orgSettings.taskConfirm,
      reportConfirm: orgSettings.reportConfirm,
    })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId ?? sql`app.current_org_id()`));
  const features = (row?.features ?? {}) as Record<string, boolean>;
  return {
    tasks: features.tasks === true,
    files: features.files === true,
    confirmDefault: row?.taskConfirm ?? true,
    reportConfirm: row?.reportConfirm ?? false,
  };
}

/** Сколько контрагентов предлагает поле «Контрагент» формы задачи (как «Все записи» списка). */
export const TASK_FORM_CONTRACTORS_MAX = 5000;

/**
 * Значения для формы задачи (прототип `taskDlg`): действующие исполнители организации и контрагенты в
 * области (`scope`) без архивных (прототип `visCps`) с ответственным — исполнителем по умолчанию.
 */
export async function taskFormOptions(
  tx: Tx,
  scope: SQL | undefined,
): Promise<{
  executors: { id: string; shortName: string }[];
  contractors: { id: string; name: string; responsibleEmployeeId: string | null }[];
}> {
  const [executors, cps] = await Promise.all([
    tx
      .select({ id: employees.id, shortName: employees.shortName })
      .from(employees)
      .where(eq(employees.active, true))
      .orderBy(sql`${employees.shortName} collate app.ru_natural`, employees.id),
    tx
      .select({
        id: contractors.id,
        name: contractors.name,
        responsibleEmployeeId: contractors.responsibleEmployeeId,
      })
      .from(contractors)
      .where(and(sql`${contractors.serviceStatus} <> 'archived'`, scope))
      .orderBy(sql`${contractors.name} collate app.ru_natural`, contractors.id)
      .limit(TASK_FORM_CONTRACTORS_MAX),
  ]);
  return { executors, contractors: cps };
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
        and(eq(tasks.contractorId, m.contractorId), eq(tasks.executorEmployeeId, m.from), OPEN_SQL),
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

/** Запись истории задачи: номера сотрудников, контрагента и код категории — названиями. */
export interface TaskHistoryItem {
  at: Date;
  actor: string | null;
  action: string;
  changes: HistoryChange[];
}

/** Поля-ссылки задачи: в истории — номер или код, на экране — название. */
const REF_FIELDS = ['executorEmployeeId', 'contractorId', 'categoryCode'] as const;

/** История задачи («Создана», «было → стало», файлы), сначала новые. */
export async function taskHistory(tx: Tx, taskId: string): Promise<TaskHistoryItem[]> {
  const actor = alias(employees, 'history_actor');
  const rows = await tx
    .select({
      at: auditLog.at,
      actorUserId: auditLog.actorUserId,
      actorName: actor.shortName,
      action: auditLog.action,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.userId, auditLog.actorUserId))
    .where(and(eq(auditLog.entity, 'task'), eq(auditLog.entityId, taskId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id));
  const ids = {
    executorEmployeeId: new Set<string>(),
    contractorId: new Set<string>(),
    categoryCode: new Set<string>(),
  };
  for (const r of rows)
    for (const c of (r.changes ?? []) as HistoryChange[])
      if ((REF_FIELDS as readonly string[]).includes(c.field))
        for (const v of [c.from, c.to])
          if (typeof v === 'string') ids[c.field as (typeof REF_FIELDS)[number]].add(v);
  const [people, cps, cats] = await Promise.all([
    ids.executorEmployeeId.size
      ? tx
          .select({ id: employees.id, name: employees.shortName })
          .from(employees)
          .where(inArray(employees.id, [...ids.executorEmployeeId]))
      : [],
    ids.contractorId.size
      ? tx
          .select({ id: contractors.id, name: contractors.name })
          .from(contractors)
          .where(inArray(contractors.id, [...ids.contractorId]))
      : [],
    ids.categoryCode.size
      ? tx
          .select({ id: taskCategories.code, name: taskCategories.name })
          .from(taskCategories)
          .where(inArray(taskCategories.code, [...ids.categoryCode]))
      : [],
  ]);
  const names: Record<(typeof REF_FIELDS)[number], Map<string, string>> = {
    executorEmployeeId: new Map(people.map((x) => [x.id, x.name])),
    contractorId: new Map(cps.map((x) => [x.id, x.name])),
    categoryCode: new Map(cats.map((x) => [x.id, x.name])),
  };
  const named = (field: string, v: HistoryValue | undefined): HistoryValue | undefined => {
    if (typeof v !== 'string' || !(REF_FIELDS as readonly string[]).includes(field)) return v;
    // Удалённый контрагент и т. п. — без названия, но и без номера.
    return names[field as (typeof REF_FIELDS)[number]].get(v) ?? '—';
  };
  return rows.map((r) => ({
    at: r.at,
    actor: auditActorName(r.actorUserId, r.actorName),
    action: r.action,
    changes: ((r.changes ?? []) as HistoryChange[]).map((c) => ({
      field: c.field,
      ...(c.from !== undefined ? { from: named(c.field, c.from) } : {}),
      ...(c.to !== undefined ? { to: named(c.field, c.to) } : {}),
    })),
  }));
}
