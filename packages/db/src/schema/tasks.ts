import { TASK_STATUSES, TASK_TERMS } from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { taskCategories } from './platform-dicts';
import { appRole, orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/** Значение столбца — одно из постоянных кодов (без кавычек в самих кодах). */
const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' });

/** Ссылка на сотрудника своей организации. */
const employeeRef = (name: string, column: AnyPgColumn, orgId: AnyPgColumn) =>
  foreignKey({ name, columns: [column, orgId], foreignColumns: [employees.id, employees.orgId] });

/**
 * Ручные задачи (задача 2.23; ТЗ «Задачи» → «Ручные задачи», «Выполнение», «Подтверждение
 * выполнения»; прототип modules/tasks.js). Регулярных задач по отчётам здесь нет: это сами отчёты
 * (задача 2.24). Общая задача — без контрагента; задача по контрагенту удаляется вместе с ним (прототип
 * удаляет контрагента «вместе с задачами и файлами карточки»). Задачи не удаляются — их отменяют
 * (у роли приложения нет DELETE, миграция с ограничениями). Кто что может с задачей — правила
 * `@buhuchet/domain` (tasks/rules.ts) в API; смена статуса пишется в «Историю статусов» (шкала `task`).
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    categoryCode: text('category_code')
      .notNull()
      .references(() => taskCategories.code),
    /** Пусто — общая задача. */
    contractorId: uuid('contractor_id'),
    executorEmployeeId: uuid('executor_employee_id').notNull(),
    /** Постановщик. */
    authorEmployeeId: uuid('author_employee_id').notNull(),
    /** «На день» или «На месяц» (срок — последний день месяца). */
    term: text('term', { enum: TASK_TERMS }).notNull().default('day'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    /** «Требуется файл при выполнении». */
    needFile: boolean('need_file').notNull().default(false),
    /** «Требуется подтверждение». */
    confirm: boolean('confirm').notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    /** Когда исполнитель отметил «Выполнена»; откат из «Выполнена» и «На подтверждении» снимает. */
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** Причина «Не выполнена». */
    failReason: text('fail_reason').notNull().default(''),
    /** Причина последнего «На доработку» и кто вернул. */
    reworkReason: text('rework_reason').notNull().default(''),
    reworkByEmployeeId: uuid('rework_by_employee_id'),
    /** Кто и когда подтвердил, комментарий подтверждения. */
    confirmedByEmployeeId: uuid('confirmed_by_employee_id'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmNote: text('confirm_note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('tasks_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'tasks_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    employeeRef('tasks_executor_fk', t.executorEmployeeId, t.orgId),
    employeeRef('tasks_author_fk', t.authorEmployeeId, t.orgId),
    employeeRef('tasks_rework_by_fk', t.reworkByEmployeeId, t.orgId),
    employeeRef('tasks_confirmed_by_fk', t.confirmedByEmployeeId, t.orgId),
    index('tasks_executor_idx').on(t.orgId, t.executorEmployeeId, t.status),
    index('tasks_author_idx').on(t.orgId, t.authorEmployeeId, t.status),
    index('tasks_contractor_idx').on(t.orgId, t.contractorId, t.createdAt),
    index('tasks_due_idx').on(t.orgId, t.dueDate),
    index('tasks_pending_idx')
      .on(t.orgId)
      .where(sql`${t.status} = 'on_confirm'`),
    check('tasks_title_check', sql`char_length(btrim(${t.title})) > 0`),
    check('tasks_term_check', oneOf(t.term, TASK_TERMS)),
    check('tasks_status_check', oneOf(t.status, TASK_STATUSES)),
    // «На месяц» — срок всегда последний день месяца (ТЗ «Срок задачи»).
    check(
      'tasks_month_due_check',
      sql`${t.term} <> 'month' or ${t.dueDate} = (date_trunc('month', ${t.dueDate}) + interval '1 month - 1 day')::date`,
    ),
    // «На подтверждении», «Подтверждена» и «На доработке» бывают только у задачи с подтверждением.
    check(
      'tasks_confirm_status_check',
      sql`${t.confirm} or ${t.status} not in ('on_confirm', 'confirmed', 'rework')`,
    ),
    check(
      'tasks_confirmed_check',
      sql`${t.status} <> 'confirmed' or (${t.confirmedByEmployeeId} is not null and ${t.confirmedAt} is not null)`,
    ),
    orgIsolation('tasks_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Комментарии задачи (прототип `openTask`: «Комментарии · N»): пишет любой, кто видит задачу; автор —
 * пользователь из контекста, комментарий не меняется и не удаляется (кроме как вместе с задачей).
 */
export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    taskId: uuid('task_id').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => users.id),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'task_comments_task_fk',
      columns: [t.taskId, t.orgId],
      foreignColumns: [tasks.id, tasks.orgId],
    }).onDelete('cascade'),
    index('task_comments_task_idx').on(t.orgId, t.taskId, t.createdAt),
    check('task_comments_text_check', sql`char_length(btrim(${t.text})) > 0`),
    orgIsolation('task_comments_isolation', t.orgId),
    // Комментарий пишется только от своего имени и с настоящим временем.
    pgPolicy('task_comments_insert_own', {
      as: 'restrictive',
      for: 'insert',
      to: appRole,
      withCheck: sql`${t.authorUserId} = app.current_user_id() and ${t.createdAt} = now()`,
    }),
  ],
).enableRLS();
