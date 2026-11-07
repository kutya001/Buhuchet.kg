import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { ApiError, HealthPublicResponse, HealthResponse } from '@buhuchet/shared';
import { sql } from 'drizzle-orm';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { requirePlatformAdmin } from '../../middleware/access';

/**
 * Без входа — только «работает или нет» (проверки Docker, наблюдение за сайтом). Версия, окружение и
 * что именно не работает — только администратору платформы (docs/deviations.md п. О-9): посторонним
 * это облегчает разведку.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-9
export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Проверка «здоровья»: работает ли приложение с базой и хранилищем',
  responses: {
    200: {
      description: 'Всё работает',
      content: { 'application/json': { schema: HealthPublicResponse } },
    },
    503: {
      description: 'База или хранилище недоступны',
      content: { 'application/json': { schema: HealthPublicResponse } },
    },
  },
});

export const adminHealthRoute = createRoute({
  method: 'get',
  path: '/admin/health',
  tags: ['system'],
  summary:
    'Проверка «здоровья» подробно: версия, окружение, база, хранилище (администратор платформы)',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Всё работает',
      content: { 'application/json': { schema: HealthResponse } },
    },
    401: { description: 'Нет входа', content: { 'application/json': { schema: ApiError } } },
    403: {
      description: 'Не администратор платформы',
      content: { 'application/json': { schema: ApiError } },
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

async function healthOf(deps: ApiDeps): Promise<HealthResponse> {
  const [database, storage] = await Promise.all([
    check(() => deps.db.execute(sql`select 1`)),
    check(() => deps.storage.ping()),
  ]);
  const body: HealthResponse = {
    status: database === 'ok' && storage === 'ok' ? 'ok' : 'degraded',
    version: deps.config.APP_VERSION,
    environment: deps.config.APP_ENV,
    time: deps.clock.now().toISOString(),
    todayBishkek: deps.clock.today(),
    checks: { database, storage },
  };
  if (body.status !== 'ok') deps.logger.warn({ checks: body.checks }, 'health: degraded');
  return body;
}

export function healthHandler(deps: ApiDeps): RouteHandler<typeof healthRoute, AppEnv> {
  return async (c) => {
    const { status } = await healthOf(deps);
    const body: HealthPublicResponse = { status };
    c.header('cache-control', 'no-store');
    return status === 'ok' ? c.json(body, 200) : c.json(body, 503);
  };
}

export function adminHealthHandler(deps: ApiDeps): RouteHandler<typeof adminHealthRoute, AppEnv> {
  return async (c) => {
    const body = await healthOf(deps);
    c.header('cache-control', 'no-store');
    return body.status === 'ok' ? c.json(body, 200) : c.json(body, 503);
  };
}
