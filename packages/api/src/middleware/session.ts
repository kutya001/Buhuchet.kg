import { hashSessionToken } from '@buhuchet/adapters/tokens';
import { endSession, loadEmployeeAccess, sessionByToken, withOrgContext } from '@buhuchet/db';
import { loginDenial } from '@buhuchet/domain';
import { createMiddleware } from 'hono/factory';
import { denialError } from '../auth-errors';
import type { ApiDeps } from '../deps';
import type { AppEnv } from '../env';
import { apiError } from '../errors';
import { clearSessionCookie, readSessionToken, writeSessionCookie } from './cookie';

/** Открытые методы: без входа. Все остальные пути API требуют действующий сеанс. */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/cron/tick',
  '/api/openapi.json',
  '/api/auth/login',
  '/api/auth/logout',
]);

/** Что доступно, пока пользователь не сменил временный пароль. */
const BEFORE_PASSWORD_CHANGE = new Set(['/api/auth/me', '/api/auth/password']);

/**
 * Общий слой для всех методов API (ТЗ «Проверка входа, организации и прав — общим промежуточным
 * слоем»): cookie → сеанс → организация. Без сеанса — 401; заблокированный пользователь или
 * организация — 403, сеанс закрывается; с временным паролем — только «кто я» и смена пароля. Для
 * сотрудника права и области загружаются в контексте его организации (RLS) и лежат в `access`;
 * право конкретного метода проверяет `requirePermission`.
 */
export function sessionGuard(deps: ApiDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set('session', null);
    c.set('access', null);
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const token = readSessionToken(c, deps);
    const tokenHash = token ? hashSessionToken(token) : null;
    const session = tokenHash ? await sessionByToken(deps.db, tokenHash) : null;
    if (!token || !tokenHash || !session) {
      clearSessionCookie(c, deps);
      return c.json(apiError('unauthorized', 'Войдите в систему'), 401);
    }
    const denial = loginDenial(session);
    if (denial) {
      await endSession(deps.db, tokenHash);
      clearSessionCookie(c, deps);
      return c.json(denialError(denial, session), 403);
    }
    if (session.touched) writeSessionCookie(c, deps, token);
    c.set('session', { ...session, tokenHash });

    if (session.mustChangePassword && !BEFORE_PASSWORD_CHANGE.has(c.req.path)) {
      return c.json(
        apiError('password_change_required', 'Смените временный пароль, чтобы продолжить'),
        403,
      );
    }
    if (session.orgId && session.employeeId) {
      const access = await withOrgContext(
        deps.db,
        { orgId: session.orgId, userId: session.userId },
        (tx) => loadEmployeeAccess(tx, session.employeeId!),
      );
      c.set('access', access);
    }
    return next();
  });
}
