import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { isAuthorizedCronCall } from '@buhuchet/adapters/scheduler';
import { ApiError, CronTickResponse } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import { apiError } from '../../errors';
import { runDueJobs } from '../../jobs/runner';

const responses = {
  200: {
    description: 'Задачи, которым было пора, выполнены',
    content: { 'application/json': { schema: CronTickResponse } },
  },
  401: {
    description: 'Нет или неверный секрет планировщика',
    content: { 'application/json': { schema: ApiError } },
  },
} as const;

// Vercel Cron вызывает GET, worker и системный cron на VPS — POST; оба с `Authorization: Bearer <CRON_SECRET>`.
export const cronTickGetRoute = createRoute({
  method: 'get',
  path: '/cron/tick',
  tags: ['system'],
  summary: 'Запуск задач по расписанию',
  responses,
});
export const cronTickPostRoute = createRoute({
  method: 'post',
  path: '/cron/tick',
  tags: ['system'],
  summary: 'Запуск задач по расписанию',
  responses,
});

export function cronTickHandler(
  deps: ApiDeps,
): RouteHandler<typeof cronTickGetRoute> & RouteHandler<typeof cronTickPostRoute> {
  return async (c) => {
    if (!isAuthorizedCronCall(c.req.header('authorization'), deps.config.CRON_SECRET)) {
      return c.json(apiError('cron_unauthorized', 'Неверный секрет планировщика'), 401);
    }
    return c.json(await runDueJobs(deps, deps.jobs), 200);
  };
}
