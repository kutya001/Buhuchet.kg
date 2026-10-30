import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { safeErrorMessage } from '@buhuchet/adapters/logger';
import {
  adminCalendarAdd,
  adminCalendarCopy,
  adminCalendarDelete,
  claimDuesRecalc,
  cleanupDuesRecalcs,
  DUES_RECALC_ATTEMPTS,
  dictValueTakenField,
  dueCatalog,
  enqueueDuesRecalc,
  finishDuesRecalc,
  redueAllOrgs,
  releaseRateLimit,
  rollbackDictLoad,
  takeRateLimit,
  withUserContext,
  type CatalogRedueTexts,
  type DueCatalog,
  type DuesRecalcTask,
  type RateLimit,
  type RedueScope,
  type Tx,
} from '@buhuchet/db';
import { bishkekDate } from '@buhuchet/domain';
import {
  AdminCalendarAddForm,
  AdminCalendarDayParam,
  AdminDictDeleteQuery,
  AdminDictLoadIdParam,
  AdminDuesPreview,
  ApiError,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps, Job, JobContext } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Пересчёт сроков несданных отчётов после правки каталога (задача 2.37; ТЗ «Если изменение каталога
 * влияет на сроки уже созданных отчётов, система показывает, сколько несданных отчётов в скольких
 * организациях изменится, и пересчитывает только их»; Issue «фоновой работой с пределом времени,
 * безопасно при повторе»). Предпросмотр для окон правки — правка в транзакции администратора, которая
 * откатывается, и счёт по прочитанному в ней каталогу, поэтому число в окне совпадает с пересчётом.
 * Пересчёт — через очередь (docs/decisions.md п. Д-9): правка ставит его в очередь своей транзакцией,
 * сразу после сохранения он идёт до `INLINE_MS`, остальное догоняет задача по расписанию.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/** Ответы предпросмотра сверх 200: неверный запрос, очередь предпросмотров, долгий запрос к базе. */
export const duesPreviewResponses = {
  400: { description: 'Неверные параметры или тело запроса', content: error },
  429: {
    description: 'Идёт прежний предпросмотр пользователя или за час их уже слишком много',
    content: error,
  },
  503: { description: 'Запрос к базе дольше предела', content: error },
  ...denied,
} as const;

const todayOf = (deps: JobContext) => bishkekDate(deps.clock.now());

/** Причины в истории отчёта: у статуса — как при установке статуса у контрагента. */
export async function redueTexts(deps: JobContext): Promise<CatalogRedueTexts> {
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

/** Предпросмотр обходит организации не дольше минуты, иначе 503 (аренда слота — дольше). */
const PREVIEW_MS = 60_000;

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
    until: Date.now() + PREVIEW_MS,
  });
  return { reports, orgs };
}

/**
 * Предпросмотры одного администратора: один одновременно и не больше 600 за час — каждый обходит все
 * организации. Неотпущенный (сбой процесса) перестаёт мешать через 2 минуты.
 */
export const DUES_PREVIEW_RATE_LIMIT: RateLimit = {
  kind: 'dues-preview',
  max: 600,
  windowSeconds: 3600,
  leaseSeconds: 120,
};

/** Предпросмотр по очереди: идёт прежний — 429 `dues_preview_busy`, предел за час — `dues_preview_limit`. */
export async function withPreviewSlot<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  run: () => Promise<T>,
): Promise<T> {
  const userId = c.get('session')!.userId;
  const slot = await takeRateLimit(deps.db, DUES_PREVIEW_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy') apiFail(429, 'dues_preview_busy', 'Предыдущий расчёт ещё идёт');
    apiFail(429, 'dues_preview_limit', 'Слишком много расчётов за час', {
      n: DUES_PREVIEW_RATE_LIMIT.max,
    });
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, DUES_PREVIEW_RATE_LIMIT, userId, slot.ticket).catch(
      (err: unknown) => deps.logger.error({ err }, 'предпросмотр сроков не отпущен'),
    );
  }
}

/** Правка в транзакции администратора, которая откатывается: что пересчитать и каталог после неё. */
class DryRun extends Error {
  constructor(readonly found: { scope: RedueScope | null; catalog: DueCatalog } | null) {
    super('dry run');
  }
}

/**
 * Сколько изменится после правки `edit` (`false` — правка не прошла): её запись откатывается, счёт —
 * по каталогу после неё. Такое же название успели сохранить — тоже нули: «Сохранить» скажет об этом.
 */
