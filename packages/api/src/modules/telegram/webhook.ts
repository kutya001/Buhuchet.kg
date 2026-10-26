import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { isValidWebhookSecret } from '@buhuchet/adapters/telegram';
import { hashSessionToken, isSessionTokenShape } from '@buhuchet/adapters/tokens';
import {
  peekTelegramLink,
  useTelegramLink,
  withOrgContext,
  withUserContext,
  writeHistory,
} from '@buhuchet/db';
import { loginDenial, parseStartCommand, telegramName, withOrganization } from '@buhuchet/domain';
import { ApiError, OkResponse } from '@buhuchet/shared';
import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText, sendNow } from './bot';

const error = { 'application/json': { schema: ApiError } };

/**
 * Обновление от Telegram. Принимается любое (сообщения, правки, участники чата), чтобы Telegram не
 * повторял доставку; бот отвечает только на текст в личном чате.
 */
const TelegramUpdate = z.looseObject({ update_id: z.number().int() });

const PrivateText = z.object({
  text: z.string().max(4096),
  chat: z.object({ id: z.number().int(), type: z.literal('private') }),
  from: z
    .object({
      is_bot: z.boolean().optional(),
      username: z.string().max(64).optional(),
      first_name: z.string().max(256).optional(),
    })
    .optional(),
});

export const webhookRoute = createRoute({
  method: 'post',
  path: '/telegram/webhook',
  tags: ['telegram'],
  summary: 'Вебхук бота: привязка Telegram по ссылке /start <токен>',
  request: {
    body: { required: true, content: { 'application/json': { schema: TelegramUpdate } } },
  },
  responses: {
    200: {
      description: 'Обновление принято',
      content: { 'application/json': { schema: OkResponse } },
    },
    401: { description: 'Неверный секрет вебхука', content: error },
    404: { description: 'Бот не подключён', content: error },
  },
});

/**
 * Вебхук принимается только с секретом (TELEGRAM_WEBHOOK_SECRET в заголовке
 * X-Telegram-Bot-Api-Secret-Token) — до разбора тела; без бота метода как будто нет.
 */
export function webhookGuard(deps: ApiDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const secret = deps.config.TELEGRAM_WEBHOOK_SECRET;
    if (!deps.telegram || !secret) return c.json(apiError('not_found', 'Метод не найден'), 404);
    if (!isValidWebhookSecret(c.req.header('x-telegram-bot-api-secret-token'), secret)) {
      return c.json(apiError('unauthorized', 'Неверный секрет вебхука'), 401);
    }
    return next();
  });
}

/**
 * Вебхук бота (ТЗ «Телеграм бот для любых уведомлений»): ссылка t.me/бот?start=токен приходит как
 * «/start токен». Бот проверяет токен (одноразовый, 15 минут), привязывает чат к профилю и присылает
 * подтверждение. На всё остальное отвечает 200, чтобы Telegram не повторял доставку.
 */
export function webhookHandler(deps: ApiDeps): RouteHandler<typeof webhookRoute, AppEnv> {
  return async (c) => {
    const ok = c.json({ ok: true as const }, 200);
    const message = PrivateText.safeParse((c.req.valid('json') as { message?: unknown }).message);
    if (!message.success || message.data.from?.is_bot) return ok;
    const { chat, from, text } = message.data;
    const reply = async (body: string) => {
      await sendNow(deps, chat.id, body, 'bot_reply');
      return ok;
    };

    const command = parseStartCommand(text);
    if (!command?.token) return reply(await botText(deps, 'tgStart'));
    if (!isSessionTokenShape(command.token)) return reply(await botText(deps, 'tgLinkInvalid'));
    const tokenHash = hashSessionToken(command.token);
    const target = await peekTelegramLink(deps.db, tokenHash);
    if (!target) return reply(await botText(deps, 'tgLinkInvalid'));
    // Telegram повторил то же сообщение после успешной привязки — второй раз не отвечаем.
    if (target.used && target.linkedChatId === chat.id) return ok;
    if (target.used || target.expired || loginDenial(target)) {
      return reply(await botText(deps, 'tgLinkInvalid'));
    }

    const link = {
      tokenHash,
      chatId: chat.id,
      username: from?.username ?? null,
      firstName: from?.first_name ?? null,
    };
    const result = target.orgId
      ? await withOrgContext(
          deps.db,
          { orgId: target.orgId, userId: target.userId },
          async (tx) => {
            const linked = await useTelegramLink(tx, link);
            if (linked) {
              await writeHistory(tx, {
                entity: 'user',
                entityId: target.userId,
                action: 'update',
                changes: [
                  {
                    field: 'telegram',
                    from: linked.previous ? telegramName(linked.previous) : null,
                    to: telegramName(link),
                  },
                ],
              });
            }
            return linked;
          },
        )
      : // История администратора платформы — в Админке (#18); у его записи нет организации.
        await withUserContext(deps.db, target.userId, (tx) => useTelegramLink(tx, link));
    if (!result) return reply(await botText(deps, 'tgLinkInvalid'));
    return reply(
      withOrganization(
        await botText(deps, 'tgLinked', { логин: target.login }),
        target.orgName,
        result.shared,
      ),
    );
  };
}
