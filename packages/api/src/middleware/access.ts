import { withOrgContext, withUserContext, type OrgContext, type Tx } from '@buhuchet/db';
import { hasPermission, type PermissionId } from '@buhuchet/domain';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ApiDeps } from '../deps';
import type { AppEnv, AuthSession } from '../env';
import { apiError } from '../errors';

const forbidden = () => apiError('forbidden', 'Нет права на это действие');

/**
 * Право метода: `createRoute({ middleware: [requirePermission('cpEdit')] as const, … })`. Сервер
 * проверяет право при каждом действии, даже если кнопка скрыта (ТЗ «Сотрудники»). Администратор
 * платформы прав в организации не имеет. Область «Свои / Все контрагенты» метод берёт из
 * `scopeOf(c.var.access.subject, группа)` и сужает запрос.
 */
export function requirePermission(permission: PermissionId) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const access = c.get('access');
    if (!access || !hasPermission(access.subject, permission)) {
      return c.json(forbidden(), 403);
    }
    return next();
  });
}

/**
 * Любое из прав: «Сменить ответственного» доступно с правом «Назначать отчёты контрагентам» или
 * «Создавать и изменять контрагентов» (прототип cpActions).
 */
export function requireAnyPermission(...permissions: PermissionId[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const access = c.get('access');
    if (!access || !permissions.some((p) => hasPermission(access.subject, p))) {
      return c.json(forbidden(), 403);
    }
    return next();
  });
}

/** Метод для любого сотрудника организации (свой профиль и т. п.), не для администратора платформы. */
export const requireEmployee = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('access')) return c.json(forbidden(), 403);
  return next();
});

/** Метод Админки: только администратор платформы (ТЗ «Админка»). */
export const requirePlatformAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('session')?.isPlatformAdmin) return c.json(forbidden(), 403);
  return next();
});

/**
 * Контекст для `withOrgContext`: организация и пользователь — только из сеанса, не из запроса. Без
 * организации в сеансе (администратор платформы в методе, где забыли `requirePermission`) — 403.
 */
export function orgContextOf(c: Context<AppEnv>): OrgContext {
  const session = c.get('session');
  if (!session?.orgId) {
    throw new HTTPException(403, { res: Response.json(forbidden(), { status: 403 }) });
  }
  return { orgId: session.orgId, userId: session.userId };
}

/**
 * Транзакция от имени вошедшего: в его организации (RLS) или, у администратора платформы, без неё
 * (`withUserContext`). Для своих данных пользователя: привязка Telegram, настройки вида.
 */
export function asSessionUser<T>(
  deps: ApiDeps,
  session: AuthSession,
  fn: (tx: Tx, inOrg: boolean) => Promise<T>,
): Promise<T> {
  return session.orgId
    ? withOrgContext(deps.db, { orgId: session.orgId, userId: session.userId }, (tx) =>
        fn(tx, true),
      )
    : withUserContext(deps.db, session.userId, (tx) => fn(tx, false));
}
