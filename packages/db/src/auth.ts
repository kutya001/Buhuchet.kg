import {
  isPermissionId,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  SCOPE_GROUPS,
  SESSION_TOUCH_MINUTES,
  SESSION_TTL_DAYS,
  type AccessSubject,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { employees, organizations, rolePermissions, roleScopes, roles } from './schema';

/**
 * Вход и сеансы до выбора организации — через функции app.auth_* (миграция 0009): роль приложения
 * сама не видит пользователей и сеансы чужих организаций, а при входе организация ещё не известна.
 */

/** Учётная запись по логину (для проверки пароля при входе). */
export interface LoginRecord {
  userId: string;
  orgId: string | null;
  login: string;
  passwordHash: string;
  isPlatformAdmin: boolean;
  userBlocked: boolean;
  mustChangePassword: boolean;
  /** Вход закрыт после неверных паролей до этого момента. */
  lockedUntil: Date | null;
  locked: boolean;
  employeeId: string | null;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
  orgName: string | null;
}

interface LoginRow extends Record<string, unknown> {
  user_id: string;
  org_id: string | null;
  login: string;
  password_hash: string;
  is_platform_admin: boolean;
  user_blocked: boolean;
  must_change_password: boolean;
  locked_until: Date | string | null;
  locked: boolean;
  employee_id: string | null;
  employee_active: boolean | null;
  org_status: 'active' | 'blocked' | null;
  org_name: string | null;
}

const asDate = (v: Date | string | null): Date | null =>
  v === null ? null : v instanceof Date ? v : new Date(v);

export async function findLogin(db: Db | Tx, login: string): Promise<LoginRecord | null> {
  const [row] = await db.execute<LoginRow>(sql`select * from app.auth_find_login(${login})`);
  if (!row) return null;
  return {
    userId: row.user_id,
    orgId: row.org_id,
    login: row.login,
    passwordHash: row.password_hash,
    isPlatformAdmin: row.is_platform_admin,
    userBlocked: row.user_blocked,
    mustChangePassword: row.must_change_password,
    lockedUntil: asDate(row.locked_until),
    locked: row.locked,
    employeeId: row.employee_id,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
    orgName: row.org_name,
  };
}

/** Итог `reserveLoginAttempt`. */
export interface LoginAttempt {
  /** false — вход закрыт после неверных паролей: пароль не проверять. */
  allowed: boolean;
  /** Если пароль неверный, вход закрыт (это была пятая попытка подряд или вход уже закрыт). */
  locked: boolean;
  lockedUntil: Date | null;
}

/**
 * Занять попытку входа до проверки пароля (счётчик +1, на пятой подряд вход закрывается на 15 минут).
 * Так одновременные запросы не проверят больше пяти паролей; верный пароль сбрасывает счётчик
 * (`startSession`, `changeOwnPassword`).
 */
export async function reserveLoginAttempt(db: Db, userId: string): Promise<LoginAttempt> {
  const [row] = await db.execute<{
    allowed: boolean;
    locked: boolean;
    locked_until: Date | string | null;
  }>(
    sql`select * from app.auth_login_attempt(${userId}, ${LOGIN_MAX_FAILURES}, ${LOGIN_LOCK_MINUTES})`,
  );
  return {
    allowed: row?.allowed ?? false,
    locked: row?.locked ?? true,
    lockedUntil: asDate(row?.locked_until ?? null),
  };
}

/** Верный пароль: счётчик сбрасывается, создаётся сеанс (в базе — только хеш токена). */
export async function startSession(
  db: Db,
  input: { userId: string; tokenHash: string },
): Promise<string> {
  const [row] = await db.execute<{ id: string }>(
    sql`select app.auth_start_session(${input.userId}, ${input.tokenHash}, ${SESSION_TTL_DAYS}) as id`,
  );
  return row!.id;
}

/** Действующий сеанс и состояние пользователя. */
export interface SessionRecord {
  sessionId: string;
  userId: string;
  orgId: string | null;
  login: string;
  isPlatformAdmin: boolean;
  mustChangePassword: boolean;
  userBlocked: boolean;
  employeeId: string | null;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
  orgName: string | null;
  /** Срок сеанса только что продлён — cookie нужно выдать заново. */
  touched: boolean;
}

interface SessionRow extends Record<string, unknown> {
  session_id: string;
  user_id: string;
  org_id: string | null;
  login: string;
  is_platform_admin: boolean;
  must_change_password: boolean;
  user_blocked: boolean;
  employee_id: string | null;
  employee_active: boolean | null;
  org_status: 'active' | 'blocked' | null;
  org_name: string | null;
  touched: boolean;
}

/** Сеанс по хешу токена из cookie; истёкший или удалённый — null. */
export async function sessionByToken(db: Db, tokenHash: string): Promise<SessionRecord | null> {
  const [row] = await db.execute<SessionRow>(
    sql`select * from app.auth_session(${tokenHash}, ${SESSION_TTL_DAYS}, ${SESSION_TOUCH_MINUTES})`,
  );
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    orgId: row.org_id,
    login: row.login,
    isPlatformAdmin: row.is_platform_admin,
    mustChangePassword: row.must_change_password,
    userBlocked: row.user_blocked,
    employeeId: row.employee_id,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
    orgName: row.org_name,
    touched: row.touched,
  };
}

