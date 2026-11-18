import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminSetTelegramBotRich,
  adminTelegramBroadcast,
  adminTelegramOrgs,
  adminTelegramRetry,
  telegramBotRich,
  withUserContext,
} from '@buhuchet/db';
import { bellText, formatText, webhookState } from '@buhuchet/domain';
import {
  AdminTelegramBot,
  AdminTelegramBotView,
  AdminTelegramBroadcastRequest,
  AdminTelegramBroadcastResult,
  AdminTelegramOrgs,
  AdminTelegramRetryRequest,
  AdminTelegramRetryResult,
  ApiError,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { castMessage } from './telegram-cast';

/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41,
 * docs/decisions.md п. Д-13): повтор отправки, состояние вебхука бота платформы и рассылка объявлений.
 * Сам журнал переписки — `telegram-journal.ts`. Только администратору платформы.
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

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
    409: {
      description:
        'Организация не найдена или заблокирована; новость, статья, видео или картинка недоступны',
      content: error,
    },
    ...denied,
  },
});

/**
 * «Рассылка» → «Поставить в очередь» (ТЗ: «Рассылка объявлений всем пользователям или одной
 * организации»; прототип: «Сообщение получат только те, кто привязал Telegram»): по сообщению каждому
 * активному сотруднику действующей организации с привязанным Telegram; уходят обычной очередью.
 * Оформленная рассылка (поток Т, задача Т6) — с картинкой, заголовком и кнопками-ссылками на сайт.
 */
/** Длина текста рассылки в строке колокольчика без заголовка (прототип v122: `slice(0,200)`). */
const BELL_BROADCAST_MAX = 200;

export function telegramBroadcastHandler(
  deps: ApiDeps,
): RouteHandler<typeof telegramBroadcastRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const t = await serverTexts(deps);
    const queued = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const cast = await castMessage(deps, tx, body);
      return adminTelegramBroadcast(tx, {
        orgId: body.org,
        text: cast.text,
        now: deps.clock.now(),
        message: cast.message,
        // Колокольчик (доработки 16.11.2026, блок 3; прототип v122 `admin/tg-cast.js`): заголовок,
        // без него — начало текста. Рассылка с «Подробнее» на новость второй строки к строке этой
        // новости не даёт (приёмка «Колокольчик против Telegram»; прототип v128).
        bellText:
          body.more?.kind === 'news'
            ? null
            : formatText(t('bell.line.broadcast'), {
                text: body.title.trim() || bellText(body.text).slice(0, BELL_BROADCAST_MAX),
              }),
        cast: {
          title: body.title,
          image: body.image,
          more: body.more ? `${body.more.kind}:${body.more.id}` : null,
          video: body.video,
        },
      });
    });
    if (queued === null) {
      return apiFail(409, 'broadcast_org', 'Организация не найдена или заблокирована');
    }
    return c.json({ queued }, 200);
  };
}
