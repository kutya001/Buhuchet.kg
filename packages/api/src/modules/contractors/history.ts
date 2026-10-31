import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorHistory,
  orgMenuSettings,
  withOrgContext,
  type ContractorHistoryAccess,
  type Tx,
} from '@buhuchet/db';
import { hasPermission, type AccessSubject } from '@buhuchet/domain';
import { ContractorHistory, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { filesScopeOf } from '../files/manager';
import { kpiScopeOf } from '../kpi/common';
import { finScopeOf } from '../money/common';
import { reportScopeOf } from '../reports/common';
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
 * Что из истории видно (как вкладки карточки): отчёты и назначения — с «Просматривать отчёты» в его
 * области, задачи — с функцией «Задачи», показатели, файлы и поступления денег — с функцией, правом и
 * областью своего модуля, поля платы — с «Видеть плату за обслуживание».
 */
async function historyAccess(
  tx: Tx,
  orgId: string,
  subject: AccessSubject,
): Promise<ContractorHistoryAccess> {
  const { features } = await orgMenuSettings(tx, orgId);
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(subject, p);
  return {
    fee: features.fee && can('fee'),
    reports: can('repView') && reportScopeOf(subject),
    tasks: features.tasks,
    kpi: features.indicators && can('kpiView') && kpiScopeOf(subject),
    files: features.files && can('filesView') && filesScopeOf(subject),
    money: features.taxpay && (can('finView') || can('money')) && finScopeOf(subject),
  };
}

/**
 * Вкладка «История» карточки контрагента (прототип contractor-card.js, вкладка «hist»: последние 80
 * записей контрагента): область — как у карточки («Свои / Все контрагенты»), записи модулей — по
 * правам (`historyAccess`).
 */
export function contractorHistoryHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorHistoryRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await translateOf(deps);
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const history = await withOrgContext(deps.db, ctx, async (tx) =>
      contractorHistory(tx, id, {
        scope: scopeSqlOf(subject),
        access: await historyAccess(tx, ctx.orgId, subject),
        t,
      }),
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
