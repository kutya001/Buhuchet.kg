import {
  MONEY_AMOUNT_MAX,
  MONEY_NOTE_MAX,
  OP_REASON_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  PROJECT_STATUSES,
  PROJECT_WORK_NAME_MAX,
} from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { money, recordVersion, timestamps } from './columns';
import { contractors } from './contractors';
import { organizations } from './organizations';
import { appRole, currentOrgId, orgIsolation } from './rls';
import { employees } from './staff';
import { users } from './users';

/*
 * «Проекты контрагентов» (задача 2.26; ТЗ «Модуль Проекты контрагентов»; прототип modules/projects.js,
 * `PROJECTS` в demoDB.json). Проект — разовая работа по одному контрагенту: срок, ответственные (один из
 * них главный), работы, планируемая стоимость и статус по шкале `project` («История статусов» —
 * `status_history`). Проект не удаляется (в прототипе удаления нет — только «Отменить проект»), поэтому
 * контрагента с проектами можно только отправить в архив. Задачи по проекту — `tasks.project_id`.
 */

const orgColumn = () =>
  uuid('org_id')
    .notNull()
    .default(currentOrgId)
    .references(() => organizations.id, { onDelete: 'restrict' });

const codes = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    contractorId: uuid('contractor_id').notNull(),
    name: text('name').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    description: text('description').notNull().default(''),
    /** Планируемая стоимость, тыйыны; пусто — не задана («стоимость договорная»). */
    plan: money('plan'),
    status: text('status', { enum: PROJECT_STATUSES }).notNull().default('planned'),
    /** Главный ответственный — один из ответственных (`project_members`, проверяет API). */
    leadEmployeeId: uuid('lead_employee_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('projects_id_org_unique').on(t.id, t.orgId),
    // Ссылка задачи на проект своего контрагента (`tasks_project_fk`).
    unique('projects_id_contractor_org_unique').on(t.id, t.contractorId, t.orgId),
    foreignKey({
      name: 'projects_contractor_fk',
      columns: [t.contractorId, t.orgId],
      foreignColumns: [contractors.id, contractors.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'projects_lead_fk',
      columns: [t.leadEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('restrict'),
    index('projects_contractor_idx').on(t.orgId, t.contractorId),
    index('projects_ends_idx').on(t.orgId, t.endsOn),
    check('projects_status_check', sql`${t.status} in (${codes(PROJECT_STATUSES)})`),
    check('projects_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      'projects_plan_check',
      sql`${t.plan} is null or (${t.plan} >= 0 and ${t.plan} <= ${sql.raw(String(MONEY_AMOUNT_MAX))})`,
    ),
    check(
      'projects_text_check',
      sql`char_length(btrim(${t.name})) > 0 and char_length(${t.name}) <= ${sql.raw(String(PROJECT_NAME_MAX))} and char_length(${t.description}) <= ${sql.raw(String(PROJECT_DESCRIPTION_MAX))}`,
    ),
    orgIsolation('projects_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Ответственные проекта (прототип `p.resps`): сотрудники своей организации; порядок — как выбраны.
 * Меняются в «Изменить проект» — строки удаляются и добавляются (изменений строк нет).
 */
export const projectMembers = pgTable(
  'project_members',
  {
    orgId: orgColumn(),
    projectId: uuid('project_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'project_members_pk', columns: [t.projectId, t.employeeId] }),
    foreignKey({
      name: 'project_members_project_fk',
      columns: [t.projectId, t.orgId],
      foreignColumns: [projects.id, projects.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_members_employee_fk',
      columns: [t.employeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('restrict'),
    index('project_members_employee_idx').on(t.orgId, t.employeeId),
    orgIsolation('project_members_isolation', t.orgId),
  ],
).enableRLS();

/**
 * Работы по проекту (прототип `p.works`: название, исполнитель, срок, «сделано»). Порядок — `position`.
 * Сделанную работу из проекта не убирают (прототип `projectDlg`: у сделанной вместо корзины — «сделано»).
 */
export const projectWorks = pgTable(
  'project_works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    executorEmployeeId: uuid('executor_employee_id').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'project_works_project_fk',
      columns: [t.projectId, t.orgId],
      foreignColumns: [projects.id, projects.orgId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_works_executor_fk',
      columns: [t.executorEmployeeId, t.orgId],
      foreignColumns: [employees.id, employees.orgId],
    }).onDelete('restrict'),
    index('project_works_project_idx').on(t.projectId, t.position),
    check(
      'project_works_name_check',
      sql`char_length(btrim(${t.name})) > 0 and char_length(${t.name}) <= ${sql.raw(String(PROJECT_WORK_NAME_MAX))}`,
    ),
    orgIsolation('project_works_isolation', t.orgId),
    // Удалить можно только несделанную работу (прототип: у сделанной корзины нет).
    pgPolicy('project_works_delete_open', {
      as: 'restrictive',
      for: 'delete',
      to: appRole,
      using: sql`not ${t.done}`,
    }),
  ],
).enableRLS();

/**
 * Оплата по проекту — транш (ТЗ «Оплата по проекту траншами»; прототип `p.pays`, `projPay` → `tranchDlg`,
 * modules/fin-op.js с `src: 'pt'`): сумма, дата, комментарий. При заданной планируемой стоимости сумма
 * действующих траншей не больше неё (проверяет сервер под блокировкой проекта). Не стирается: «Удалить» —
 * отметка с причиной (решение заказчика 24.10.2026); удалённый транш не входит в «получено».
 */
export const projectPayments = pgTable(
  'project_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: orgColumn(),
    projectId: uuid('project_id').notNull(),
    amount: money('amount').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    note: text('note').notNull().default(''),
    /** Изменены сумма, дата или комментарий (прототип `edited`): отметка «изменён». */
    edited: boolean('edited').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id),
    deleteReason: text('delete_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('project_payments_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'project_payments_project_fk',
      columns: [t.projectId, t.orgId],
      foreignColumns: [projects.id, projects.orgId],
    }).onDelete('restrict'),
    index('project_payments_project_idx').on(t.projectId, t.paidOn),
    check(
      'project_payments_amount_check',
      sql`${t.amount} > 0 and ${t.amount} <= ${sql.raw(String(MONEY_AMOUNT_MAX))}`,
    ),
    check(
      'project_payments_note_check',
      sql`char_length(${t.note}) <= ${sql.raw(String(MONEY_NOTE_MAX))}`,
    ),
    check(
      'project_payments_delete_check',
      sql`(${t.deletedAt} is null) = (${t.deletedBy} is null) and (${t.deletedAt} is null) = (${t.deleteReason} is null) and char_length(coalesce(${t.deleteReason}, '')) <= ${sql.raw(String(OP_REASON_MAX))}`,
    ),
    orgIsolation('project_payments_isolation', t.orgId),
  ],
).enableRLS();
