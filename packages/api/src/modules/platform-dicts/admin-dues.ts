import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminCalendarAdd,
  adminCalendarDelete,
  dueCatalog,
  redueAllOrgs,
  withUserContext,
  type CatalogRedueTexts,
  type DueCatalog,
  type DuesCounter,
  type RedueScope,
  type Tx,
} from '@buhuchet/db';
import { bishkekDate } from '@buhuchet/domain';
import {
  AdminCalendarAddForm,
  AdminCalendarDayParam,
  AdminDictDeleteQuery,
  AdminDuesPreview,
  ApiError,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Пересчёт сроков несданных отчётов после правки каталога (задача 2.37; ТЗ «Если изменение каталога
 * влияет на сроки уже созданных отчётов, система показывает, сколько несданных отчётов в скольких
 * организациях изменится, и пересчитывает только их»): предпросмотр для окон правки и пересчёт после
 * сохранения. Оба — `redueAllOrgs`: каждая организация своей транзакцией с пределом времени задач.
 * Предпросмотр — правка в транзакции администратора, которая откатывается, и счёт по прочитанному в
 * ней каталогу, поэтому число в окне совпадает с пересчётом.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

const todayOf = (deps: ApiDeps) => bishkekDate(deps.clock.now());

/** Причины в истории отчёта: у статуса — как при установке статуса у контрагента. */
export async function redueTexts(deps: ApiDeps): Promise<CatalogRedueTexts> {
  const t = await serverTexts(deps);
  return {
    byType: t('pdicts.dues.reason.type'),
    byCalendar: t('pdicts.dues.reason.calendar'),
    byStatus: t('report.reason.due_status'),
    byStatusDropped: t('report.reason.due_catalog_dropped'),
    byCatalog: t('report.reason.due_catalog'),
  };
}

const NO_DUES: AdminDuesPreview = { reports: 0, orgs: 0 };

/** Сколько несданных отчётов в скольких организациях изменится по каталогу `catalog`. */
export async function previewDues(
  deps: ApiDeps,
  scope: RedueScope | null,
  catalog: DueCatalog,
): Promise<AdminDuesPreview> {
  if (!scope) return NO_DUES;
  const texts = await redueTexts(deps);
  const { reports, orgs } = await redueAllOrgs(deps.db, scope, todayOf(deps), {
    write: false,
    texts,
    catalog,
  });
  return { reports, orgs };
}

/** Счёт для истории статуса («сроки по статусу пересчитаны у N отчётов») по каталогу транзакции. */
export function duesCounter(deps: ApiDeps): DuesCounter {
  return async (tx, scope) => (await previewDues(deps, scope, await dueCatalog(tx))).reports;
}

/**
 * Пересчёт после сохранения правки: у скольких отчётов в скольких организациях изменился срок.
 * Организация, где пересчёт не прошёл и со второй попытки, — в журнал; повтор пересчёта безопасен.
 */
export async function recalcDues(
  deps: ApiDeps,
  scope: RedueScope | null | undefined,
): Promise<AdminDuesPreview> {
  if (!scope) return NO_DUES;
  const summary = await redueAllOrgs(deps.db, scope, todayOf(deps), {
    write: true,
    texts: await redueTexts(deps),
  });
  if (summary.failed.length) {
    deps.logger.error(
      { scope: scope.kind, failed: summary.failed },
      'сроки отчётов не пересчитаны в части организаций',
    );
  }
  return { reports: summary.reports, orgs: summary.orgs };
}

/** Правка в транзакции администратора, которая откатывается: что пересчитать и каталог после неё. */
class DryRun extends Error {
  constructor(readonly found: { scope: RedueScope | null; catalog: DueCatalog } | null) {
    super('dry run');
  }
}

/** Предпросмотр правки `edit`: её запись откатывается, счёт — по каталогу после неё. */
export async function previewEdit(
  deps: ApiDeps,
  c: Context<AppEnv>,
  edit: (tx: Tx) => Promise<RedueScope | null | false>,
): Promise<AdminDuesPreview> {
  try {
    await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const scope = await edit(tx);
      throw new DryRun(scope === false ? null : { scope, catalog: await dueCatalog(tx) });
    });
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
    return err.found ? previewDues(deps, err.found.scope, err.found.catalog) : NO_DUES;
  }
  throw new Error('предпросмотр без результата');
}

const CAL = '/admin/platform-dicts/calendar';

export const adminCalendarAddDuesRoute = createRoute({
  method: 'post',
  path: `${CAL}/dues-preview`,
  tags: ['platform-dicts'],
  summary: 'Предпросмотр «Нерабочего дня»: у скольких несданных отчётов изменятся сроки',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminCalendarAddForm) } },
  responses: {
    200: {
      description: 'Отчёты и организации; день не сохраняется. День с ошибкой — нули',
      content: json(AdminDuesPreview),
    },
    ...denied,
  },
});

export function adminCalendarAddDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarAddDuesRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const preview = await previewEdit(deps, c, async (tx) =>
      (await adminCalendarAdd(tx, input, todayOf(deps))).ok ? { kind: 'calendar' } : false,
    );
    return c.json(preview, 200);
  };
}

export const adminCalendarDeleteDuesRoute = createRoute({
  method: 'post',
  path: `${CAL}/{key}/dues-preview`,
  tags: ['platform-dicts'],
  summary: 'Предпросмотр удаления дня: у скольких несданных отчётов изменятся сроки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminCalendarDayParam, query: AdminDictDeleteQuery },
  responses: {
    200: {
      description: 'Отчёты и организации; день не удаляется. Удалить нельзя — нули',
      content: json(AdminDuesPreview),
    },
    ...denied,
  },
});

export function adminCalendarDeleteDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarDeleteDuesRoute, AppEnv> {
  return async (c) => {
    const { key } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const preview = await previewEdit(deps, c, async (tx) =>
      (await adminCalendarDelete(tx, key, version)).ok ? { kind: 'calendar' } : false,
    );
    return c.json(preview, 200);
  };
}
