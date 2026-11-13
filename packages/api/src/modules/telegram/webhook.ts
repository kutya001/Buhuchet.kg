import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { hashPassword, verifyPassword } from '@buhuchet/adapters/password';
import { isValidWebhookSecret } from '@buhuchet/adapters/telegram';
import { hashSessionToken, isSessionTokenShape, newResetCode } from '@buhuchet/adapters/tokens';
import {
  peekTelegramLink,
  requestTelegramRelink,
  reserveTelegramRelinkAttempt,
  useTelegramLink,
  useTelegramRelink,
  withOrgContext,
  withUserContext,
  writeHistory,
  type TelegramLinkResult,
  type Tx,
} from '@buhuchet/db';
import {
  codeWithOrganization,
  cpTgStartToken,
  loginDenial,
  parseStartCommand,
  relinkCodeOf,
  TELEGRAM_RELINK_CODE_TTL_MINUTES,
  telegramName,
  telegramRelinkNeedsCode,
  withOrganization,
} from '@buhuchet/domain';
import { ApiError, OkResponse } from '@buhuchet/shared';
import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiError } from '../../errors';
import { botText, sendCodeMessage, sendNow } from './bot';
import { clientStart, clientText } from './client';
import { handleBotPress } from './press';

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

/** Нажатие кнопки под сообщением бота (`callback_query`): данные кнопки — до 64 байт. */
const ButtonPress = z.object({
  id: z.string().min(1).max(128),
  from: z.object({ id: z.number().int(), is_bot: z.boolean().optional() }),
  data: z.string().max(64).optional(),
  message: z
    .object({
      message_id: z.number().int(),
      chat: z.object({ id: z.number().int(), type: z.string().max(32) }),
    })
    .optional(),
});

