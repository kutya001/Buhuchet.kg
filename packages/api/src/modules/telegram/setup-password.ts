import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword } from '@buhuchet/adapters/password';
import { hashSessionToken } from '@buhuchet/adapters/tokens';
import {
  completePasswordSetup,
  peekPasswordSetup,
  withOrgContext,
  writeHistory,
} from '@buhuchet/db';
import {
  ApiError,
  PasswordSetupDone,
  PasswordSetupInfo,
  PasswordSetupParams,
  PasswordSetupRequest,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { AUTH_IP_LIMITED_DESCRIPTION, authIpLimited } from '../auth/ip-limit';
import { notifyPasswordChanged } from './bot';

/*
 * Страница «Задать пароль» по ссылке из Telegram (доработки 14.11.2026, блок 1, пункт 3; прототип v113
 * setPassPage): владелец организации, созданной по заявке, задаёт пароль сам — без входа, по ключу в
 * пути (`PUBLIC_PATTERNS` в middleware/session.ts). Ссылка действует 7 дней и один раз; открыть
 * страницу ссылку не тратит (её откроет и предпросмотр ссылок). Неизвестная, истёкшая, использованная и
 * заменённая — одинаково 404 «Ссылка устарела». Попытки с адреса считаются вместе со входом и
 * восстановлением пароля. После пароля — все сеансы завершены, в истории учётной записи — запись, в
 * Telegram — «Пароль изменён» с «Это не я».
 */

const error = { 'application/json': { schema: ApiError } };
const invalid = { description: 'Ссылка устарела (`setup_link_invalid`)', content: error };

/** Ключ в пути: страница без кеша, без индекса и без адреса в Referer при переходе с неё. */
function privateHeaders(c: Context<AppEnv>) {
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'no-referrer');
  c.header('x-robots-tag', 'noindex');
}

const linkInvalid = () => apiError('setup_link_invalid', 'Ссылка устарела');

export const setupPeekRoute = createRoute({
  method: 'get',
  path: '/auth/setup/{token}',
  tags: ['auth'],
  summary: 'Страница «Задать пароль»: чья ссылка (логин и организация)',
  request: { params: PasswordSetupParams },
  responses: {
    200: {
      description: 'Ссылка действует: логин и организация',
      content: { 'application/json': { schema: PasswordSetupInfo } },
    },
    400: { description: 'Ключ ссылки не того вида', content: error },
    404: invalid,
    429: { description: AUTH_IP_LIMITED_DESCRIPTION, content: error },
  },
});

export function setupPeekHandler(deps: ApiDeps): RouteHandler<typeof setupPeekRoute, AppEnv> {
  return async (c) => {
    privateHeaders(c);
    const limited = await authIpLimited(c, deps);
    if (limited) return c.json(limited, 429);
    const { token } = c.req.valid('param');
    const found = await peekPasswordSetup(deps.db, {
      hash: hashSessionToken(token),
      now: deps.clock.now(),
    });
    if (!found) return c.json(linkInvalid(), 404);
    return c.json({ login: found.login, organization: found.orgName }, 200);
  };
}

export const setupCompleteRoute = createRoute({
  method: 'post',
  path: '/auth/setup/{token}',
  tags: ['auth'],
  summary: 'Задать пароль по ссылке из Telegram',
  request: {
    params: PasswordSetupParams,
    body: { required: true, content: { 'application/json': { schema: PasswordSetupRequest } } },
  },
  responses: {
    200: {
      description: 'Пароль задан, сеансы завершены; вход — с этим логином',
      content: { 'application/json': { schema: PasswordSetupDone } },
    },
    400: { description: 'Пароль короче 8 или длиннее 128 знаков', content: error },
    403: { description: 'Запрос с другого сайта', content: error },
    404: invalid,
    429: { description: AUTH_IP_LIMITED_DESCRIPTION, content: error },
    503: { description: 'Очередь проверки паролей переполнена (`server_busy`)', content: error },
  },
});

export function setupCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof setupCompleteRoute, AppEnv> {
  return async (c) => {
    privateHeaders(c);
    const limited = await authIpLimited(c, deps);
    if (limited) return c.json(limited, 429);
    const { token } = c.req.valid('param');
    const { password } = c.req.valid('json');
    const hash = hashSessionToken(token);
    const found = await peekPasswordSetup(deps.db, { hash, now: deps.clock.now() });
    if (!found) return c.json(linkInvalid(), 404);
    const passwordHash = await hashPassword(password);
    const login = await withOrgContext(
      deps.db,
      { orgId: found.orgId, userId: found.userId },
      async (tx) => {
        const done = await completePasswordSetup(tx, { hash, passwordHash, now: deps.clock.now() });
        if (!done) return null;
        await writeHistory(tx, {
          entity: 'user',
          entityId: found.userId,
          action: 'update',
          changes: [{ field: 'passwordHash' }],
          reason: 'Пароль задан по ссылке из Telegram',
        });
        return done;
      },
    );
    // Ссылку заменили новой или заблокировали владельца, пока страница была открыта.
    if (!login) return c.json(linkInvalid(), 404);
    try {
      await notifyPasswordChanged(deps, { userId: found.userId, login, orgName: found.orgName });
    } catch (err) {
      deps.logger.warn({ err }, 'Telegram: «Пароль изменён» после ссылки не отправлено');
    }
    return c.json({ ok: true as const, login }, 200);
  };
}
