import {
  auditActorName,
  isPermissionId,
  normalizeScopes,
  PERMISSION_IDS,
  rolePermissionCount,
  SCOPE_GROUPS,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { writeHistory } from './history';
import { employees, orgSettings, permissions, rolePermissions, roleScopes, roles } from './schema';
import { rolePermissionIds, type AuditRecord } from './staff';

/**
 * Вкладка «Роли» модуля «Сотрудники»: роли организации из контекста `withOrgContext` (RLS), их права
 * и область групп «Свои / Все контрагенты».
 */

export interface RoleSummary {
  id: string;
  name: string;
  isOwner: boolean;
  /** Активных сотрудников с ролью (прототип: столбец «Сотрудников»). */
  employees: number;
  permissionCount: number;
  audit: AuditRecord;
  version: number;
}

export interface RoleRecord extends RoleSummary {
  /** У роли владельца — все права. */
  permissions: PermissionId[];
  /** Область каждой группы; у роли владельца — «Все» везде. */
  scopes: Record<ScopeGroupId, Scope>;
}

const creator = alias(employees, 'creator');
const updater = alias(employees, 'updater');

function selectRoles(tx: Tx) {
  return tx
    .select({
      id: roles.id,
      name: roles.name,
      isOwner: roles.isOwner,
      employees: sql<number>`(select count(*)::int from ${employees} where ${employees.roleId} = ${roles.id} and ${employees.active})`,
      permissionCount: sql<number>`(select count(*)::int from ${rolePermissions} where ${rolePermissions.roleId} = ${roles.id})`,
      createdAt: roles.createdAt,
      createdBy: roles.createdBy,
      createdByName: creator.shortName,
      updatedAt: roles.updatedAt,
      updatedBy: roles.updatedBy,
      updatedByName: updater.shortName,
      version: roles.version,
    })
    .from(roles)
    .leftJoin(creator, eq(creator.userId, roles.createdBy))
    .leftJoin(updater, eq(updater.userId, roles.updatedBy));
}

type RoleRow = Awaited<ReturnType<typeof selectRoles>>[number];

function toSummary(r: RoleRow): RoleSummary {
  return {
    id: r.id,
    name: r.name,
    isOwner: r.isOwner,
    employees: Number(r.employees),
    permissionCount: r.isOwner
      ? rolePermissionCount({ isOwner: true, permissions: [] })
      : Number(r.permissionCount),
    audit: {
      createdAt: r.createdAt,
      createdBy: auditActorName(r.createdBy, r.createdByName),
      updatedAt: r.updatedAt,
      updatedBy: auditActorName(r.updatedBy, r.updatedByName),
    },
    version: r.version,
  };
}

/** Роли организации по названию (прототип: список ролей отсортирован по названию). */
export async function listRoles(tx: Tx): Promise<RoleSummary[]> {
  const rows = await selectRoles(tx).orderBy(asc(roles.name), asc(roles.id));
  return rows.map(toSummary);
}

/** Область групп роли, как сохранена; недостающие группы — «Свои». */
export async function roleScopeMap(tx: Tx, roleId: string): Promise<Record<ScopeGroupId, Scope>> {
  const rows = await tx
    .select({ group: roleScopes.permGroup, scope: roleScopes.scope })
    .from(roleScopes)
    .where(eq(roleScopes.roleId, roleId));
  return normalizeScopes(Object.fromEntries(rows.map((r) => [r.group, r.scope])));
}

/** Карточка роли; null — нет такой роли в организации. */
export async function getRole(tx: Tx, id: string): Promise<RoleRecord | null> {
  const [row] = await selectRoles(tx).where(eq(roles.id, id));
  if (!row) return null;
  const summary = toSummary(row);
  if (row.isOwner) {
    return {
      ...summary,
      permissions: [...PERMISSION_IDS],
      scopes: normalizeScopes(Object.fromEntries(SCOPE_GROUPS.map((g) => [g, 'all']))),
    };
  }
  return {
    ...summary,
    permissions: await rolePermissionIds(tx, id),
    scopes: await roleScopeMap(tx, id),
  };
}

/** Заблокировать роль до конца транзакции: версия и признак владельца для проверок перед правкой. */
export async function lockRole(
  tx: Tx,
  id: string,
): Promise<{ id: string; name: string; isOwner: boolean; version: number } | null> {
  const [row] = await tx
    .select({ id: roles.id, name: roles.name, isOwner: roles.isOwner, version: roles.version })
    .from(roles)
    .where(eq(roles.id, id))
    .for('update');
  return row ?? null;
}

/**
 * Новая роль организации из контекста: права и область «Свои» во всех группах, запись в историю.
 * Занятое название — ошибка уникальности `roles_org_name_unique` (`uniqueViolation`).
 */
export async function createRole(
  tx: Tx,
  input: { name: string; permissions: readonly PermissionId[]; copiedFrom: string | null },
): Promise<string> {
  const [role] = await tx
    .insert(roles)
    .values({
      orgId: sql`app.current_org_id()`,
      name: input.name,
      createdBy: sql`app.current_user_id()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .returning({ id: roles.id, orgId: roles.orgId });
  const roleId = role!.id;
  const orgId = role!.orgId;
  if (input.permissions.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(input.permissions.map((permissionId) => ({ orgId, roleId, permissionId })));
  }
  await tx
    .insert(roleScopes)
    .values(SCOPE_GROUPS.map((g) => ({ orgId, roleId, permGroup: g, scope: 'own' as const })));
  await writeHistory(tx, {
    entity: 'role',
    entityId: roleId,
    action: 'create',
    changes: [
      { field: 'name', to: input.name },
      { field: 'permissions', to: [...input.permissions] },
      ...(input.copiedFrom ? [{ field: 'copiedFromRoleId', to: input.copiedFrom }] : []),
    ],
  });
  return roleId;
}

/** Права роли: добавить недостающие, убрать лишние. Историю пишет `updateWithHistory` роли. */
export async function replaceRolePermissions(
  tx: Tx,
  roleId: string,
  before: readonly PermissionId[],
  after: readonly PermissionId[],
): Promise<void> {
  const removed = before.filter((p) => !after.includes(p));
  const added = after.filter((p) => !before.includes(p));
  if (removed.length > 0) {
    await tx
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, roleId), inArray(rolePermissions.permissionId, removed)),
      );
  }
  if (added.length > 0) {
    await tx.insert(rolePermissions).values(
      added.map((permissionId) => ({
        orgId: sql`app.current_org_id()`,
        roleId,
        permissionId,
      })),
    );
  }
}

/** Область групп роли: только переданные группы. Историю пишет `updateWithHistory` роли. */
export async function setRoleScopes(
  tx: Tx,
  roleId: string,
  scopes: Partial<Record<ScopeGroupId, Scope>>,
): Promise<void> {
  const rows = Object.entries(scopes).map(([group, scope]) => ({
    orgId: sql`app.current_org_id()`,
    roleId,
    permGroup: group,
    scope: scope as Scope,
  }));
  if (rows.length === 0) return;
  await tx
    .insert(roleScopes)
    .values(rows)
    .onConflictDoUpdate({
      target: [roleScopes.roleId, roleScopes.permGroup],
      set: { scope: sql`excluded.scope` },
    });
}

/** Почему роль нельзя удалить: назначена сотрудникам (и заблокированным) или новым сотрудникам по умолчанию. */
export async function roleInUse(tx: Tx, roleId: string): Promise<'employees' | 'default' | null> {
  const [assigned] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.roleId, roleId))
    .limit(1);
  if (assigned) return 'employees';
  const [byDefault] = await tx
    .select({ orgId: orgSettings.orgId })
    .from(orgSettings)
    .where(eq(orgSettings.defaultRoleId, roleId));
  return byDefault ? 'default' : null;
}

/**
 * Удалить роль (права и область удаляются вместе с ней) и записать в историю. Если в ту же минуту
 * роль кому-то назначили, внешний ключ не даст удалить (`foreignKeyViolation`).
 */
export async function deleteRole(tx: Tx, role: { id: string; name: string }): Promise<void> {
  await tx.delete(roles).where(eq(roles.id, role.id));
  await writeHistory(tx, {
    entity: 'role',
    entityId: role.id,
    action: 'delete',
    changes: [{ field: 'name', from: role.name }],
  });
}

/**
 * Справочник платформы «Права ролей»: названия и описания в порядке формы роли. Группа права —
 * из `PERMISSIONS` (@buhuchet/domain): набор прав и их группы задаёт система.
 */
export async function permissionCatalog(
  db: Db | Tx,
): Promise<{ id: PermissionId; name: string; description: string }[]> {
  const rows = await db
    .select({ id: permissions.id, name: permissions.name, description: permissions.description })
    .from(permissions)
    .orderBy(asc(permissions.sortOrder), asc(permissions.id));
  return rows.flatMap((r) => (isPermissionId(r.id) ? [{ ...r, id: r.id }] : []));
}
