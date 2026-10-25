import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { verifyAgainstDummy, verifyPassword } from '@buhuchet/adapters/password';
import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import { endSession, findLogin, recordLoginFailure, startSession } from '@buhuchet/db';
import {
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  loginDenial,
  normalizeLogin,
} from '@buhuchet/domain';
import { ApiError, LoginRequest, MeResponse } from '@buhuchet/shared';
import { denialError, lockedError } from '../../auth-errors';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { readSessionToken, writeSessionCookie } from '../../middleware/cookie';
import { loadMe } from './me';

const error = { 'application/json': { schema: ApiError } };

export const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Вход по логину и паролю',
  request: { body: { required: true, content: { 'application/json': { schema: LoginRequest } } } },
  responses: {
    200: {
      description: 'Вошёл: cookie сеанса выставлена',
      content: { 'application/json': { schema: MeResponse } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет такого логина или неверный пароль', content: error },
    403: { description: 'Учётная запись или организация заблокирована', content: error },
    429: {
      description: `После ${LOGIN_MAX_FAILURES} неверных паролей вход закрыт на ${LOGIN_LOCK_MINUTES} минут`,
      content: error,
    },
  },
});

/**
 * Порядок проверок — как в прототипе (core/login.js): нет логина → «Нет такого логина»; учётная
 * запись или организация заблокирована → сообщение о блокировке; неверный пароль → «Неверный
 * пароль…», на пятом подряд вход закрывается на 15 минут (docs/deviations.md, п. 4).
 */
export function loginHandler(deps: ApiDeps): RouteHandler<typeof loginRoute, AppEnv> {
  return async (c) => {
    const { login, password } = c.req.valid('json');
    const account = await findLogin(deps.db, normalizeLogin(login));
    if (!account) {
      await verifyAgainstDummy(password);
      return c.json(apiError('unknown_login', 'Нет такого логина'), 401);
    }
    if (account.locked) {
      return c.json(lockedError(c, account.lockedUntil), 429);
    }
    const denial = loginDenial(account);
    if (denial) return c.json(denialError(denial, account.orgName), 403);

    if (!(await verifyPassword(account.passwordHash, password))) {
      const failure = await recordLoginFailure(deps.db, account.userId);
      if (failure.locked) {
        return c.json(lockedError(c, failure.lockedUntil), 429);
      }
      return c.json(
        apiError(
          'wrong_password',
          `Неверный пароль. После ${LOGIN_MAX_FAILURES} неверных попыток вход блокируется на ${LOGIN_LOCK_MINUTES} минут.`,
        ),
        401,
      );
    }

    // Прежний сеанс этого браузера закрывается: один вход — один сеанс.
    const previous = readSessionToken(c, deps);
    if (previous) await endSession(deps.db, hashSessionToken(previous));
    const token = newSessionToken();
    await startSession(deps.db, { userId: account.userId, tokenHash: hashSessionToken(token) });
    writeSessionCookie(c, deps, token);
    return c.json(await loadMe(deps, account), 200);
  };
}
