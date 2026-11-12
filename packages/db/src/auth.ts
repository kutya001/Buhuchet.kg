import {
  ACCOUNT_LOCK_FAILURES,
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_MAX_CODES,
  ADMIN_CODE_MAX_DAILY,
  ADMIN_CODE_TTL_MINUTES,
  ADMIN_CODE_WINDOW_MINUTES,
  isPermissionId,
  LOGIN_FAILURE_MEMORY_MINUTES,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  SCOPE_GROUPS,
  SESSION_MAX_HOURS,
  type SessionEndReason,
  SESSION_TOUCH_MINUTES,
  SESSION_TTL_DAYS,
  type AccessSubject,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { timeoutSetting, type QueryKind } from './context';
import { employees, organizations, rolePermissions, roleScopes, roles } from './schema';

/**
 * Вход и сеансы до выбора организации — через функции app.auth_* (миграции 0009 и 0013): роль
 * приложения сама не видит пользователей и сеансы чужих организаций, а при входе организация ещё не
 * известна.
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
  employeeId: string | null;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
  orgName: string | null;
  /** Вход закрыт после 10 неверных паролей подряд (миграция 0095). */
  loginLocked: boolean;
  /** Владелец организации: его блокировку входа снимает администратор платформы. */
  isOwner: boolean;
}

interface LoginRow extends Record<string, unknown> {
  user_id: string;
  org_id: string | null;
  login: string;
  password_hash: string;
  is_platform_admin: boolean;
  user_blocked: boolean;
  must_change_password: boolean;
  employee_id: string | null;
  employee_active: boolean | null;
  org_status: 'active' | 'blocked' | null;
  org_name: string | null;
  login_locked: boolean;
  is_owner: boolean;
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
    employeeId: row.employee_id,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
    orgName: row.org_name,
    loginLocked: row.login_locked,
    isOwner: row.is_owner,
  };
}

/**
 * Неверный пароль у учётной записи (`userId`; null — такого логина нет: запрос тот же, по времени не
 * видно): счёт +1, на ACCOUNT_LOCK_FAILURES-м подряд вход закрывается. true — эта попытка закрыла вход
 * (тогда — `notifyAccountLocked`). Счёт снимают верный пароль (`clearLoginAttempts`) и новый пароль от
 * владельца или администратора (`setTemporaryPassword`).
 */
export async function recordLoginFailure(db: Db, userId: string | null): Promise<boolean> {
  const [row] = await db.execute<{ locked_now: boolean }>(
    sql`select * from app.auth_login_failed(${userId}::uuid, ${ACCOUNT_LOCK_FAILURES})`,
  );
  return row?.locked_now === true;
}

/**
 * Вход только что закрыт: запись в историю организации от имени системы и сообщения в очередь
 * Telegram — пользователю и тем, кто снимает блокировку (владельцам или администраторам платформы).
 */
export async function notifyAccountLocked(
  db: Db,
  /** Тексты null — бот не подключён: только запись в историю. */
  input: { userId: string; userText: string | null; unlockerText: string | null; now: Date },
): Promise<void> {
  await db.execute(
    sql`select app.auth_lock_notify(${input.userId}, ${input.userText}, ${input.unlockerText}, ${input.now.toISOString()}::timestamptz)`,
  );
}

/**
 * Код из Telegram при входе администратора платформы (docs/deviations.md п. О-13, миграция 0098):
 * новый код отменяет прежние; denied — не администратор или заблокирован, limited — кодов за окно
 * уже ADMIN_CODE_MAX_CODES, limited_day — за сутки ADMIN_CODE_MAX_DAILY кодов без входа.
 */
export type AdminCodeIssue =
  | { outcome: 'ok'; expiresAt: Date }
  | { outcome: 'denied' }
  | { outcome: 'limited' }
  | { outcome: 'limited_day' };

