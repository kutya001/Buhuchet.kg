import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminSetTelegramBotRich,
  adminTelegramBroadcast,
  adminTelegramOrgs,
  adminTelegramRetry,
  adminTelegramSummary,
  exportAdminTelegramLog,
  listAdminTelegramLogPage,
  listAdminTelegramLogValues,
  telegramBotRich,
  withUserContext,
  type AdminTelegramLogRecord,
} from '@buhuchet/db';
import { bishkekDate, webhookState } from '@buhuchet/domain';
import {
  AdminTelegramBot,
  AdminTelegramBotView,
  AdminTelegramBroadcastRequest,
  AdminTelegramBroadcastResult,
  AdminTelegramLogList,
  type AdminTelegramLogRow,
  AdminTelegramOrgs,
  AdminTelegramRetryRequest,
  AdminTelegramRetryResult,
  AdminTelegramSummary,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41,
 * docs/decisions.md п. Д-13): журнал отправок всех организаций с повтором, состояние вебхука бота
 * платформы и рассылка объявлений. Только администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

/** Строка журнала для ответа API: без текста сообщения и номера чата, моменты — строкой ISO. */
function logRowBody(r: AdminTelegramLogRecord): AdminTelegramLogRow {
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    recipient: r.recipient,
    orgId: r.orgId,
    orgName: r.orgName,
    kind: r.kind,
    status: r.status,
    tries: r.tries,
    error: r.lastError,
  };
}

export const telegramLogRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log',
  tags: ['admin'],
  summary: 'Журнал отправок Telegram всех организаций: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Страница журнала: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: json(AdminTelegramLogList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** «Журнал» (прототип grid 'tg-log'): сообщения всех организаций и платформы, сначала новые. */
export function telegramLogHandler(deps: ApiDeps): RouteHandler<typeof telegramLogRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminTelegramLogPage(tx, query, t, deps.config.APP_ENV === 'staging'),
    );
    return c.json(
      {
        items: page.rows.map(logRowBody),
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

export const telegramLogValuesRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/values',
  tags: ['admin'],
  summary: 'Значения столбца журнала Telegram для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём журнале',
      content: json(ListValues),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function telegramLogValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramLogValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminTelegramLogValues(tx, col, t, q, deps.config.APP_ENV === 'staging'),
    );
    return c.json(values, 200);
  };
}

export const telegramLogExportRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/export',
  tags: ['admin'],
  summary: 'Журнал отправок Telegram в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function telegramLogExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramLogExportRoute, AppEnv> {
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
        (tx) => exportAdminTelegramLog(tx, query, keys, t, deps.config.APP_ENV === 'staging'),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.telegram'),
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

export const telegramSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/log/summary',
  tags: ['admin'],
  summary: 'Плашки над журналом Telegram',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'В очереди, ошибок отправки, отправлено сегодня (по Бишкеку)',
      content: json(AdminTelegramSummary),
    },
    ...denied,
  },
});

export function telegramSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramSummaryRoute, AppEnv> {
  return async (c) => {
    const today = bishkekDate(deps.clock.now());
    const summary = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramSummary(tx, today),
    );
    return c.json(summary, 200);
  };
}

export const telegramRetryRoute = createRoute({
  method: 'post',
  path: '/admin/telegram/log/retry',
  tags: ['admin'],
  summary: 'Повторить отправку сообщений с ошибкой',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminTelegramRetryRequest) } },
  responses: {
    200: {
      description:
        'Сколько строк снова в очереди и сколько из отмеченных — коды восстановления (их не повторяют)',
      content: json(AdminTelegramRetryResult),
    },
    400: { description: 'Неверные данные', content: error },
    ...denied,
  },
});

/**
 * «Повторить отправку» и «Повторить ошибки» (прототип `tgNoRetry`): строки с «Ошибкой», кроме кода
 * восстановления, снова «Ожидают» с нуля попыток и уходят с очередью (задача отправки — каждую минуту).
 */
export function telegramRetryHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramRetryRoute, AppEnv> {
  return async (c) => {
    const { ids } = c.req.valid('json');
    const result = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramRetry(tx, [...new Set(ids)], deps.clock.now()),
    );
    return c.json(result, 200);
  };
}

