import { boolean, foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { recordVersion, timestamps } from './columns';
import { organizations } from './organizations';
import { orgIsolation } from './rls';
import { roles } from './roles';
import { users } from './users';

/**
 * Сотрудники организации: членство пользователя с ФИО, телефоном и ролью. Владелец тоже сотрудник —
 * с ролью владельца. Ссылки на пары (user_id, org_id) и (role_id, org_id) не дают связать сотрудника
 * с учётной записью или ролью другой организации.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Учётная запись для входа; один пользователь — одна организация. */
    userId: uuid('user_id').notNull().unique(),
    fullName: text('full_name').notNull(),
    /** Как показывать в списках: «Алишер Т.». */
    shortName: text('short_name').notNull(),
    /** В формате +996…; пусто — не указан. */
    phone: text('phone'),
    roleId: uuid('role_id').notNull(),
    /** Нет — сотрудник заблокирован владельцем: не входит, его контрагентов передают другому. */
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...timestamps(),
    version: recordVersion(),
  },
  (t) => [
    unique('employees_id_org_unique').on(t.id, t.orgId),
    foreignKey({
      name: 'employees_user_fk',
      columns: [t.userId, t.orgId],
      foreignColumns: [users.id, users.orgId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'employees_role_fk',
      columns: [t.roleId, t.orgId],
      foreignColumns: [roles.id, roles.orgId],
    }).onDelete('restrict'),
    index('employees_org_idx').on(t.orgId),
    index('employees_role_idx').on(t.roleId),
    orgIsolation('employees_isolation', t.orgId),
  ],
).enableRLS();
