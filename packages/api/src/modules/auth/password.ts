import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import {
  changeOwnPassword,
  findLogin,
  reserveLoginAttempt,
  withOrgContext,
  withUserContext,
  writeHistory,
  type Tx,
} from '@buhuchet/db';
import { LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES } from '@buhuchet/domain';
import { ApiError, ChangePasswordRequest, OkResponse } from '@buhuchet/shared';
import { lockedError } from '../../auth-errors';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { writeSessionCookie } from '../../middleware/cookie';

const error = { 'application/json': { schema: ApiError } };

export const changePasswordRoute = createRoute({
  method: 'post',
  path: '/auth/password',
  tags: ['auth'],
  summary: 'Смена своего пароля: остальные сеансы завершаются',
  request: {
    body: { required: true, content: { 'application/json': { schema: ChangePasswordRequest } } },
  },
  responses: {
    200: {
      description: 'Пароль изменён; у этого сеанса новая cookie, остальные сеансы закрыты',
      content: { 'application/json': { schema: OkResponse } },
    },
    400: { description: 'Текущий пароль неверный или новый не подходит', content: error },
    401: { description: 'Нет входа', content: error },
    429: {
      description: `После ${LOGIN_MAX_FAILURES} неверных паролей вход и смена пароля закрыты на ${LOGIN_LOCK_MINUTES} минут`,
      content: error,
    },
  },
});

/**
 * Смена пароля (прототип modules/profile.js: «Пароль изменён. Другие сеансы завершены.») — и
 * обязательная смена временного пароля. Неверный текущий пароль считается как неверный пароль при
 * входе: так украденный сеанс не позволит подобрать пароль. Новая cookie выдаётся и этому сеансу:
 * старая больше не действует нигде.
 */
export function changePasswordHandler(
  deps: ApiDeps,
): RouteHandler<typeof changePasswordRoute, AppEnv> {
  return async (c) => {
    const session = c.get('session')!;
    const { currentPassword, newPassword } = c.req.valid('json');
    const account = await findLogin(deps.db, session.login);
    if (!account || account.userId !== session.userId) {
      return c.json(apiError('unauthorized', 'Войдите в систему'), 401);
    }
    if (account.locked) return c.json(lockedError(c, account.lockedUntil), 429);
    const attempt = await reserveLoginAttempt(deps.db, account.userId);
    if (!attempt.allowed) return c.json(lockedError(c, attempt.lockedUntil), 429);
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      if (attempt.locked) return c.json(lockedError(c, attempt.lockedUntil), 429);
      return c.json(apiError('current_password_invalid', 'Текущий пароль неверный'), 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const token = newSessionToken();
    const change = (tx: Tx) =>
      changeOwnPassword(tx, {
        sessionId: session.sessionId,
        passwordHash,
        newTokenHash: hashSessionToken(token),
      }); // заодно сбрасывает счётчик неверных паролей
    if (session.orgId) {
      await withOrgContext(
        deps.db,
        { orgId: session.orgId, userId: session.userId },
        async (tx) => {
          await change(tx);
          await writeHistory(tx, {
            entity: 'user',
            entityId: session.userId,
            action: 'update',
            changes: [
              { field: 'passwordHash' },
              ...(account.mustChangePassword
                ? [{ field: 'mustChangePassword', from: true, to: false }]
                : []),
            ],
          });
        },
      );
    } else {
      // История администратора платформы — в Админке (#18); у его записи нет организации.
      await withUserContext(deps.db, session.userId, change);
    }
    writeSessionCookie(c, deps, token);
    return c.json({ ok: true as const }, 200);
  };
}
