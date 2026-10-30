import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { orgIsolation, platformReadOnly } from './rls';
import { users } from './users';

/**
 * Каталог прав — справочник платформы «Права ролей»: названия и описания из refDB.json. Набор прав
 * и их группы задаёт система (`PERMISSIONS` в @buhuchet/domain), наполнение сверяет каталог с ним.
 * Название и описание меняет администратор платформы (`app.admin_set_permission`); «Изменил» не даёт
 * наполнению затереть его правку.
 */
export const permissions = pgTable(
  'permissions',
  {
    id: text('id').primaryKey(),
    permGroup: text('perm_group').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Кто поправил тексты в Админке; null — тексты из наполнения. */
    updatedBy: uuid('updated_by').references(() => users.id),
    version: recordVersion(),
  },
  () => [platformReadOnly('permissions_read')],
).enableRLS();

/**
 * Шаблоны ролей платформы («Главный бухгалтер», «Бухгалтер»): новая организация получает копии.
 * Название, права и область меняет администратор платформы (`app.admin_set_role_template`).
 */
export const roleTemplates = pgTable(
  'role_templates',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    permissions: text('permissions').array().notNull(),
    /** Группа → own | all. */
    scopes: jsonb('scopes').$type<Record<string, string>>().notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Кто поправил шаблон в Админке; null — шаблон из наполнения. */
    updatedBy: uuid('updated_by').references(() => users.id),
    version: recordVersion(),
  },
  () => [platformReadOnly('role_templates_read')],
).enableRLS();

/** Роли организации. Роль владельца одна, у неё все права (признак is_owner, права не перечисляются). */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    isOwner: boolean('is_owner').notNull().default(false),
    /** Код шаблона платформы, из которого роль создана; пусто — роль создала организация. */
    templateCode: text('template_code'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('roles_org_name_unique').on(t.orgId, t.name),
    unique('roles_id_org_unique').on(t.id, t.orgId),
    uniqueIndex('roles_one_owner_idx')
      .on(t.orgId)
      .where(sql`${t.isOwner}`),
    orgIsolation('roles_isolation', t.orgId),
  ],
).enableRLS();

/** Права роли. Ссылка на пару (role_id, org_id) не даёт привязать право к роли чужой организации. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [t.roleId, t.orgId],
      foreignColumns: [roles.id, roles.orgId],
    }).onDelete('cascade'),
    orgIsolation('role_permissions_isolation', t.orgId),
  ],
).enableRLS();

/** Область роли по группам с данными контрагентов: own — свои контрагенты, all — все. */
export const roleScopes = pgTable(
  'role_scopes',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    permGroup: text('perm_group').notNull(),
    scope: text('scope', { enum: ['own', 'all'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permGroup] }),
    foreignKey({
      name: 'role_scopes_role_fk',
      columns: [t.roleId, t.orgId],
      foreignColumns: [roles.id, roles.orgId],
    }).onDelete('cascade'),
    check(
      'role_scopes_group_check',
      sql`${t.permGroup} in ('cps', 'reports', 'fin', 'projects', 'kpi', 'files')`,
    ),
    check('role_scopes_scope_check', sql`${t.scope} in ('own', 'all')`),
    orgIsolation('role_scopes_isolation', t.orgId),
  ],
).enableRLS();