export async function issueAdminCode(
  db: Db,
  input: { userId: string; tokenHash: string; codeHash: string },
): Promise<AdminCodeIssue> {
  const [row] = await db.execute<{ outcome: string; expires_at: Date | string | null }>(
    sql`select * from app.admin_code_issue(${input.userId}, ${input.tokenHash}, ${input.codeHash}, ${ADMIN_CODE_TTL_MINUTES}, ${ADMIN_CODE_MAX_CODES}, ${ADMIN_CODE_WINDOW_MINUTES}, ${ADMIN_CODE_MAX_DAILY})`,
  );
  if (row?.outcome === 'ok' && row.expires_at !== null) {
    return { outcome: 'ok', expiresAt: new Date(row.expires_at) };
  }
  if (row?.outcome === 'limited' || row?.outcome === 'limited_day') return { outcome: row.outcome };
  return { outcome: 'denied' };
}

/** Занятая попытка ввода кода: чей код и его хеш. */
export interface AdminCodeAttempt {
  codeId: string;
  userId: string;
  login: string;
  codeHash: string;
}

/**
 * Занять попытку ввода кода до проверки (не больше ADMIN_CODE_MAX_ATTEMPTS на код). null — токена нет,
 * код истёк, использован, отменён, вводов больше нет или пароль сменили после кода.
 */
export async function takeAdminCodeAttempt(
  db: Db,
  tokenHash: string,
): Promise<AdminCodeAttempt | null> {
  const [row] = await db.execute<{
    code_id: string;
    user_id: string;
    login: string;
    code_hash: string;
  }>(sql`select * from app.admin_code_attempt(${tokenHash}, ${ADMIN_CODE_MAX_ATTEMPTS})`);
  if (!row) return null;
  return { codeId: row.code_id, userId: row.user_id, login: row.login, codeHash: row.code_hash };
}

