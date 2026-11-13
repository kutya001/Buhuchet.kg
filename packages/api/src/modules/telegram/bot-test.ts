import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  setTelegramPlainText,
  takeRateLimit,
  telegramChat,
  writeHistory,
  type RateLimit,
} from '@buhuchet/db';
import { botTestMessage } from '@buhuchet/domain';
import { ApiError, OkResponse, TelegramPlainRequest } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { asSessionUser } from '../../middleware/access';
import { botText, sendBotMessage } from './bot';
import type { BotAction } from './press';

const error = { 'application/json': { schema: ApiError } };

/*
 * «Проверить бота» и «Сообщения простым текстом» в «Мой профиль» (поток Т, задача Т1; прототип
 * modules/profile.js — `#pf-tgtest`, `#pf-tgplain`, modules/tg-chat.js — `tgTestMsg`): человек видит,
 * как его приложение Telegram показывает сообщения с таблицами и кнопками, и, если таблицы не
 * показываются, переходит на простой текст.
 */

/** Кнопка «Проверить кнопки» под сообщением проверки: данные не меняет, отвечает скрытым ответом. */
export const testAction: BotAction = {
  run: async (ctx) => ({ reply: await ctx.text('tgTestOk') }),
};

/** «Проверить бота» одним пользователем — не чаще стольких раз в час. */
export const BOT_TEST_RATE_LIMIT: RateLimit = {
  kind: 'telegram_bot_test',
  max: 10,
  windowSeconds: 3600,
};

export const botTestRoute = createRoute({
  method: 'post',
  path: '/telegram/test',
  tags: ['telegram'],
  summary: '«Проверить бота»: бот присылает в свой Telegram сообщение с таблицей и кнопкой',
  responses: {
    200: {
      description: 'Сообщение отправлено',
      content: { 'application/json': { schema: OkResponse } },
    },
    401: { description: 'Нет входа', content: error },
    409: { description: 'Telegram не привязан (`telegram_not_linked`)', content: error },
    429: { description: 'Слишком часто (`bot_test_limit`)', content: error },
    502: { description: 'Telegram не принял сообщение (`telegram_send_failed`)', content: error },
    503: { description: 'Telegram-бот не подключён', content: error },
  },
});

export function botTestHandler(deps: ApiDeps): RouteHandler<typeof botTestRoute, AppEnv> {
  return async (c) => {
    if (!deps.telegram) {
      return c.json(
        apiError('telegram_unavailable', 'Telegram-бот пока не подключён к платформе'),
        503,
      );
    }
    const session = c.get('session')!;
    const chat = await telegramChat(deps.db, session.userId);
    if (!chat) return c.json(apiError('telegram_not_linked', 'Сначала привяжите Telegram'), 409);
    const slot = await takeRateLimit(deps.db, BOT_TEST_RATE_LIMIT, session.userId);
    if (!slot.ok) {
      return c.json(
        apiError('bot_test_limit', 'Слишком много проверок бота. Попробуйте через час'),
        429,
      );
    }
    const message = botTestMessage(await botText(deps, 'tgTest'), await botText(deps, 'tgBtnTest'));
    // Один Telegram привязан к нескольким логинам — в сообщении указывается организация (ТЗ).
    const sent = await sendBotMessage(
      deps,
      { userId: session.userId, chatId: chat.chatId },
      chat.shared && session.orgName ? { ...message, sub: session.orgName } : message,
      'bot_test',
      'bot_test',
    );
    if (!sent) {
      return c.json(
        apiError('telegram_send_failed', 'Telegram не принял сообщение. Попробуйте позже'),
        502,
      );
    }
    return c.json({ ok: true as const }, 200);
  };
}

export const plainTextRoute = createRoute({
  method: 'put',
  path: '/telegram/plain',
  tags: ['telegram'],
  summary: '«Сообщения простым текстом»: получать сообщения бота без таблиц и разделов',
  request: {
    body: { required: true, content: { 'application/json': { schema: TelegramPlainRequest } } },
  },
  responses: {
    200: {
      description: 'Сохранено',
      content: { 'application/json': { schema: OkResponse } },
    },
    400: { description: 'Неверные данные', content: error },
    401: { description: 'Нет входа', content: error },
    409: { description: 'Telegram не привязан (`telegram_not_linked`)', content: error },
  },
});

export function plainTextHandler(deps: ApiDeps): RouteHandler<typeof plainTextRoute, AppEnv> {
  return async (c) => {
    const session = c.get('session')!;
    const { plain } = c.req.valid('json');
    const was = await asSessionUser(deps, session, async (tx, inOrg) => {
      const before = await setTelegramPlainText(tx, plain);
      // История администратора платформы — в Админке (#18); у его записи нет организации.
      if (before !== null && before !== plain && inOrg) {
        await writeHistory(tx, {
          entity: 'user',
          entityId: session.userId,
          action: 'update',
          changes: [{ field: 'telegramPlain', from: before, to: plain }],
        });
      }
      return before;
    });
    if (was === null) {
      return c.json(apiError('telegram_not_linked', 'Сначала привяжите Telegram'), 409);
    }
    return c.json({ ok: true as const }, 200);
  };
}
