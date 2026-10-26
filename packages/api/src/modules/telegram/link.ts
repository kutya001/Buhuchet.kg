import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { hashSessionToken, newLinkToken } from '@buhuchet/adapters/tokens';
import { createTelegramLinkToken, unlinkTelegram, writeHistory } from '@buhuchet/db';
import { telegramName, withOrganization } from '@buhuchet/domain';
import { ApiError, OkResponse, TelegramLinkResponse } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { asSessionUser } from '../../middleware/access';
import { botText, sendNow } from './bot';

const error = { 'application/json': { schema: ApiError } };

export const createLinkRoute = createRoute({
  method: 'post',
  path: '/telegram/link',
  tags: ['telegram'],
  summary: 'Ссылка привязки Telegram: t.me/бот?start=…, одноразовая, 15 минут',
  responses: {
    200: {
      description: 'Ссылка; прежние ссылки пользователя перестают действовать',
      content: { 'application/json': { schema: TelegramLinkResponse } },
    },
    401: { description: 'Нет входа', content: error },
    503: { description: 'Telegram-бот не подключён', content: error },
  },
});

/**
 * «Скопировать ссылку» в «Мой профиль» (прототип modules/profile.js): бот проверит токен, привяжет
 * чат и пришлёт подтверждение — вручную вводить ID не нужно (ТЗ). В базе — только хеш токена.
 */
export function createLinkHandler(deps: ApiDeps): RouteHandler<typeof createLinkRoute, AppEnv> {
  return async (c) => {
    const bot = deps.config.TELEGRAM_BOT_USERNAME;
    if (!deps.telegram || !bot) {
      return c.json(
        apiError('telegram_unavailable', 'Telegram-бот пока не подключён к платформе'),
        503,
      );
    }
    const token = newLinkToken();
    const expiresAt = await asSessionUser(deps, c.get('session')!, (tx) =>
      createTelegramLinkToken(tx, hashSessionToken(token)),
    );
    return c.json(
      { url: `https://t.me/${bot}?start=${token}`, expiresAt: expiresAt.toISOString() },
      200,
    );
  };
}

export const unlinkRoute = createRoute({
  method: 'delete',
  path: '/telegram/link',
  tags: ['telegram'],
  summary: 'Отвязать свой Telegram',
  responses: {
    200: {
      description: 'Telegram отвязан (или не был привязан)',
      content: { 'application/json': { schema: OkResponse } },
    },
    401: { description: 'Нет входа', content: error },
  },
});

/**
 * «Отвязать» в «Мой профиль»: напоминания и «Забыли пароль?» перестают работать, ожидающий код
 * отменяется; пишется в историю, бот сообщает об отвязке в отвязанный чат.
 */
export function unlinkHandler(deps: ApiDeps): RouteHandler<typeof unlinkRoute, AppEnv> {
  return async (c) => {
    const session = c.get('session')!;
    const removed = await asSessionUser(deps, session, async (tx, inOrg) => {
      const chat = await unlinkTelegram(tx);
      // История администратора платформы — в Админке (#18); у его записи нет организации.
      if (chat && inOrg) {
        await writeHistory(tx, {
          entity: 'user',
          entityId: session.userId,
          action: 'update',
          changes: [{ field: 'telegram', from: telegramName(chat), to: null }],
        });
      }
      return chat;
    });
    if (removed) {
      const notice = await botText(deps, 'tgUnlinked', { логин: session.login });
      await sendNow(
        deps,
        removed.chatId,
        withOrganization(notice, session.orgName, removed.shared),
        'telegram_unlinked',
      );
    }
    return c.json({ ok: true as const }, 200);
  };
}
