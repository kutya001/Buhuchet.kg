import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  exportProjects,
  listProjectsPage,
  listProjectValues,
  projectSummary,
  type ProjectListOptions,
  type ProjectRow,
  type ProjectTab,
} from '@buhuchet/db';
import { hasPermission, type AccessSubject, type Feature } from '@buhuchet/domain';
import {
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  ProjectList,
  ProjectSummary,
  ProjectTabParam,
  type ProjectRow as ProjectRowBody,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePermission } from '../../middleware/access';
import { subjectOf, todayOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import {
  canKeepProjects,
  canTaskProjects,
  error,
  inProjects,
  json,
  off,
  projectMoneyVisible,
  projectViewerOf,
  unauthorized,
} from './common';

/*
 * Список «Проекты контрагентов» (задача 2.26; прототип modules/projects.js `projTabs`, `projCols`,
 * `renderProjects`): вкладки «Активные», «Все», «Мои», плашки, значения фильтра, выгрузка в Excel.
 * Видит модуль право «Просматривать проекты»; какие проекты — `projectVisibility` (прототип
 * `projVisible`). Денежные столбцы — только тому, кто видит деньги проектов (прототип `moneyVis`).
 */

async function listOptions(
  deps: ApiDeps,
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  tab: ProjectTab,
): Promise<ProjectListOptions> {
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    viewer: projectViewerOf(subject),
    tab,
    money: projectMoneyVisible(subject, features),
  };
}

const rowBody = (r: ProjectRow): ProjectRowBody => ({
  ...r,
  audit: {
    createdAt: r.audit.createdAt.toISOString(),
    createdBy: r.audit.createdBy,
    updatedAt: r.audit.updatedAt.toISOString(),
    updatedBy: r.audit.updatedBy,
  },
});

export const listProjectsRoute = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['projects'],
  summary: 'Проекты контрагентов: страница списка',
  middleware: [requirePermission('projView')] as const,
  request: { query: ListQueryParams.extend(ProjectTabParam.shape) },
  responses: {
    200: {
      description:
        'Страница списка проектов вкладки; сортировка, фильтры, поиск и группы — на сервере',
      content: json(ProjectList),
    },
    ...listQueryResponses,
    401: unauthorized,
    403: off('«Просматривать проекты»'),
  },
});

export function listProjectsHandler(deps: ApiDeps): RouteHandler<typeof listProjectsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const subject = subjectOf(c);
    const page = await inProjects(deps, c, async (tx, features) =>
      listProjectsPage(
        tx,
        listQueryOf(params),
        await listOptions(deps, subject, features, params.tab),
      ),
    );
    return c.json(
      {
        items: page.rows.map(rowBody),
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

export const projectSummaryRoute = createRoute({
  method: 'get',
  path: '/projects/summary',
  tags: ['projects'],
  summary: 'Счётчики вкладок и плашки проектов',
  middleware: [requirePermission('projView')] as const,
  responses: {
    200: {
      description:
        'Активные, мои активные, в работе, планируются, срок прошёл, осталось получить; что сотрудник может',
      content: json(ProjectSummary),
    },
    401: unauthorized,
    403: off('«Просматривать проекты»'),
  },
});

export function projectSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectSummaryRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const out = await inProjects(deps, c, async (tx, features) => {
      const money = projectMoneyVisible(subject, features);
      const s = await projectSummary(tx, projectViewerOf(subject), todayOf(deps), money);
      return {
        ...s,
        can: {
          keep: canKeepProjects(subject),
          rollback: hasPermission(subject, 'rollback'),
          task: canTaskProjects(subject, features),
          money,
        },
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  };
}

export const projectValuesRoute = createRoute({
  method: 'get',
  path: '/projects/values',
  tags: ['projects'],
  summary: 'Значения столбца списка проектов для фильтра',
  middleware: [requirePermission('projView')] as const,
  request: { query: ListValuesQuery.extend(ProjectTabParam.shape) },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом проектов вкладки',
      content: json(ListValues),
    },
    ...listQueryResponses,
    401: unauthorized,
    403: off('«Просматривать проекты»'),
  },
});

export function projectValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, tab } = c.req.valid('query');
    const subject = subjectOf(c);
    const values = await inProjects(deps, c, async (tx, features) =>
      listProjectValues(tx, col, await listOptions(deps, subject, features, tab), q),
    );
    return c.json(values, 200);
  };
}

export const exportProjectsRoute = createRoute({
  method: 'get',
  path: '/projects/export',
  tags: ['projects'],
  summary: 'Проекты в Excel',
  middleware: [requirePermission('projView'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(ProjectTabParam.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми проектами вкладки под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: unauthorized,
    403: {
      description: 'Нет права «Выгружать в Excel» или «Просматривать проекты»; проекты выключены',
      content: error,
    },
  },
});

export function exportProjectsHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportProjectsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const subject = subjectOf(c);
    const keys = [...new Set(params.cols.split(','))];
    const t = await serverTexts(deps);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const result = await inProjects(
        deps,
        c,
        async (tx, features) =>
          exportProjects(
            tx,
            listQueryOf(params),
            keys,
            await listOptions(deps, subject, features, params.tab),
          ),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.projects'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}