export async function countEdit(
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
    if (dictValueTakenField(err)) return NO_DUES;
    if (!(err instanceof DryRun)) throw err;
    return err.found ? previewDues(deps, err.found.scope, err.found.catalog) : NO_DUES;
  }
  throw new Error('предпросмотр без результата');
}

/** Предпросмотр окна: `countEdit` по очереди предпросмотров пользователя. */
export const previewEdit = (
  deps: ApiDeps,
  c: Context<AppEnv>,
  edit: (tx: Tx) => Promise<RedueScope | null | false>,
): Promise<AdminDuesPreview> => withPreviewSlot(deps, c, () => countEdit(deps, c, edit));

/* ───────────── Очередь пересчёта ───────────── */

/** Сколько пересчёт идёт сразу после сохранения; что не успело — догоняет задача по расписанию. */
const INLINE_MS = 60_000;
/** Сколько идёт задача по расписанию за один запуск. */
const JOB_MS = 120_000;
/** Аренда строки очереди — дольше, чем живёт функция API (5 минут). */
const LEASE_SECONDS = 600;
/** Задача по расписанию берёт строки старше 2 минут: свежие проходят сразу после сохранения. */
const JOB_OLDER_THAN_SECONDS = 120;
/** Через сколько строку с ошибкой проходят снова. */
const RETRY_SECONDS = 300;

/** Итог пересчёта сразу после сохранения: сколько изменено и остался ли догон. */
export interface RecalcOutcome extends AdminDuesPreview {
  /** Пересчитано не везде: остальное догонит задача по расписанию. */
  pending: boolean;
}

/** Правка и её пересчёт в очереди — одной транзакцией: правка без пересчёта не сохраняется. */
export async function queued<T extends { ok: boolean; redue?: RedueScope | null }>(
  tx: Tx,
  result: T,
): Promise<T & { queued?: string }> {
  if (!result.ok || !result.redue) return result;
  return { ...result, queued: await enqueueDuesRecalc(tx, result.redue) };
}

/** Ошибка прохода — в журнал; последняя попытка — отдельной строкой: дальше строку не проходят. */
function logFailure(ctx: JobContext, task: DuesRecalcTask, fields: object, message: string) {
  ctx.logger.error(
    { dues: task.id, scope: task.scope.kind, attempt: task.attempts, ...fields },
    message,
  );
  if (task.attempts >= DUES_RECALC_ATTEMPTS) {
    ctx.logger.error(
      { dues: task.id, scope: task.scope.kind, attempts: task.attempts },
      'пересчёт сроков отчётов оставлен: попытки кончились',
    );
  }
}

/**
 * Проход строки очереди до момента `until` (с организации после прошлого прохода): пересчитано везде —
 * строка выполнена; кончилось время — освобождается для догона с места, где остановился; ошибка — в
 * журнал (класс и код, без значений запроса), повтор позже и с начала.
 */
async function runTask(
  ctx: JobContext,
  task: DuesRecalcTask,
  until: number,
): Promise<RecalcOutcome> {
  try {
    const summary = await redueAllOrgs(ctx.db, task.scope, todayOf(ctx), {
      write: true,
      texts: await redueTexts(ctx),
      until,
      after: task.after,
    });
    for (const { orgId, error: err } of summary.failed) {
      logFailure(ctx, task, { orgId, err }, 'сроки отчётов организации не пересчитаны');
    }
    const [first] = summary.failed;
    const pending = summary.left > 0 || first !== undefined;
    await finishDuesRecalc(ctx.db, task, {
      done: !pending,
      reports: summary.reports,
      orgs: summary.orgs,
      error: first ? safeErrorMessage(first.error) : null,
      after: summary.last,
      retryAfterSeconds: first ? RETRY_SECONDS : 0,
    });
    return { reports: summary.reports, orgs: summary.orgs, pending };
  } catch (err) {
    logFailure(ctx, task, { err }, 'пересчёт сроков отчётов не прошёл');
    await finishDuesRecalc(ctx.db, task, {
      done: false,
      reports: 0,
      orgs: 0,
      error: safeErrorMessage(err),
      retryAfterSeconds: RETRY_SECONDS,
    }).catch((e: unknown) => ctx.logger.error({ dues: task.id, err: e }, 'очередь не отмечена'));
    return { ...NO_DUES, pending: true };
  }
}

/**
 * Пересчёт сразу после сохранения правки (строка очереди `id` из `queued`): до `INLINE_MS`, остальное —
 * задачей по расписанию. Без строки (правка сроки не меняет) — нули.
 */