/** Выход: сеанс удаляется. */
export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await db.execute(sql`select app.auth_end_session(${tokenHash})`);
}

/**
 * Смена своего пароля в транзакции с app.user_id: остальные сеансы удаляются, у текущего —
 * новый токен; счётчик неверных паролей сбрасывается, ожидающий код «Забыли пароль?» отменяется.
 */
export async function changeOwnPassword(
  tx: Tx,
  input: { sessionId: string; passwordHash: string; newTokenHash: string },
): Promise<void> {
  await tx.execute(
    sql`select app.auth_change_own_password(${input.sessionId}, ${input.passwordHash}, ${input.newTokenHash})`,
  );
  // Код «Забыли пароль?», отправленный до смены, пароль уже не задаст (миграция 0011).
  await tx.execute(sql`select app.auth_reset_revoke(app.current_user_id())`);
}

/** Транзакция от имени пользователя без организации (администратор платформы). */
export async function withUserContext<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', '', true), set_config('app.user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}

/** Сотрудник с ролью: кто действует и какие у него права и области. */
export interface EmployeeAccess {
  subject: AccessSubject;
  fullName: string;
  shortName: string;
  roleId: string;
  roleName: string;
}

/** Права сотрудника в контексте его организации (withOrgContext). */
export async function loadEmployeeAccess(
  tx: Tx,
  employeeId: string,
): Promise<EmployeeAccess | null> {
  const [row] = await tx
    .select({
      id: employees.id,
      fullName: employees.fullName,
      shortName: employees.shortName,
      roleId: roles.id,
      roleName: roles.name,
      isOwner: roles.isOwner,
    })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(eq(employees.id, employeeId));
  if (!row) return null;
  const perms = await tx
    .select({ id: rolePermissions.permissionId })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, row.roleId));
  const scopeRows = await tx
    .select({ group: roleScopes.permGroup, scope: roleScopes.scope })
    .from(roleScopes)
    .where(eq(roleScopes.roleId, row.roleId));
  const scopes: Partial<Record<ScopeGroupId, Scope>> = {};
  for (const s of scopeRows) {
    if ((SCOPE_GROUPS as readonly string[]).includes(s.group)) {
      scopes[s.group as ScopeGroupId] = s.scope as Scope;
    }
  }
  return {
    subject: {
      employeeId: row.id,
      isOwner: row.isOwner,
      permissions: new Set(perms.map((p) => p.id).filter(isPermissionId) as PermissionId[]),
      scopes,
    },
    fullName: row.fullName,
    shortName: row.shortName,
    roleId: row.roleId,
    roleName: row.roleName,
  };
}

/** Организация из контекста: для «кто я». */
export async function currentOrganization(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org ?? null;
}
