import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { calendarOf, orgMenuSettings, reportCalendarCounts, withOrgContext } from '@buhuchet/db';
import { calendarGrid, holidayName, isWorkingDay } from '@buhuchet/domain';
import { ReportCalendar, ReportCalendarQuery } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { subjectOf } from '../contractors/common';
import { error, reportScopeOf } from './common';

/*
 * Вкладка «Календарь» модуля «Отчеты для сдачи» (задача 2.15; ТЗ «Вкладки модуля» → «Календарь»;
 * прототип modules/reports.js, `renderCalendar`): дни месяца с числами отчётов. Список дня —
 * `GET /api/reports?tab=calendar&day=…`.
 */

export const reportCalendarRoute = createRoute({
  method: 'get',
  path: '/reports/calendar',
  tags: ['reports'],
  summary: 'Календарь отчётов на месяц',
  middleware: [requirePermission('repView')] as const,
  request: { query: ReportCalendarQuery },
  responses: {
    200: {
      description:
        '42 дня с понедельника недели первого числа: рабочий ли день, праздник, к сдаче, сдано, оплат',
      content: { 'application/json': { schema: ReportCalendar } },
    },
    400: { description: 'Неверный месяц', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Просматривать отчёты» или «Календарь отчётов» выключен',
      content: error,
    },
  },
});

/**
 * Числа — в области сотрудника (прототип visReports); «оплат» — только при «Учёте оплаты налогов».
 * Выключенная в учётной политике функция «Календарь отчётов» скрывает вкладку и закрывает метод.
 */
export function reportCalendarHandler(
  deps: ApiDeps,
): RouteHandler<typeof reportCalendarRoute, AppEnv> {
  return async (c) => {
    const { month } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const days = calendarGrid(month);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const { features } = await orgMenuSettings(tx, ctx.orgId);
      if (!features.calendar) {
        apiFail(403, 'calendar_off', 'Календарь отчётов выключен в учётной политике');
      }
      const [counts, calendar] = await Promise.all([
        reportCalendarCounts(tx, {
          from: days[0]!,
          to: days.at(-1)!,
          scope: reportScopeOf(subjectOf(c)),
          taxpay: features.taxpay,
        }),
        calendarOf(tx),
      ]);
      return {
        month,
        days: days.map((date) => ({
          date,
          working: isWorkingDay(calendar, date),
          holiday: holidayName(calendar, date),
          todo: counts.get(date)?.todo ?? 0,
          done: counts.get(date)?.done ?? 0,
          pay: counts.get(date)?.pay ?? 0,
        })),
      };
    });
    return c.json(body, 200);
  };
}
