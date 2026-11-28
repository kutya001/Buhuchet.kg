import {
  SERIES_END_KINDS,
  SERIES_MONTH_MODES,
  SERIES_STATES,
  SERIES_STOP_REASONS,
  SERIES_UNITS,
  TASK_STATUSES,
  TASK_TERMS,
} from '@buhuchet/domain';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
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
import { projects } from './projects';
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
 * Серии повторяющихся задач (доработки 28.11.2026: повторяющиеся задачи; прототип v168
 * modules/task-series.js, `TSER`): правило и поля задачи, по которым ночной запуск «Задачи: повторы»
 * сам ставит следующую задачу. Правило без базы — `@buhuchet/domain` (tasks/series.ts). Серия не
 * удаляется — её останавливают; вместе с контрагентом её удаляет каскад. Ставит серию сотрудник от
 * своего имени; ночной запуск без пользователя меняет только состояние, причину, следующую дату и счёт
 * (миграция 0179, триггер `task_series_job_guard`).
 */
export const taskSeries = pgTable(
  'task_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    categoryCode: text('category_code')
      .notNull()
      .references(() => taskCategories.code),
    contractorId: uuid('contractor_id'),
    projectId: uuid('project_id'),
    executorEmployeeId: uuid('executor_employee_id').notNull(),
    /** Постановщик: он же постановщик каждой задачи серии. */
    authorEmployeeId: uuid('author_employee_id').notNull(),
    term: text('term', { enum: TASK_TERMS }).notNull().default('day'),
    needFile: boolean('need_file').notNull().default(false),
    confirm: boolean('confirm').notNull(),
    /** «Повторять с интервалом»: 1–99 единиц. */
    every: smallint('every').notNull().default(1),
    unit: text('unit', { enum: SERIES_UNITS }).notNull(),
    /** Дни недели у «недели»: 0 — понедельник … 6 — воскресенье (как в прототипе). */
    weekDays: smallint('week_days').array(),
    /** «Когда» у «месяца»: N-го числа, в N-й день недели, в последний. */
    monthMode: text('month_mode', { enum: SERIES_MONTH_MODES }),
    /** Начало — срок первой задачи. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endKind: text('end_kind', { enum: SERIES_END_KINDS }).notNull().default('never'),
    endDate: date('end_date', { mode: 'string' }),
    endCount: smallint('end_count'),
    state: text('state', { enum: SERIES_STATES }).notNull().default('active'),
    /** Почему остановлена: без человека (исполнитель, контрагент, архив, проект) или вручную. */
    stopReason: text('stop_reason', { enum: SERIES_STOP_REASONS }),
    /** Дата следующей задачи, которую серия ещё поставит; пусто — не поставит. */
    nextDate: date('next_date', { mode: 'string' }),
    /** Сколько задач серия поставила (для «После N повторов»). */
    made: integer('made').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('task_series_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'task_series_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'task_series_project_fk',
      columns: [t.projectId, t.contractorId, t.orgId],
      foreignColumns: [projects.id, projects.contractorId, projects.orgId],
    }),
    employeeRef('task_series_executor_fk', t.executorEmployeeId, t.orgId),
    employeeRef('task_series_author_fk', t.authorEmployeeId, t.orgId),
    index('task_series_author_idx').on(t.orgId, t.authorEmployeeId, t.state),
    index('task_series_contractor_idx').on(t.orgId, t.contractorId),
    // Ночной запуск берёт только действующие серии.
    index('task_series_active_idx')
      .on(t.orgId, t.nextDate)
      .where(sql`${t.state} = 'active'`),
    check('task_series_title_check', sql`char_length(btrim(${t.title})) > 0`),
    check(
      'task_series_project_check',
      sql`${t.projectId} is null or ${t.contractorId} is not null`,
    ),
    check('task_series_term_check', oneOf(t.term, TASK_TERMS)),
    check('task_series_every_check', sql`${t.every} between 1 and 99`),
    check('task_series_unit_check', oneOf(t.unit, SERIES_UNITS)),
    // У «На месяц» — только месяцы и годы, начало — последний день месяца.
    check(
      'task_series_month_term_check',
      sql`${t.term} <> 'month' or (${t.unit} in ('month', 'year') and ${t.monthMode} is null and ${t.startDate} = (date_trunc('month', ${t.startDate}) + interval '1 month - 1 day')::date)`,
    ),
    check(
      'task_series_week_days_check',
      sql`case when ${t.unit} = 'week' then cardinality(${t.weekDays}) between 1 and 7 and ${t.weekDays} <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] else ${t.weekDays} is null end`,
    ),
    check(
      'task_series_month_mode_check',
      sql`case when ${t.unit} = 'month' and ${t.term} <> 'month' then ${t.monthMode} is not null and ${oneOf(t.monthMode, SERIES_MONTH_MODES)} else ${t.monthMode} is null end`,
    ),
    check('task_series_end_kind_check', oneOf(t.endKind, SERIES_END_KINDS)),
    check(
      'task_series_end_check',
      sql`case ${t.endKind} when 'date' then ${t.endDate} >= ${t.startDate} and ${t.endCount} is null when 'count' then ${t.endCount} between 1 and 999 and ${t.endDate} is null else ${t.endDate} is null and ${t.endCount} is null end`,
    ),
    check('task_series_state_check', oneOf(t.state, SERIES_STATES)),
    check(
      'task_series_stop_check',
      sql`case when ${t.state} = 'stopped' then ${oneOf(t.stopReason, SERIES_STOP_REASONS)} else ${t.stopReason} is null end`,
    ),
    check('task_series_made_check', sql`${t.made} >= 0`),
    orgIsolation('task_series_isolation', t.orgId),
  ],
).enableRLS();

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
    /** Проект контрагента задачи (задача 2.26); пусто — задача без проекта. */
    projectId: uuid('project_id'),
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
    /** Серия повтора и дата по её правилу (доработки 28.11.2026); пусто — задача без повтора. */
    seriesId: uuid('series_id'),
    seriesDate: date('series_date', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('tasks_id_org_unique').on(t.id, t.orgId),
    // Одна дата серии — одна задача: повторный и одновременный ночной запуск вторую не поставят.
    unique('tasks_series_date_unique').on(t.orgId, t.seriesId, t.seriesDate),
    foreignKey({
      name: 'tasks_series_fk',
      columns: [t.seriesId, t.orgId],
      foreignColumns: [taskSeries.id, taskSeries.orgId],
    }),
    check('tasks_series_check', sql`(${t.seriesId} is null) = (${t.seriesDate} is null)`),
    foreignKey({
      name: 'tasks_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('cascade'),
    // Проект — того же контрагента, что и задача (у общей задачи проекта нет — `tasks_project_check`).
    foreignKey({
      name: 'tasks_project_fk',
      columns: [t.projectId, t.contractorId, t.orgId],
      foreignColumns: [projects.id, projects.contractorId, projects.orgId],
    }),
    employeeRef('tasks_executor_fk', t.executorEmployeeId, t.orgId),
    employeeRef('tasks_author_fk', t.authorEmployeeId, t.orgId),
    employeeRef('tasks_rework_by_fk', t.reworkByEmployeeId, t.orgId),
    employeeRef('tasks_confirmed_by_fk', t.confirmedByEmployeeId, t.orgId),
    index('tasks_executor_idx').on(t.orgId, t.executorEmployeeId, t.status),
    index('tasks_author_idx').on(t.orgId, t.authorEmployeeId, t.status),
    index('tasks_contractor_idx').on(t.orgId, t.contractorId, t.createdAt),
    index('tasks_due_idx').on(t.orgId, t.dueDate),
    index('tasks_project_idx')
      .on(t.orgId, t.projectId)
      .where(sql`${t.projectId} is not null`),
    index('tasks_pending_idx')
      .on(t.orgId)
      .where(sql`${t.status} = 'on_confirm'`),
    check('tasks_title_check', sql`char_length(btrim(${t.title})) > 0`),
    check('tasks_project_check', sql`${t.projectId} is null or ${t.contractorId} is not null`),
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
