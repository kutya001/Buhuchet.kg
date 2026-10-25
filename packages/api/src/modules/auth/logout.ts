import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashSessionToken } from '@buhuchet/adapters/tokens';
import { endSession } from '@buhuchet/db';
import { OkResponse } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { clearSessionCookie, readSessionToken } from '../../middleware/cookie';

export const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['auth'],
  summary: 'Выход: сеанс завершается',
  responses: {
    200: {
      description: 'Сеанс удалён, cookie стёрта',
      content: { 'application/json': { schema: OkResponse } },
    },
  },
});

/** Выход работает и с истёкшим сеансом: cookie всё равно стирается. */
export function logoutHandler(deps: ApiDeps): RouteHandler<typeof logoutRoute, AppEnv> {
  return async (c) => {
    const token = readSessionToken(c, deps);
    if (token) await endSession(deps.db, hashSessionToken(token));
    clearSessionCookie(c, deps);
    return c.json({ ok: true as const }, 200);
  };
}
