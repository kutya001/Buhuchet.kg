import {
  auditActorName,
  isPermissionId,
  normalizeScopes,
  PERMISSION_IDS,
  rolePermissionCount,
  SCOPE_GROUPS,
  type ListQuery,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client';
import { writeHistory } from './history';
import {
  auditActorValue,
  selectListExport,
  selectListPage,
  selectListValues,
  type ListColumns,
  type ListFrom,
  type ListPageResult,
  type ListWindowFields,
} from './list';
import { employees, orgSettings, permissions, rolePermissions, roleScopes, roles } from './schema';
import { rolePermissionIds, roleScopeMap, type AuditRecord } from './staff';

/**
 * Вкладка «Роли» модуля «Сотрудники»: роли организации из контекста `withOrgContext` (RLS), их права
 * и область групп «Свои / Все контрагенты».
 */

export interface RoleSummary {
  id: string;
  name: string;
  isOwner: boolean;
  /** Код шаблона платформы, из которого роль создана; null — роль создала организация. */
  templateCode: string | null;
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

/** Активных сотрудников с ролью (прототип: столбец «Сотрудников»). */
const ROLE_EMPLOYEES = sql<number>`(select count(*)::int from ${employees} where ${employees.roleId} = ${roles.id} and ${employees.active})`;
/** Прав в роли; у роли владельца — все (`rolePermissionCount`; число — без параметра запроса). */
const ROLE_PERMISSIONS = sql<number>`case when ${roles.isOwner} then ${sql.raw(String(PERMISSION_IDS.length))} else (select count(*)::int from ${rolePermissions} where ${rolePermissions.roleId} = ${roles.id}) end`;

const roleFields = {
  id: roles.id,
  name: roles.name,
  isOwner: roles.isOwner,
  templateCode: roles.templateCode,
  employees: ROLE_EMPLOYEES,
  permissionCount: ROLE_PERMISSIONS,
  createdAt: roles.createdAt,
  createdBy: roles.createdBy,
  createdByName: creator.shortName,
  updatedAt: roles.updatedAt,
  updatedBy: roles.updatedBy,
  updatedByName: updater.shortName,
  version: roles.version,
};

function selectRoles(tx: Tx) {
  return tx
    .select(roleFields)
    .from(roles)
    .leftJoin(creator, eq(creator.userId, roles.createdBy))
    .leftJoin(updater, eq(updater.userId, roles.updatedBy));
}

/** То же для страницы списка — с числом записей, итогами и группами (`selectListPage`). */
function selectRolePage(tx: Tx, window: ListWindowFields) {
  return tx
    .select({ ...roleFields, ...window })
    .from(roles)
    .leftJoin(creator, eq(creator.userId, roles.createdBy))
    .leftJoin(updater, eq(updater.userId, roles.updatedBy));
}

/** Те же таблицы с любыми полями — для групп, значений фильтра и выгрузки (`ListFrom`). */
function roleListFrom(tx: Tx): ListFrom {
  return (fields) =>
    tx
      .select(fields)
      .from(roles)
      .leftJoin(creator, eq(creator.userId, roles.createdBy))
      .leftJoin(updater, eq(updater.userId, roles.updatedBy))
      .$dynamic();
}

type RoleRow = Awaited<ReturnType<typeof selectRoles>>[number];

function toSummary(r: RoleRow): RoleSummary {
  return {
    id: r.id,
    name: r.name,
    isOwner: r.isOwner,
    templateCode: r.templateCode,
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

const ROLE_CREATED_BY = auditActorValue(roles.createdBy, creator.shortName);

/**
 * Столбцы списка ролей на сервере (прототип modules/staff.js, renderStaff, вкладка «Роли»: роль,
 * сотрудников, прав, изменено, изменил): ключи — как у столбцов экрана. «Изменил» у роли без правок —
 * тот, кто создал; у ролей из шаблонов при создании организации автора нет — пусто.
 */
export const ROLE_LIST_COLUMNS: ListColumns = {
  name: { type: 'text', label: 'roles.col.name', value: roles.name },
  employees: { type: 'int', label: 'roles.col.employees', value: ROLE_EMPLOYEES },
  permissionCount: { type: 'int', label: 'roles.col.permissions', value: ROLE_PERMISSIONS },
  updatedAt: { type: 'datetime', label: 'grid.col.updated_at', value: roles.updatedAt },
  updatedBy: {
    type: 'enum',
    label: 'grid.col.updated_by',
    value: sql`coalesce(${auditActorValue(roles.updatedBy, updater.shortName)}, ${ROLE_CREATED_BY})`,
  },
};

const ROLE_NATURAL = [roles.createdAt, roles.id];
/** Роли по умолчанию — по названию (прототип: `sort: {key: 'name', dir: 1}`). */
export const ROLE_DEFAULT_SORT = { key: 'name', dir: 'asc' } as const;

/**
 * Страница списка ролей: сортировка, страница, фильтры, поиск и группы — на сервере, как у всех
 * списков (ТЗ «Списки записей»). Неизвестный столбец — `ListQueryError`.
 */
export async function listRolesPage(
  tx: Tx,
  query: ListQuery,
): Promise<ListPageResult<RoleSummary>> {
  const page = await selectListPage({
    query,
    columns: ROLE_LIST_COLUMNS,
    natural: ROLE_NATURAL,
    defaultSort: ROLE_DEFAULT_SORT,
    // У ролей нет области «Свои»: список — вся организация (её отсекает RLS).
    scope: undefined,
    select: ({ window, where, orderBy, limit, offset }) =>
      selectRolePage(tx, window)
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
    from: roleListFrom(tx),
  });
  return { ...page, rows: page.rows.map(toSummary) };
}

/** Значения столбца списка ролей для фильтра-галочек; `q` — «Найти значение» по всем значениям. */
export function listRoleValues(tx: Tx, key: string, q?: string) {
  return selectListValues({
    columns: ROLE_LIST_COLUMNS,
    key,
    scope: undefined,
    from: roleListFrom(tx),
    q,
  });
}

/** Роли для выгрузки в Excel: все под поиском и фильтрами, столбцы `keys` по порядку экрана. */
export function exportRoles(tx: Tx, query: ListQuery, keys: readonly string[]) {
  return selectListExport({
    query,
    columns: ROLE_LIST_COLUMNS,
    keys,
    natural: ROLE_NATURAL,
    defaultSort: ROLE_DEFAULT_SORT,
    scope: undefined,
    from: roleListFrom(tx),
  });
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
