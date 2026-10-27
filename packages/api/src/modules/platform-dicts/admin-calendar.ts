import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminCalendarAdd,
  adminCalendarCopy,
  adminCalendarCopyPlan,
  adminCalendarDelete,
  exportAdminCalendar,
  listAdminCalendarPage,
  listAdminCalendarValues,
  withUserContext,
  type AdminCalendarDayRecord,
} from '@buhuchet/db';
import {
  bishkekDate,
  calendarAdminYears,
  RecordChangedError,
  RecordNotFoundError,
  type CalendarAddProblem,
} from '@buhuchet/domain';
import {
  AdminCalendarAddForm,
  AdminCalendarChanged,
  AdminCalendarCopied,
  AdminCalendarCopyPlan,
  AdminCalendarDayParam,
  AdminCalendarList,
  AdminDictDeleteQuery,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type AdminCalendarDay,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Справочники платформы» → «Календарь» (задача 2.36; ТЗ «Производственный календарь КР»;
 * прототип renderPDicts, holidayDlg, calCopyDlg): дни текущего и следующего года, значения фильтра,
 * «В Excel», «Нерабочий день», «Удалить» и «Календарь на следующий год копированием». Только
 * администратору платформы. Адреса без кода справочника — раньше общих `/admin/platform-dicts/{dict}`.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

const P = '/admin/platform-dicts/calendar';

const adminTx = <T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: Parameters<typeof withUserContext<T>>[2],
) => withUserContext(deps.db, c.get('session')!.userId, fn);

/** «Сегодня» по Бишкеку: годы вкладки — текущий и следующий. */
const todayOf = (deps: ApiDeps) => bishkekDate(deps.clock.now());

function dayBody(x: AdminCalendarDayRecord): AdminCalendarDay {
  return {
    key: x.key,
    date: x.date,
    kind: x.kind,
    name: x.name,
    everyYear: x.everyYear,
    audit: {
      createdAt: x.audit.createdAt?.toISOString() ?? null,
      createdBy: x.audit.createdBy,
      updatedAt: x.audit.updatedAt.toISOString(),
      updatedBy: x.audit.updatedBy,
    },
    version: x.version,
  };
}

export const listAdminCalendarRoute = createRoute({
  method: 'get',
  path: P,
  tags: ['platform-dicts'],
  summary: 'Производственный календарь в Админке: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Дни текущего и следующего года по Бишкеку; поиск, фильтры и группы — на сервере',
      content: json(AdminCalendarList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function listAdminCalendarHandler(
  deps: ApiDeps,
): RouteHandler<typeof listAdminCalendarRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await adminTx(deps, c, (tx) => listAdminCalendarPage(tx, query, t, todayOf(deps)));
    return c.json(
      {
        items: page.rows.map(dayBody),
        year: page.year,
        nextFilled: page.nextFilled,
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

export const adminCalendarValuesRoute = createRoute({
  method: 'get',
  path: `${P}/values`,
  tags: ['platform-dicts'],
  summary: 'Значения столбца календаря для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function adminCalendarValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await adminTx(deps, c, (tx) =>
      listAdminCalendarValues(tx, col, t, todayOf(deps), q),
    );
    return c.json(values, 200);
  };
}

export const exportAdminCalendarRoute = createRoute({
  method: 'get',
  path: `${P}/export`,
  tags: ['platform-dicts'],
  summary: 'Производственный календарь в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с днями под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportAdminCalendarHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportAdminCalendarRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminCalendar(tx, query, keys, t, todayOf(deps)),
        'export',
      );
      return xlsxResponse(c, {
        title: t('dicts.platform.dict.calendar'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        t,
      });
    });
  };
}

/** Отказ «Нерабочего дня» — 400 под полем окна (прототип holidayDlg). */
const PROBLEM: Readonly<Record<CalendarAddProblem['code'], string>> = {
  date_required: 'Укажите дату',
  date_year: 'Дата — в текущем или следующем году',
  not_saturday: 'Рабочая суббота — только суббота',
  date_taken: 'Эта дата уже есть в календаре',
  name_required: 'Введите название праздника',
};

export const addAdminCalendarDayRoute = createRoute({
  method: 'post',
  path: P,
  tags: ['platform-dicts'],
  summary: '«Нерабочий день»: праздник, перенос или рабочая суббота',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminCalendarAddForm) } },
  responses: {
    201: {
      description: 'День добавлен; у скольких несданных отчётов пересчитан срок',
      content: json(AdminCalendarChanged),
    },
    400: {
      description:
        'Нет даты или названия праздника, дата не в текущем или следующем году, рабочая суббота не в субботу, дата уже есть',
      content: error,
    },
    ...denied,
  },
});

