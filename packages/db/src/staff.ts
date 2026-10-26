import {
  auditActorName,
  isPermissionId,
  PERMISSION_IDS,
  type PermissionId,
} from '@buhuchet/domain';
import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { writeHistory } from './history';
import {
  employees,
  platformReference,
  rolePermissions,
  roles,
  sessions,
  telegramLinks,
  users,
} from './schema';

/**
 * Модуль «Сотрудники»: сотрудники организации из контекста `withOrgContext` (RLS) вместе с учётной
 * записью, ролью и привязкой Telegram. Хеш пароля отсюда не читается.
 */

/** «Создал» и «Изменил»: момент и имя (null — система). */
export interface AuditRecord {
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface EmployeeRecord {
  id: string;
  userId: string;
  fullName: string;
  shortName: string;
  login: string;
  phone: string | null;
  role: { id: string; name: string; isOwner: boolean };
  active: boolean;
  telegram: { username: string | null; firstName: string | null; linkedAt: Date } | null;
  lastLoginAt: Date | null;
  audit: AuditRecord;
  version: number;
}

const creator = alias(employees, 'creator');
const updater = alias(employees, 'updater');

function selectEmployees(tx: Tx) {
  return tx
    .select({
      id: employees.id,
      userId: employees.userId,
      fullName: employees.fullName,
      shortName: employees.shortName,
      login: users.login,
      phone: employees.phone,
      roleId: roles.id,
      roleName: roles.name,
      roleIsOwner: roles.isOwner,
      active: employees.active,
      tgUsername: telegramLinks.username,
      tgFirstName: telegramLinks.firstName,
      tgLinkedAt: telegramLinks.linkedAt,
      lastLoginAt: users.lastLoginAt,
      createdAt: employees.createdAt,
      createdBy: employees.createdBy,
      createdByName: creator.shortName,
      updatedAt: employees.updatedAt,
      updatedBy: employees.updatedBy,
      updatedByName: updater.shortName,
      version: employees.version,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .leftJoin(telegramLinks, eq(telegramLinks.userId, employees.userId))
    .leftJoin(creator, eq(creator.userId, employees.createdBy))
    .leftJoin(updater, eq(updater.userId, employees.updatedBy));
}

type EmployeeRow = Awaited<ReturnType<typeof selectEmployees>>[number];

function toEmployee(r: EmployeeRow): EmployeeRecord {
  return {
    id: r.id,
    userId: r.userId,
    fullName: r.fullName,
    shortName: r.shortName,
    login: r.login,
    phone: r.phone,
    role: { id: r.roleId, name: r.roleName, isOwner: r.roleIsOwner },
    active: r.active,
    telegram: r.tgLinkedAt
      ? { username: r.tgUsername, firstName: r.tgFirstName, linkedAt: r.tgLinkedAt }
      : null,
    lastLoginAt: r.lastLoginAt,
    audit: {
      createdAt: r.createdAt,
      createdBy: auditActorName(r.createdBy, r.createdByName),
      updatedAt: r.updatedAt,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName),
    },
    version: r.version,
  };
}

/** Сотрудники организации по ФИО (прототип: список отсортирован по ФИО). */
export async function listEmployees(tx: Tx): Promise<EmployeeRecord[]> {
  const rows = await selectEmployees(tx).orderBy(asc(employees.fullName), asc(employees.id));
  return rows.map(toEmployee);
}

/** Карточка сотрудника; null — нет такого в организации. */
export async function getEmployee(tx: Tx, id: string): Promise<EmployeeRecord | null> {
  const [row] = await selectEmployees(tx).where(eq(employees.id, id));
  return row ? toEmployee(row) : null;
}

/** Заблокировать запись сотрудника до конца транзакции, перед проверкой правил и правкой. */
export async function lockEmployee(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.id, id))
    .for('update');
  return rows.length > 0;
}

/** Роль организации и её права (у роли владельца права не перечисляются). */
export interface RoleAccess {
  id: string;
  name: string;
  isOwner: boolean;
  permissions: PermissionId[];
}

/** Роль с правами; null — нет такой роли в организации. */
export async function roleAccess(tx: Tx, roleId: string): Promise<RoleAccess | null> {
  const [role] = await tx
    .select({ id: roles.id, name: roles.name, isOwner: roles.isOwner })
    .from(roles)
    .where(eq(roles.id, roleId));
  if (!role) return null;
  return { ...role, permissions: await rolePermissionIds(tx, roleId) };
}

/** Права роли в порядке каталога. */
export async function rolePermissionIds(tx: Tx, roleId: string): Promise<PermissionId[]> {
  const rows = await tx
    .select({ id: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  const ids = new Set(rows.map((r) => r.id).filter(isPermissionId));
  return PERMISSION_IDS.filter((p) => ids.has(p));
}

export interface NewEmployee {
  fullName: string;
  shortName: string;
  /** Уже после normalizeLogin. */
  login: string;
  /** Хеш временного пароля: при первом входе его нужно сменить. */
  passwordHash: string;
  phone: string | null;
  role: { id: string; name: string };
}

/**
 * Новый сотрудник организации из контекста: учётная запись с временным паролем и сотрудник с ролью,
 * обе записи — в историю. Занятый на платформе логин — ошибка уникальности `users_login_unique`
 * (`uniqueViolation`), транзакция откатывается.
 */
export async function createEmployee(tx: Tx, input: NewEmployee): Promise<string> {
  const [user] = await tx
    .insert(users)
    .values({
      orgId: sql`app.current_org_id()`,
      login: input.login,
      passwordHash: input.passwordHash,
      mustChangePassword: true,
    })
    .returning({ id: users.id });
  const [employee] = await tx
    .insert(employees)
    .values({
      orgId: sql`app.current_org_id()`,
      userId: user!.id,
      fullName: input.fullName,
      shortName: input.shortName,
      phone: input.phone,
      roleId: input.role.id,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: employees.id });
  await writeHistory(
    tx,
    {
      entity: 'user',
      entityId: user!.id,
      action: 'create',
      changes: [{ field: 'login', to: input.login }],
    },
    {
      entity: 'employee',
      entityId: employee!.id,
      action: 'create',
      changes: [
        { field: 'fullName', to: input.fullName },
        { field: 'phone', to: input.phone },
        { field: 'roleId', to: input.role.id },
        { field: 'roleName', to: input.role.name },
      ],
    },
  );
  return employee!.id;
}

/** Заблокированный сотрудник: все его сеансы закрываются сразу. */
export async function endUserSessions(tx: Tx, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** Справочник платформы «Коды телефонов» (refDB → phoneCodes): код страны и маска номера. */
export async function phoneCodes(db: Db | Tx): Promise<{ code: string; mask: string }[]> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, 'phoneCodes'));
  const payload = row?.payload;
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((p: unknown) => {
    const c = p as { code?: unknown; mask?: unknown };
    return typeof c.code === 'string' && typeof c.mask === 'string' && /^\d+$/.test(c.code)
      ? [{ code: c.code, mask: c.mask }]
      : [];
  });
}