export const telegramBotRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/bot',
  tags: ['admin'],
  summary: 'Бот платформы: адрес и состояние вебхука',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Адрес вебхука сайта и состояние по ответу Telegram (getWebhookInfo)',
      content: json(AdminTelegramBot),
    },
    ...denied,
  },
});

/**
 * «Бот платформы» и «Проверить вебхук» (ТЗ: адрес вебхука, его состояние — работает или текст последней
 * ошибки Telegram; прототип `TG_WH`): каждый запрос спрашивает Telegram заново. Токен бота в ответ не
 * попадает; ошибка запроса к Telegram — только в журнал сервера, на экран — «Telegram не ответил».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Д-30 — причины «не работает» сверх прототипа.
export function telegramBotHandler(deps: ApiDeps): RouteHandler<typeof telegramBotRoute, AppEnv> {
  return async (c) => {
    const url = new URL('/api/telegram/webhook', deps.config.APP_BASE_URL).href;
    let info: Parameters<typeof webhookState>[0] = null;
    if (deps.telegram) {
      try {
        info = await deps.telegram.getWebhookInfo();
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Telegram: getWebhookInfo не ответил',
        );
        info = 'unreachable';
      }
    }
    const now = deps.clock.now();
    const state = webhookState(info, url, now);
    const rich = await telegramBotRich(deps.db);
    return c.json({ url, ...state, checkedAt: now.toISOString(), rich }, 200);
  };
}

export const telegramBotViewRoute = createRoute({
  method: 'put',
  path: '/admin/telegram/bot/view',
  tags: ['admin'],
  summary: 'Бот платформы: «Сообщения с таблицами» — включить или выключить для всех',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminTelegramBotView) } },
  responses: {
    200: { description: 'Сохранено', content: json(AdminTelegramBotView) },
    400: { description: 'Неверные данные', content: error },
    ...denied,
  },
});

/**
 * «Вид сообщений и кнопки» (поток Т, задача Т1; прототип admin/telegram.js `#tg-rich`): выключено — все
 * пользователи получают сообщения бота простым текстом, кнопки под сообщением остаются. Запись — в
 * историю платформы.
 */
export function telegramBotViewHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramBotViewRoute, AppEnv> {
  return async (c) => {
    const { rich } = c.req.valid('json');
    const was = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminSetTelegramBotRich(tx, rich),
    );
    if (was === null) apiFail(403, 'forbidden', 'Не администратор платформы');
    return c.json({ rich }, 200);
  };
}

export const telegramOrgsRoute = createRoute({
  method: 'get',
  path: '/admin/telegram/orgs',
  tags: ['admin'],
  summary: 'Действующие организации для рассылки',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Действующие организации по названию', content: json(AdminTelegramOrgs) },
    ...denied,
  },
});

export function telegramOrgsHandler(deps: ApiDeps): RouteHandler<typeof telegramOrgsRoute, AppEnv> {
  return async (c) => {
    const items = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramOrgs(tx),
    );
    return c.json({ items }, 200);
  };
}

export const telegramBroadcastRoute = createRoute({
  method: 'post',
  path: '/admin/telegram/broadcast',
  tags: ['admin'],
  summary: 'Рассылка объявления в Telegram',
  middleware: [requirePlatformAdmin] as const,
  request: { body: { required: true, content: json(AdminTelegramBroadcastRequest) } },
  responses: {
    200: {
      description: 'Сколько сообщений поставлено в очередь',
      content: json(AdminTelegramBroadcastResult),
    },
    400: { description: 'Неверные данные: пустой или слишком длинный текст', content: error },
    409: { description: 'Организация не найдена или заблокирована', content: error },
    ...denied,
  },
});

/**
 * «Рассылка» → «Поставить в очередь» (ТЗ: «Рассылка объявлений всем пользователям или одной
 * организации»; прототип: «Сообщение получат только те, кто привязал Telegram»): по сообщению каждому
 * активному сотруднику действующей организации с привязанным Telegram; уходят обычной очередью.
 */
export function telegramBroadcastHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramBroadcastRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const queued = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      adminTelegramBroadcast(tx, { orgId: body.org, text: body.text, now: deps.clock.now() }),
    );
    if (queued === null) {
      return apiFail(409, 'broadcast_org', 'Организация не найдена или заблокирована');
    }
    return c.json({ queued }, 200);
  };
}