export function addAdminCalendarDayHandler(
  deps: ApiDeps,
): RouteHandler<typeof addAdminCalendarDayRoute, AppEnv> {
  return async (c) => {
    const today = todayOf(deps);
    const result = await adminTx(deps, c, (tx) => adminCalendarAdd(tx, c.req.valid('json'), today));
    if (result.ok) return c.json({ recalculated: result.recalculated }, 201);
    if (result.reason === 'not_found') throw new RecordNotFoundError('platform_dict', 'calendar');
    const problem = result.problems[0]!;
    const [year, next] = calendarAdminYears(today);
    return apiFail(400, `calendar_${problem.code}`, PROBLEM[problem.code], {
      field: problem.field,
      ...(problem.code === 'date_year' ? { y: year, next } : {}),
    });
  };
}

export const deleteAdminCalendarDayRoute = createRoute({
  method: 'delete',
  path: `${P}/{key}`,
  tags: ['platform-dicts'],
  summary: 'Удалить день календаря',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminCalendarDayParam, query: AdminDictDeleteQuery },
  responses: {
    204: { description: 'Удалено; сроки несданных отчётов пересчитаны' },
    404: { description: 'Нет такого дня', content: error },
    409: {
      description: 'Государственный праздник «каждый год» или день изменён другим пользователем',
      content: error,
    },
    ...denied,
  },
});

/** «Удалить»: праздник «каждый год» — 409 `calendar_day_fixed` (прототип). */
export function deleteAdminCalendarDayHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteAdminCalendarDayRoute, AppEnv> {
  return async (c) => {
    const { key } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const result = await adminTx(deps, c, (tx) => adminCalendarDelete(tx, key, version));
    if (result.ok) return c.body(null, 204);
    if (result.reason === 'fixed') {
      apiFail(409, 'calendar_day_fixed', 'Государственный праздник по закону, удалить нельзя');
    }
    if (result.reason === 'changed') {
      throw new RecordChangedError('platform_dict', key, result.version);
    }
    throw new RecordNotFoundError('platform_dict', `calendar:${key}`);
  };
}

export const adminCalendarCopyPlanRoute = createRoute({
  method: 'get',
  path: `${P}/copy`,
  tags: ['platform-dicts'],
  summary: 'Что скопирует «Календарь на следующий год копированием»',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Год, в который копируется, и дни текущего года «только в этом году»',
      content: json(AdminCalendarCopyPlan),
    },
    ...denied,
  },
});

export function adminCalendarCopyPlanHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarCopyPlanRoute, AppEnv> {
  return async (c) => {
    const plan = await adminTx(deps, c, (tx) => adminCalendarCopyPlan(tx, todayOf(deps)));
    return c.json(plan, 200);
  };
}

export const adminCalendarCopyRoute = createRoute({
  method: 'post',
  path: `${P}/copy`,
  tags: ['platform-dicts'],
  summary: 'Создать календарь следующего года копированием текущего',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Сколько дней скопировано; у скольких несданных отчётов пересчитан срок',
      content: json(AdminCalendarCopied),
    },
    ...denied,
  },
});

export function adminCalendarCopyHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarCopyRoute, AppEnv> {
  return async (c) => {
    const result = await adminTx(deps, c, (tx) => adminCalendarCopy(tx, todayOf(deps)));
    if (!result.ok) throw new RecordNotFoundError('platform_dict', 'calendar');
    const { ok: _, ...body } = result;
    return c.json(body, 200);
  };
}