export const webhookRoute = createRoute({
  method: 'post',
  path: '/telegram/webhook',
  tags: ['telegram'],
  summary:
    'Вебхук бота: привязка Telegram по ссылке /start <токен>, код замены из прежнего чата, нажатия кнопок под сообщениями',
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

/** Чат и имя в Telegram того, кто открыл ссылку или прислал код. */
interface LinkChat {
  chatId: number;
  username: string | null;
  firstName: string | null;
}

/** Учётная запись, к которой привязывается чат. */
interface LinkAccount {
  userId: string;
  orgId: string | null;
  login: string;
  orgName: string | null;
}

/** Транзакция от имени пользователя: сотрудник — в своей организации, администратор — без неё. */
function asAccount<T>(deps: ApiDeps, account: LinkAccount, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return account.orgId
    ? withOrgContext(deps.db, { orgId: account.orgId, userId: account.userId }, fn)
    : withUserContext(deps.db, account.userId, fn);
}

/**
 * Чат привязан (по ссылке или по коду из прежнего чата): запись в истории в той же транзакции, о
 * замене — в прежний чат (привязанный или отвязанный последним), подтверждение — в новый.
 */
async function linked(
  deps: ApiDeps,
  account: LinkAccount,
  link: LinkChat,
  use: (tx: Tx) => Promise<TelegramLinkResult | null>,
): Promise<boolean> {
  const result = await asAccount(deps, account, async (tx) => {
    const done = await use(tx);
    // История администратора платформы — в Админке (#18); у его записи нет организации.
    if (done && account.orgId) {
      await writeHistory(tx, {
        entity: 'user',
        entityId: account.userId,
        action: 'update',
        changes: [
          {
            field: 'telegram',
            from: done.previous ? telegramName(done.previous) : null,
            to: telegramName(link),
          },
        ],
      });
    }
    return done;
  });
  if (!result) return false;
  const before =
    result.previous && result.previous.chatId !== link.chatId
      ? result.previous
      : (result.unlinked ?? null);
  if (before) {
    // Имя нового Telegram задаёт его владелец — одной строкой и коротко, как в коде замены.
    const notice = await botText(deps, 'tgRelinked', {
      логин: account.login,
      телеграм: relinkName(link),
    });
    await sendNow(
      deps,
      before.chatId,
      withOrganization(notice, account.orgName, before.shared),
      'telegram_relinked',
      {},
      { userId: account.userId, kind: 'relinked' },
    );
  }
  await sendNow(
    deps,
    link.chatId,
    withOrganization(
      await botText(deps, 'tgLinked', { логин: account.login }),
      account.orgName,
      result.shared,
    ),
    'bot_reply',
    {},
    { userId: account.userId, kind: 'linked' },
  );
  return true;
}

/**
 * Имя нового Telegram в сообщениях о замене в прежний чат (код замены, «привязан другой Telegram»): его
 * выбирает владелец нового чата, поэтому — одной строкой, без невидимых и управляющих знаков (смена
 * направления текста) и не длиннее 32 знаков (не выдать за текст бота). Режется по знакам, а не по
 * половинкам UTF-16: обрезанный эмодзи Telegram не примет, и сообщение не дошло бы.
 */
const RELINK_NAME_MAX = 32;
function relinkName(link: LinkChat): string {
  const chars = [
    ...telegramName(link)
      // Соединитель эмодзи (U+200D) остаётся, иначе составной эмодзи распался бы на части.
      .replace(/(?!\u200d)[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ];
  if (chars.length === 0) return 'Telegram';
  return chars.length > RELINK_NAME_MAX
    ? `${chars.slice(0, RELINK_NAME_MAX - 1).join('')}…`
    : chars.join('');
}

/**
 * Ссылку открыли в другом чате, а прежний есть (решение заказчика 07.11.2026, Р-13 Б): бот
 * присылает код в прежний чат и просит прислать его сюда. Хеш кода считается до транзакции; ссылка
 * использована, только когда код записан. Код не дошёл (бот заблокирован в прежнем чате) — пароль
 * сбрасывает владелец, после этого сутки Telegram привязывается без кода.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-20
async function askRelinkCode(
  deps: ApiDeps,
  account: LinkAccount,
  tokenHash: string,
  link: LinkChat,
  reply: (body: string) => Promise<unknown>,
): Promise<'asked' | 'not_needed'> {
  const code = newResetCode();
  const codeHash = await hashPassword(code);
  const request = await asAccount(deps, account, (tx) =>
    requestTelegramRelink(tx, { tokenHash, ...link, codeHash }),
  );
  if (request.status === 'not_needed') return 'not_needed';
  if (request.status === 'invalid') {
    await reply(await botText(deps, 'tgLinkInvalid'));
    return 'asked';
  }
  if (request.status !== 'sent') {
    await reply(await botText(deps, 'tgRelinkLimited'));
    return 'asked';
  }
  const minutes = TELEGRAM_RELINK_CODE_TTL_MINUTES;
  const sent = await sendCodeMessage(
    deps,
    request.chatId,
    // Организация — второй строкой: код остаётся первым в строке уведомления (п. Т-2).
    codeWithOrganization(
      await botText(deps, 'tgRelinkCode', {
        логин: account.login,
        телеграм: relinkName(link),
        код: code,
        минут: minutes,
      }),
      account.orgName,
      request.shared,
    ),
    code,
    'relink_code',
    {},
    { userId: account.userId, kind: 'relink_code' },
  );
  await reply(
    sent
      ? await botText(deps, 'tgRelinkAsk', { логин: account.login, минут: minutes })
      : await botText(deps, 'tgRelinkNoSend'),
  );
  return 'asked';
}

/**
 * Сообщение с кодом в новом чате: попытка занимается до проверки (5 на код, 10 неверных за сутки),
 * верный код привязывает чат. Кода для этого чата нет — обычная подсказка бота.
 */
async function confirmRelink(
  deps: ApiDeps,
  chatId: number,
  code: string,
  reply: (body: string) => Promise<unknown>,
): Promise<void> {
  const attempt = await reserveTelegramRelinkAttempt(deps.db, chatId);
  if (attempt.status === 'none') {
    await reply(await botText(deps, 'tgStart'));
    return;
  }
  if (attempt.status === 'spent' || loginDenial(attempt)) {
    await reply(await botText(deps, 'tgRelinkFailed'));
    return;
  }
  if (!(await verifyPassword(attempt.codeHash, code))) {
    await reply(
      attempt.triesLeft > 0
        ? await botText(deps, 'tgRelinkWrong', { попыток: attempt.triesLeft })
        : await botText(deps, 'tgRelinkFailed'),
    );
    return;
  }
  // Имя в Telegram — из сообщения со ссылкой: его записал запрос кода.
  const link = { chatId, username: attempt.username, firstName: attempt.firstName };
  const done = await linked(deps, attempt, link, (tx) => useTelegramRelink(tx, attempt.codeId));
  if (!done) await reply(await botText(deps, 'tgRelinkFailed'));
}

/**
 * Вебхук бота (ТЗ «Телеграм бот для любых уведомлений»): ссылка t.me/бот?start=токен приходит как
 * «/start токен». Бот проверяет токен (одноразовый, 15 минут), привязывает чат к профилю и присылает
 * подтверждение. Другой чат вместо прежнего (привязанного или отвязанного последним) — только кодом
 * из прежнего (решение заказчика 07.11.2026, Р-13 Б): бот присылает код туда, его присылают сюда;
 * о замене бот пишет в прежний чат. На всё остальное отвечает 200, чтобы Telegram не повторял
 * доставку.
 */
export function webhookHandler(deps: ApiDeps): RouteHandler<typeof webhookRoute, AppEnv> {
  return async (c) => {
    const ok = c.json({ ok: true as const }, 200);
    const update = c.req.valid('json') as { message?: unknown; callback_query?: unknown };
    // Нажатие кнопки под сообщением (поток Т, задача Т1). Сбой не роняет вебхук: иначе Telegram
    // повторял бы доставку нажатия, а действие могло уже выполниться.
    const press = ButtonPress.safeParse(update.callback_query);
    if (press.success) {
      const q = press.data;
      try {
        await handleBotPress(deps, {
          callbackId: q.id,
          fromId: q.from.id,
          chatId: q.message?.chat.id ?? 0,
          chatType: q.from.is_bot ? '' : (q.message?.chat.type ?? ''),
          messageId: q.message?.message_id ?? 0,
          data: q.data ?? '',
        });
      } catch (err) {
        deps.logger.error({ err }, 'Telegram: нажатие кнопки не обработано');
      }
      return ok;
    }
    const message = PrivateText.safeParse(update.message);
    if (!message.success || message.data.from?.is_bot) return ok;
    const { chat, from, text } = message.data;
    const reply = async (body: string) => {
      await sendNow(deps, chat.id, body, 'bot_reply');
      return ok;
    };

    const command = parseStartCommand(text);
    if (!command) {
      // Telegram контрагента (поток К): «Отключить» от клиента, подключившего чат к контрагенту.
      if (await clientText(deps, chat.id, text)) return ok;
      const code = relinkCodeOf(text);
      if (!code) return reply(await botText(deps, 'tgStart'));
      await confirmRelink(deps, chat.id, code, reply);
      return ok;
    }
    if (!command.token) return reply(await botText(deps, 'tgStart'));
    // Telegram контрагента (поток К): ссылка со страницы контрагента — «/start cp_<токен>».
    const clientToken = cpTgStartToken(command.token);
    if (clientToken) {
      await clientStart(
        deps,
        { chatId: chat.id, username: from?.username ?? null, firstName: from?.first_name ?? null },
        clientToken,
      );
      return ok;
    }
    if (!isSessionTokenShape(command.token)) return reply(await botText(deps, 'tgLinkInvalid'));
    const tokenHash = hashSessionToken(command.token);
    const target = await peekTelegramLink(deps.db, tokenHash);
    if (!target) return reply(await botText(deps, 'tgLinkInvalid'));
    // Telegram повторил то же сообщение после привязки или запроса кода — второй раз не отвечаем.
    if (target.used && (target.linkedChatId === chat.id || target.relinkChatId === chat.id)) {
      return ok;
    }
    if (target.used || target.expired || loginDenial(target)) {
      return reply(await botText(deps, 'tgLinkInvalid'));
    }

    const link: LinkChat = {
      chatId: chat.id,
      username: from?.username ?? null,
      firstName: from?.first_name ?? null,
    };
    if (telegramRelinkNeedsCode(target, chat.id)) {
      const asked = await askRelinkCode(deps, target, tokenHash, link, reply);
      if (asked === 'asked') return ok;
    }
    const done = await linked(deps, target, link, (tx) =>
      useTelegramLink(tx, { tokenHash, ...link }),
    );
    if (!done) return reply(await botText(deps, 'tgLinkInvalid'));
    return ok;
  };
}
