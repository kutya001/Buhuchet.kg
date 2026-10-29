import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { manualReportDue, manualReportOptions, withOrgContext } from '@buhuchet/db';
import { dueRuleText } from '@buhuchet/domain';
import { ManualReportDue, ManualReportDueQuery, ManualReportOptions } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { assigneeScopeOf, error } from './common';

/*
 * Окно «+ Добавить» → «Разовый отчёт» модуля «Отчеты для сдачи» (задача 2.13, прототип
 * modules/report-card.js, adhocDlg): что выбрать и срок разового вида по дате события до сохранения.
 * Сохраняет окно `POST /api/reports` задачи 2.06.
 */

const noRight = { description: 'Нет права «Менять статус сдачи»', content: error };

export const manualReportOptionsRoute = createRoute({
  method: 'get',
  path: '/reports/manual-options',
  tags: ['reports'],
  summary: 'Списки окна «Разовый отчёт»',
  middleware: [requirePermission('changeStatus')] as const,
  responses: {
    200: {
      description:
        'Контрагенты в области «Свои» группы «Отчеты для сдачи» (кроме архивных) и подключённые действующие виды отчётов',
      content: { 'application/json': { schema: ManualReportOptions } },
    },
    401: { description: 'Нет входа', content: error },
    403: noRight,
  },
});

export function manualReportOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof manualReportOptionsRoute, AppEnv> {
  return async (c) => {
    const t = await translateOf(deps);
    const options = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      manualReportOptions(tx, assigneeScopeOf(subjectOf(c))),
    );
    return c.json(
      {
        contractors: options.contractors,
        types: options.types.map((x) => ({
          code: x.code,
          name: x.name,
          shortName: x.shortName,
          act: x.act,
          oneOff: x.oneOff,
          eventLabel: x.eventLabel,
          dueText: dueRuleText(x, t),
        })),
      },
      200,
    );
  };
}

export const manualReportDueRoute = createRoute({
  method: 'get',
  path: '/reports/manual-due',
  tags: ['reports'],
  summary: 'Срок разового вида по дате события до сохранения «Разового отчёта»',
  middleware: [requirePermission('changeStatus')] as const,
  request: { query: ManualReportDueQuery },
  responses: {
    200: {
      description: 'Срок по правилу вида и статусу контрагента; у вида не разового — пусто',
      content: { 'application/json': { schema: ManualReportDue } },
    },
    400: { description: 'Неверные данные: контрагент, вид или дата события', content: error },
    401: { description: 'Нет входа', content: error },
    403: noRight,
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

export function manualReportDueHandler(
  deps: ApiDeps,
): RouteHandler<typeof manualReportDueRoute, AppEnv> {
  return async (c) => {
    const query = c.req.valid('query');
    const due = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      manualReportDue(tx, query, { today: todayOf(deps), scope: assigneeScopeOf(subjectOf(c)) }),
    );
    return c.json({ due }, 200);
  };
}
