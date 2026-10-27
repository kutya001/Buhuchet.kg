import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportTasks,
  listTasksPage,
  listTaskValues,
  taskPendingStats,
  taskTabCounts,
  withOrgContext,
  type TaskListOptions,
  type TaskTab,
} from '@buhuchet/db';
import { monthStart } from '@buhuchet/domain';
import {
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  TaskList,
  TaskSummary,
  TaskTabParam,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { error, requireTasks, rowBody, subjectOf, todayOf, viewerOf } from './common';

const off = { description: 'Задачи выключены в учётной политике', content: error };

/** Условия списка того, кто смотрит: его права, вкладка, сегодня по Бишкеку. */
async function listOptions(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tab: TaskTab,
): Promise<TaskListOptions> {
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    viewer: viewerOf(subjectOf(c)),
    tab,
  };
}

export const listTasksRoute = createRoute({
  method: 'get',
  path: '/tasks',
  tags: ['tasks'],
  summary: 'Задачи: страница списка',
  middleware: [requireEmployee] as const,
  request: { query: ListQueryParams.extend(TaskTabParam.shape) },
  responses: {
    200: {
      description:
        'Страница списка задач вкладки: с текущего месяца, вперёд и всё просроченное; сортировка, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: TaskList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: off,
  },
});

/**
 * Список задач (прототип modules/tasks.js, `renderTasks`): «Мои», «Поставленные мной», «Все» (право
 * «Видеть задачи всех»), «Просроченные». Свои задачи видят все сотрудники (ТЗ «Права»), поэтому
 * отдельного права у метода нет; чужие вкладки ничего лишнего не покажут — условие видимости в запросе.
 */
export function listTasksHandler(deps: ApiDeps): RouteHandler<typeof listTasksRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const o = await listOptions(deps, c, params.tab);
    const page = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await requireTasks(tx, orgContextOf(c).orgId);
      return listTasksPage(tx, query, o);
    });
    return c.json(
      {
        items: page.rows.map((r) => rowBody(r, o.today)),
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

export const taskSummaryRoute = createRoute({
  method: 'get',
  path: '/tasks/summary',
  tags: ['tasks'],
  summary: 'Счётчики вкладок и плашка «На подтверждении»',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description:
        'Мои открытые, поставленные мной открытые, просроченные; ждущие подтверждения и сколько из них можно подтвердить',
      content: { 'application/json': { schema: TaskSummary } },
    },
    401: { description: 'Нет входа', content: error },
    403: off,
  },
});

/** Числа вкладок и плашки (прототип `taskTabs`, `renderTasks`). */
export function taskSummaryHandler(deps: ApiDeps): RouteHandler<typeof taskSummaryRoute, AppEnv> {
  return async (c) => {
    const viewer = viewerOf(subjectOf(c));
    const today = todayOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await requireTasks(tx, orgContextOf(c).orgId);
      const [counts, pending] = await Promise.all([
        taskTabCounts(tx, viewer, today),
        taskPendingStats(tx, viewer),
      ]);
      return { ...counts, ...pending, monthStart: monthStart(today) };
    });
    return c.json(body, 200);
  };
}

export const taskValuesRoute = createRoute({
  method: 'get',
  path: '/tasks/values',
  tags: ['tasks'],
  summary: 'Значения столбца списка задач для фильтра',
  middleware: [requireEmployee] as const,
  request: { query: ListValuesQuery.extend(TaskTabParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом задач вкладки',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: off,
  },
});

/** Значения для фильтра-галочек: «Общие задачи» — первым в «Контрагенте» (ТЗ). */
export function taskValuesHandler(deps: ApiDeps): RouteHandler<typeof taskValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, tab } = c.req.valid('query');
    const o = await listOptions(deps, c, tab);
    const values = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await requireTasks(tx, orgContextOf(c).orgId);
      return listTaskValues(tx, col, o, { filters: {} }, q);
    });
    return c.json(values, 200);
  };
}

export const exportTasksRoute = createRoute({
  method: 'get',
  path: '/tasks/export',
  tags: ['tasks'],
  summary: 'Задачи в Excel',
  middleware: [requirePermission('export')] as const,
  request: { query: ListExportParams.extend(TaskTabParam.shape) },
  responses: {
    200: {
      description:
        'Файл Excel со всеми задачами вкладки под поиском и фильтрами; столбец «Вид задачи» — всегда (ТЗ)',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Выгружать в Excel» или задачи выключены', content: error },
  },
});

/**
 * Выгрузка в Excel: видимые столбцы по порядку экрана и отдельная колонка «Вид задачи», даже если
 * её нет на экране (ТЗ «В выгрузке в Excel — отдельная колонка «Вид задачи»»).
 */
export function exportTasksHandler(deps: ApiDeps): RouteHandler<typeof exportTasksRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const cols = [...new Set(params.cols.split(','))];
    const keys = cols.includes('scope') ? cols : [...cols, 'scope'];
    const o = await listOptions(deps, c, params.tab);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const result = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) => {
          await requireTasks(tx, orgContextOf(c).orgId);
          return exportTasks(tx, query, keys, o);
        },
      );
      return xlsxResponse(c, {
        title: o.t('nav.tasks'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t: o.t,
      });
    });
  };
}
