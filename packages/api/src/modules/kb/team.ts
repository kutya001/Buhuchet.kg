import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  exportKbTeam,
  kbTeam,
  listKbTeamPage,
  listKbTeamValues,
  withOrgContext,
} from '@buhuchet/db';
import { hasPermission } from '@buhuchet/domain';
import {
  ApiError,
  KbMemberProgress,
  KbTeamList,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { progressBody } from './state';

const error = { 'application/json': { schema: ApiError } };
const noRight = { description: 'Нет права «Видеть уровни сотрудников»', content: error };

export const kbTeamRoute = createRoute({
  method: 'get',
  path: '/kb/team',
  tags: ['kb'],
  summary: '«Уровни сотрудников»: страница списка',
  middleware: [requirePermission('kbLevels')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Уровень, процент и шаги каждого сотрудника организации',
      content: { 'application/json': { schema: KbTeamList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noRight,
  },
});

/**
 * Вкладка «Уровни сотрудников» (ТЗ: видят владелец и роль с правом «Видеть уровни сотрудников»):
 * уровни считаются на сервере по программе каждого сотрудника, список — общим механизмом.
 */
export function kbTeamHandler(deps: ApiDeps): RouteHandler<typeof kbTeamRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const ctx = orgContextOf(c);
    const page = await withOrgContext(deps.db, ctx, (tx) =>
      listKbTeamPage(tx, ctx.orgId, query, t),
    );
    return c.json(
      {
        items: page.rows.map((r) => ({
          id: r.id!,
          fullName: r.fullName!,
          role: r.role!,
          active: r.active!,
          level: Number(r.level),
          levelName: r.levelName!,
          of: Number(r.levels),
          pct: Number(r.pct),
          done: Number(r.done),
          total: Number(r.total),
          levelAt: r.levelAt ?? null,
        })),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const kbTeamValuesRoute = createRoute({
  method: 'get',
  path: '/kb/team/values',
  tags: ['kb'],
  summary: 'Значения столбца «Уровней сотрудников» для фильтра',
  middleware: [requirePermission('kbLevels')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с числом записей',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: noRight,
  },
});

export function kbTeamValuesHandler(deps: ApiDeps): RouteHandler<typeof kbTeamValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const ctx = orgContextOf(c);
    const values = await withOrgContext(deps.db, ctx, (tx) =>
      listKbTeamValues(tx, ctx.orgId, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const kbTeamExportRoute = createRoute({
  method: 'get',
  path: '/kb/team/export',
  tags: ['kb'],
  summary: '«Уровни сотрудников» в Excel',
  middleware: [requirePermission('kbLevels'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Видеть уровни сотрудников» или «Выгружать в Excel»',
      content: error,
    },
  },
});

export function kbTeamExportHandler(deps: ApiDeps): RouteHandler<typeof kbTeamExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = orgContextOf(c);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await withOrgContext(deps.db, { ...ctx, kind: 'export' }, (tx) =>
        exportKbTeam(tx, ctx.orgId, query, keys, t),
      );
      return xlsxResponse(c, {
        title: t('tab.kb.team'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

export const kbMemberRoute = createRoute({
  method: 'get',
  path: '/kb/employees/{id}',
  tags: ['kb'],
  summary: 'Уровень знаний сотрудника',
  middleware: [requireEmployee] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Уровень, прогресс по модулям и полученные уровни',
      content: { 'application/json': { schema: KbMemberProgress } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Чужой уровень — только с правом «Видеть уровни сотрудников»',
      content: error,
    },
    404: { description: 'Сотрудника нет в организации', content: error },
  },
});

/**
 * Блок «Уровень знаний» карточки сотрудника и окно «Прогресс по модулям» (прототип kbBox, kbUserDlg):
 * свой — всегда, чужой — с правом «Видеть уровни сотрудников».
 */
export function kbMemberHandler(deps: ApiDeps): RouteHandler<typeof kbMemberRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = c.get('access')!.subject;
    if (id !== subject.employeeId && !hasPermission(subject, 'kbLevels')) {
      apiFail(403, 'forbidden', 'Нет права на это действие');
    }
    const ctx = orgContextOf(c);
    const [member] = await withOrgContext(deps.db, ctx, (tx) => kbTeam(tx, ctx.orgId, [id]));
    if (!member) apiFail(404, 'not_found', 'Сотрудник не найден');
    return c.json(
      {
        employeeId: member.member.employeeId,
        fullName: member.member.fullName,
        role: member.member.roleName,
        progress: progressBody(member.stats, member.levels, member.reached),
      },
      200,
    );
  };
}