/** Код подошёл: больше не действует, вход засчитан; false — его уже использовали или он истёк. */
export async function useAdminCode(db: Db, codeId: string): Promise<boolean> {
  const [row] = await db.execute<{ used: boolean }>(
    sql`select app.admin_code_use(${codeId}) as used`,
  );
  return row?.used === true;
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
 * Занять попытку входа по набранному логину до проверки пароля (счёт +1, на пятой подряд вход
 * закрывается на 15 минут; через час счёт забывается). Счёт ведётся и для логина, которого нет:
 * «вход закрыт» одинаков для любого логина (docs/deviations.md, п. 4, решение Б). Так одновременные
 * запросы не проверят больше пяти паролей. Верный пароль снимает счёт (`clearLoginAttempts`), смена
 * и сброс пароля — тоже (`changeOwnPassword`, `completePasswordReset`, `setTemporaryPassword`).
 */
export async function reserveLoginAttempt(db: Db, login: string): Promise<LoginAttempt> {
  const [row] = await db.execute<{
    allowed: boolean;
    locked: boolean;
    locked_until: Date | string | null;
  }>(
    sql`select * from app.auth_login_attempt(${login}, ${LOGIN_MAX_FAILURES}, ${LOGIN_LOCK_MINUTES}, ${LOGIN_FAILURE_MEMORY_MINUTES})`,
  );
  return {
    allowed: row?.allowed ?? false,
    locked: row?.locked ?? true,
    lockedUntil: asDate(row?.locked_until ?? null),
  };
}

/** Снять счёт неверных паролей и блокировку входа по логину (верный пароль, новый пароль). */
export async function clearLoginAttempts(db: Db | Tx, login: string): Promise<void> {
  await db.execute(sql`select app.auth_login_clear(${login})`);
}

/** Удалить строки, чей счёт уже забыт (задача по расписанию); возвращает, сколько удалено. */
export async function cleanupLoginAttempts(db: Db): Promise<number> {
  const [row] = await db.execute<{ removed: number }>(
    sql`select app.auth_login_cleanup(${LOGIN_FAILURE_MEMORY_MINUTES}) as removed`,
  );
  return row?.removed ?? 0;
}

/** Верный пароль: создаётся сеанс (в базе — только хеш токена). */
export async function startSession(
  db: Db,
  input: { userId: string; tokenHash: string; device?: string | null },
): Promise<string> {
  // Устройство («браузер и система») — в журнал сеансов для карточки пользователя в Админке.
  const [row] = await db.execute<{ id: string }>(
    sql`select app.auth_start_session(${input.userId}, ${input.tokenHash}, ${SESSION_TTL_DAYS}, ${input.device ?? null}) as id`,
  );
  return row!.id;
}

/**
 * Перед удалением сеансов в этой транзакции: причина для журнала сеансов (триггер на `sessions`
 * читает настройку транзакции app.session_end). На доступ не влияет — только подпись в карточке.
 */
export async function markSessionEnd(
  tx: Tx,
  reason: Exclude<SessionEndReason, 'expired' | 'closed' | 'logout'>,
): Promise<void> {
  await tx.execute(sql`select set_config('app.session_end', ${reason}, true)`);
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

/**
 * Сеанс по хешу токена из cookie; истёкший, удалённый или начатый раньше `SESSION_MAX_HOURS` назад —
 * null. Обычно сеанс заодно продлевается (не чаще раза в час, тогда `touched`), но не дальше
 * `SESSION_MAX_HOURS` с входа. `touch: false` — только прочитать: порог продления берётся равным
 * сроку жизни сеанса, а за это время действующий сеанс не бывает «несвежим».
 */
export async function sessionByToken(
  db: Db,
  tokenHash: string,
  { touch = true }: { touch?: boolean } = {},
): Promise<SessionRecord | null> {
  const touchMinutes = touch ? SESSION_TOUCH_MINUTES : SESSION_TTL_DAYS * 24 * 60;
  const [row] = await db.execute<SessionRow>(
    sql`select * from app.auth_session(${tokenHash}, ${SESSION_TTL_DAYS}, ${touchMinutes}, ${SESSION_MAX_HOURS})`,
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

/**
 * Выход: сеанс удаляется. `reason` — чем он закрыт в журнале сеансов вместо «Выход»: `blocked` —
 * пользователю или организации закрыли вход, `closed` — в этом браузере вошли заново.
 */
export async function endSession(
  db: Db,
  tokenHash: string,
  reason?: Extract<SessionEndReason, 'blocked' | 'closed'>,
): Promise<void> {
  if (!reason) {
    await db.execute(sql`select app.auth_end_session(${tokenHash})`);
    return;
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.session_end', ${reason}, true)`);
    await tx.execute(sql`select app.auth_end_session(${tokenHash})`);
  });
}

/**
 * Смена своего пароля в транзакции с app.user_id: остальные сеансы удаляются, у текущего —
 * новый токен; счётчик неверных паролей сбрасывается, ожидающий код «Забыли пароль?» отменяется.
 */
export async function changeOwnPassword(
  tx: Tx,
  input: { sessionId: string; passwordHash: string; newTokenHash: string },
): Promise<void> {
  await markSessionEnd(tx, 'password');
  await tx.execute(
    sql`select app.auth_change_own_password(${input.sessionId}, ${input.passwordHash}, ${input.newTokenHash})`,
  );
  // Код «Забыли пароль?», отправленный до смены, пароль уже не задаст (миграция 0011).
  await tx.execute(sql`select app.auth_reset_revoke(app.current_user_id())`);
}

/**
 * Транзакция от имени пользователя без организации (администратор платформы); предел времени
 * запросов — по виду работы, как у `withOrgContext`.
 */
export async function withUserContext<T>(
  db: Db,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  kind: QueryKind = 'request',
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', '', true), set_config('app.user_id', ${userId}, true), ${timeoutSetting(kind)}`,
    );
    return fn(tx);
  });
}

/** Сотрудник с ролью: кто действует и какие у него права и области. */
export interface EmployeeAccess {
  subject: AccessSubject;
  fullName: string;
  shortName: string;
  /** Телефон «+996555100200»; null — не указан. */
  phone: string | null;
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
      phone: employees.phone,
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
    phone: row.phone,
    roleId: row.roleId,
    roleName: row.roleName,
  };
}

/** Организация из контекста: для «кто я». */
export async function currentOrganization(tx: Tx, orgId: string) {
  const [org] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      inn: organizations.inn,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return org ?? null;
}