export async function recalcQueued(deps: ApiDeps, id: string | undefined): Promise<RecalcOutcome> {
  if (!id) return { ...NO_DUES, pending: false };
  let task: DuesRecalcTask | null;
  try {
    task = await claimDuesRecalc(deps.db, { id, leaseSeconds: LEASE_SECONDS });
  } catch (err) {
    // Правка уже сохранена: строку догонит задача по расписанию.
    deps.logger.error({ dues: id, err }, 'пересчёт сроков отчётов не начат');
    return { ...NO_DUES, pending: true };
  }
  // Строку уже взяла задача по расписанию — пересчёт идёт там.
  if (!task) return { ...NO_DUES, pending: true };
  return runTask(deps, task, Date.now() + INLINE_MS);
}

/**
 * Догон очереди пересчёта (Issue «фоновой работой с пределом времени, безопасно при повторе»): каждые
 * 5 минут строки, которые не довели до конца сразу после сохранения (кончилось время, ошибка базы,
 * функцию оборвали), проходятся заново до `JOB_MS`; выполненные старше 30 дней удаляются.
 */
export const duesRecalcJob: Job = {
  name: 'platform-dicts.dues-recalc',
  cron: '*/5 * * * *',
  lookbackMinutes: 5,
  async run(ctx) {
    await cleanupDuesRecalcs(ctx.db, 30);
    const until = Date.now() + JOB_MS;
    while (Date.now() < until) {
      const task = await claimDuesRecalc(ctx.db, {
        leaseSeconds: LEASE_SECONDS,
        olderThanSeconds: JOB_OLDER_THAN_SECONDS,
      });
      if (!task) return;
      const outcome = await runTask(ctx, task, until);
      ctx.logger.info(
        { job: 'platform-dicts.dues-recalc', dues: task.id, ...outcome },
        'сроки отчётов пересчитаны по очереди',
      );
    }
  },
};

/* ───────────── Предпросмотры календаря и отката загрузки ───────────── */

const CAL = '/admin/platform-dicts/calendar';
const CALENDAR = { kind: 'calendar' } as const;

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
    ...duesPreviewResponses,
  },
});

export function adminCalendarAddDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarAddDuesRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const preview = await previewEdit(deps, c, async (tx) =>
      (await adminCalendarAdd(tx, input, todayOf(deps))).ok ? CALENDAR : false,
    );
    return c.json(preview, 200);
  };
}

export const adminCalendarCopyDuesRoute = createRoute({
  method: 'post',
  path: `${CAL}/copy/dues-preview`,
  tags: ['platform-dicts'],
  summary: 'Предпросмотр копирования календаря: у скольких несданных отчётов изменятся сроки',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Отчёты и организации; календарь не копируется. Копировать нечего — нули',
      content: json(AdminDuesPreview),
    },
    ...duesPreviewResponses,
  },
});

export function adminCalendarCopyDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarCopyDuesRoute, AppEnv> {
  return async (c) => {
    const preview = await previewEdit(deps, c, async (tx) => {
      const copied = await adminCalendarCopy(tx, todayOf(deps));
      return copied.ok && copied.copied > 0 ? CALENDAR : false;
    });
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
    ...duesPreviewResponses,
  },
});

export function adminCalendarDeleteDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof adminCalendarDeleteDuesRoute, AppEnv> {
  return async (c) => {
    const { key } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const preview = await previewEdit(deps, c, async (tx) =>
      (await adminCalendarDelete(tx, key, version)).ok ? CALENDAR : false,
    );
    return c.json(preview, 200);
  };
}

export const dictLoadRollbackDuesRoute = createRoute({
  method: 'post',
  path: '/admin/platform-dict-loads/{id}/dues-preview',
  tags: ['platform-dicts'],
  summary: 'Предпросмотр отката загрузки: у скольких несданных отчётов изменятся сроки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminDictLoadIdParam },
  responses: {
    200: {
      description: 'Отчёты и организации; загрузка не откатывается. Откатить нельзя — нули',
      content: json(AdminDuesPreview),
    },
    ...duesPreviewResponses,
  },
});

/** Вопрос «Откатить последнюю загрузку?»: тот же откат в транзакции, которая откатывается. */
export function dictLoadRollbackDuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof dictLoadRollbackDuesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const preview = await previewEdit(deps, c, async (tx) => {
      const rolled = await rollbackDictLoad(tx, id);
      return rolled.ok ? rolled.redue : false;
    });
    return c.json(preview, 200);
  };
}
