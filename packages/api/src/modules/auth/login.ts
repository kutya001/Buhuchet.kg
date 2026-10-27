import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { verifyAgainstDummy, verifyPassword } from '@buhuchet/adapters/password';
import { hashSessionToken, newSessionToken } from '@buhuchet/adapters/tokens';
import {
  clearLoginAttempts,
  endSession,
  findLogin,
  reserveLoginAttempt,
  startSession,
} from '@buhuchet/db';
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
    401: {
      description: 'Неверный логин или пароль: одно сообщение для любого логина',
      content: error,
    },
    403: {
      description: 'Пароль верный, но сотрудник, учётная запись или организация заблокированы',
      content: error,
    },
    429: {
      description: `После ${LOGIN_MAX_FAILURES} неверных паролей подряд вход по этому логину закрыт на ${LOGIN_LOCK_MINUTES} минут, есть такой логин или нет`,
      content: error,
    },
  },
});

/** Одно сообщение для неизвестного логина и неверного пароля (docs/deviations.md, п. 4, решение Б). */
export const INVALID_CREDENTIALS_MESSAGE = 'Неверный логин или пароль';

/**
 * Вход (прототип core/login.js). Попытка по набранному логину занимается до проверки пароля, есть
 * такой логин или нет: на пятой неверной подряд вход по этому логину закрывается на 15 минут.
 * Неизвестный логин и неверный пароль — одно сообщение и одно время ответа (пароль неизвестного
 * логина сверяется с подставным хешем). О блокировке сотрудника, учётной записи или организации
 * сообщается только после верного пароля. Верный пароль снимает счёт неверных.
 */
// docs/deviations.md п. 4, решение Б (с v59 так же в ТЗ и прототипе core/login.js): одно «Неверный
// логин или пароль», о блокировке — только после верного пароля.
export function loginHandler(deps: ApiDeps): RouteHandler<typeof loginRoute, AppEnv> {
  return async (c) => {
    const { login: typed, password } = c.req.valid('json');
    const login = normalizeLogin(typed);
    // Попытка занимается до проверки пароля: одновременные запросы не проверят больше пяти паролей.
    const attempt = await reserveLoginAttempt(deps.db, login);
    if (!attempt.allowed) return c.json(lockedError(c, attempt.lockedUntil), 429);
    const account = await findLogin(deps.db, login);
    const valid = account
      ? await verifyPassword(account.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!account || !valid) {
      if (attempt.locked) return c.json(lockedError(c, attempt.lockedUntil), 429);
      return c.json(apiError('invalid_credentials', INVALID_CREDENTIALS_MESSAGE), 401);
    }
    await clearLoginAttempts(deps.db, login);
    const denial = loginDenial(account);
    if (denial) return c.json(denialError(denial, account), 403);

    // Прежний сеанс этого браузера закрывается: один вход — один сеанс.
    const previous = readSessionToken(c, deps);
    if (previous) await endSession(deps.db, hashSessionToken(previous));
    const token = newSessionToken();
    await startSession(deps.db, { userId: account.userId, tokenHash: hashSessionToken(token) });
    writeSessionCookie(c, deps, token);
    return c.json(await loadMe(deps, account), 200);
  };
}
