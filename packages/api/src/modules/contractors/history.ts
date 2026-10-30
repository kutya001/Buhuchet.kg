import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { contractorHistory, withOrgContext } from '@buhuchet/db';
import { ContractorHistory, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { notFound } from './card';
import { error, scopeSqlOf, subjectOf, translateOf } from './common';

export const contractorHistoryRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/history',
  tags: ['contractors'],
  summary: 'История контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description:
        'Записи истории контрагента, его назначений, отчётов, задач и страницы — от новых к старым, не больше 200',
      content: { 'application/json': { schema: ContractorHistory } },
    },
    400: { description: 'Неверный номер контрагента', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Вкладка «История» карточки контрагента (прототип contractor-card.js, вкладка «hist»: последние 80
 * записей контрагента): область — как у карточки («Свои / Все контрагенты»).
 */
export function contractorHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorHistoryRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await translateOf(deps);
    const history = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      contractorHistory(tx, id, { scope: scopeSqlOf(subjectOf(c)), t }),
    );
    if (!history) notFound();
    return c.json(
      {
        items: history.items.map((h) => ({
          ...h,
          at: h.at.toISOString(),
          // Значения «было → стало» — любые JSON: тип ответа их не разбирает.
          changes: h.changes as { field: string; from?: unknown; to?: unknown }[],
        })),
        names: history.names,
      },
      200,
    );
  };
}
