import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import {
  changeOwnPassword,
  clearLoginAttempts,
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
import { notifyPasswordChanged } from '../telegram/bot';

const error = { 'application/json': { schema: ApiError } };

/** Запись в истории после смены временного пароля своим (ТЗ «Вход в систему»). */
export const TEMP_PASSWORD_REPLACED = 'Временный пароль заменён своим';

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
 * обязательная смена временного пароля; новый пароль не может совпадать с текущим. Неверный текущий пароль считается как неверный пароль при
 * входе: так украденный сеанс не позволит подобрать пароль. Новая cookie выдаётся и этому сеансу:
 * старая больше не действует нигде. Бот сообщает о смене пароля в привязанный Telegram.
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
    const attempt = await reserveLoginAttempt(deps.db, account.login);
    if (!attempt.allowed) return c.json(lockedError(c, attempt.lockedUntil), 429);
    if (!(await verifyPassword(account.passwordHash, currentPassword))) {
      if (attempt.locked) return c.json(lockedError(c, attempt.lockedUntil), 429);
      return c.json(apiError('current_password_invalid', 'Текущий пароль неверный'), 400);
    }
    // Новый пароль не совпадает с текущим (решение заказчика 27.10.2026, docs/deviations.md п. 41):
    // иначе обязательная смена временного пароля, который видел выдавший его, ничего не меняет.
    // Сверяется после проверки текущего пароля — без него ответ ничего не говорит о пароле; текущий
    // верный, поэтому счёт неверных паролей снимается, как при входе.
    if (newPassword === currentPassword) {
      await clearLoginAttempts(deps.db, account.login);
      return c.json(apiError('password_same', 'Новый пароль совпадает с текущим'), 400);
    }

    const passwordHash = await hashPassword(newPassword);
    const token = newSessionToken();
    const change = (tx: Tx) =>
      changeOwnPassword(tx, {
        sessionId: session.sessionId,
        passwordHash,
        newTokenHash: hashSessionToken(token),
      }); // заодно снимает счёт неверных паролей и блокировку входа
    if (session.orgId) {
      await withOrgContext(
        deps.db,
        { orgId: session.orgId, userId: session.userId },
        async (tx) => {
          await change(tx);
          // Смена временного пароля — в истории сотрудника «Временный пароль заменён своим»
          // (прототип core/login.js, шаг `first`), как «Пароль сброшен» у сброса пароля владельцем.
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
            reason: account.mustChangePassword ? TEMP_PASSWORD_REPLACED : null,
          });
        },
      );
    } else {
      // История администратора платформы — в Админке (#18); у его записи нет организации.
      await withUserContext(deps.db, session.userId, change);
    }
    writeSessionCookie(c, deps, token);
    await notifyPasswordChanged(deps, session);
    return c.json({ ok: true as const }, 200);
  };
}
