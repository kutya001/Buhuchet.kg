import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { HealthResponse } from '@buhuchet/shared';
import { sql } from 'drizzle-orm';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Проверка «здоровья»: приложение, база, хранилище',
  responses: {
    200: {
      description: 'Всё работает',
      content: { 'application/json': { schema: HealthResponse } },
    },
    503: {
      description: 'База или хранилище недоступны',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

async function check(fn: () => Promise<unknown>): Promise<'ok' | 'error'> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'error';
  }
}

export function healthHandler(deps: ApiDeps): RouteHandler<typeof healthRoute, AppEnv> {
  return async (c) => {
    const [database, storage] = await Promise.all([
      check(() => deps.db.execute(sql`select 1`)),
      check(() => deps.storage.ping()),
    ]);
    const now = deps.clock.now();
    const body: HealthResponse = {
      status: database === 'ok' && storage === 'ok' ? 'ok' : 'degraded',
      version: deps.config.APP_VERSION,
      environment: deps.config.APP_ENV,
      time: now.toISOString(),
      todayBishkek: deps.clock.today(),
      checks: { database, storage },
    };
    c.header('cache-control', 'no-store');
    if (body.status === 'ok') return c.json(body, 200);
    deps.logger.warn({ checks: body.checks }, 'health: degraded');
    return c.json(body, 503);
  };
}
