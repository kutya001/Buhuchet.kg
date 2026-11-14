import type { TelegramSendOptions } from '@buhuchet/adapters';
import {
  logBotMessage,
  logTelegram,
  messageTemplates,
  telegramBotRich,
  telegramChat,
  telegramPlainText,
  type Db,
  type Tx,
} from '@buhuchet/db';
import {
  botMessageProblem,
  botPlainText,
  botTemplate,
  codeBotMessage,
  fillTemplate,
  withOrganization,
  type BotMessage,
  type OutboxKind,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { botSendOptions, redactBotToken } from './outbox';

/**
 * Текст сообщения бота: шаблон «Справочников платформы» с этим ключом, а пока его там нет — текст по
 * умолчанию из @buhuchet/domain (docs/deviations.md, п. 6); у кода восстановления пароля и кода входа в
 * Админку без {код} — тоже по умолчанию (п. О-50).
 */
export async function botText(
  deps: ApiDeps,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
  /** Внутри открытой транзакции — она сама: запрос к пулу мимо неё ждал бы свободное соединение. */
  db: Db | Tx = deps.db,
): Promise<string> {
  const templates = await messageTemplates(db);
  return fillTemplate(botTemplate(key, templates[key]), values);
}

/**
 * Отправить сразу, мимо очереди (ТЗ: код восстановления пароля приходит сразу; так же — ответы бота и
 * сообщение о смене пароля). Служебное сообщение пользователю (`log`) пишется в журнал отправок после
 * попытки — у кода без текста, повторно код не отправляется (docs/deviations.md, п. 12). Ошибка
 * Telegram не роняет метод: она пишется в журнал сервера без текста сообщения (в нём может быть код).
 */
export async function sendNow(
  deps: ApiDeps,
  chatId: number,
  text: string,
  purpose: string,
  options: TelegramSendOptions = {},
  log?: { userId: string; kind: OutboxKind },
): Promise<boolean> {
  if (!deps.telegram) return false;
  let ok = false;
  let error = '';
  try {
    const res = await deps.telegram.sendMessage(chatId, text, options);
    ok = res.ok;
    if (!res.ok) {
      error = `${res.errorCode}: ${res.description}`;
      deps.logger.warn(
        { purpose, errorCode: res.errorCode, description: res.description },
        'Telegram: сообщение не отправлено',
      );
    }
  } catch (err) {
    error = redactBotToken(err instanceof Error ? err.message : String(err));
    deps.logger.warn({ err, purpose }, 'Telegram: сообщение не отправлено');
  }
  if (log) {
    try {
      await logTelegram(deps.db, { ...log, chatId, text, ok, error });
    } catch (err) {
      deps.logger.warn({ err, purpose }, 'Telegram: сообщение не записано в журнал отправок');
    }
  }
  return ok;
}

/**
 * Сообщение с таблицами и кнопками — сразу, мимо очереди (поток Т, задача Т1): получатель с
 * «Сообщениями простым текстом» или при выключенных таблицах платформы получает простой текст, кнопки —
 * в обоих видах. Сообщение пишется в журнал отправок вместе с описанием и номером в чате: по ним бот
 * принимает нажатия кнопок. Ошибка Telegram метод не роняет; false — сообщение не ушло.
 */
export async function sendBotMessage(
  deps: ApiDeps,
  to: { userId: string; chatId: number },
  message: BotMessage,
  kind: OutboxKind,
  purpose: string,
): Promise<boolean> {
  const problem = botMessageProblem(message);
  if (problem) throw new Error(`Сообщение бота (${purpose}): ${problem}`);
  if (!deps.telegram) return false;
  const text = botPlainText(message);
  let ok = false;
  let error = '';
  let messageId: number | null = null;
  try {
    const plain =
      !(await telegramBotRich(deps.db)) || (await telegramPlainText(deps.db, to.userId));
    const res = await deps.telegram.sendMessage(
      to.chatId,
      text,
      botSendOptions(message, { plain }),
    );
    ok = res.ok;
    if (res.ok) messageId = res.messageId;
    else {
      error = `${res.errorCode}: ${res.description}`;
      deps.logger.warn(
        { purpose, errorCode: res.errorCode, description: res.description },
        'Telegram: сообщение не отправлено',
      );
    }
  } catch (err) {
    error = redactBotToken(err instanceof Error ? err.message : String(err));
    deps.logger.warn({ err, purpose }, 'Telegram: сообщение не отправлено');
  }
  try {
    await logBotMessage(deps.db, { ...to, kind, text, ok, error, message, messageId });
  } catch (err) {
    deps.logger.warn({ err, purpose }, 'Telegram: сообщение не записано в журнал отправок');
  }
  return ok;
}

/**
 * Сообщение с кодом подтверждения (пакет заказчика 13.11.2026: код копируется одним нажатием): код в
 * тексте моноширинный — в чате копируется нажатием, под сообщением — кнопка «Скопировать код». В
 * журнал отправок код не пишется (`sendNow`). Шаблон без кода в тексте уходит обычным сообщением.
 */
export async function sendCodeMessage(
  deps: ApiDeps,
  chatId: number,
  text: string,
  code: string,
  purpose: string,
  options: Pick<TelegramSendOptions, 'timeoutMs'> = {},
  log?: { userId: string; kind: OutboxKind },
): Promise<boolean> {
  if (!text.includes(code)) return sendNow(deps, chatId, text, purpose, options, log);
  const message = codeBotMessage(text, code, await botText(deps, 'tgBtnCopyCode'));
  const view = botSendOptions(message, { plain: true });
  return sendNow(deps, chatId, text, purpose, { ...options, ...view }, log);
}

/**
 * Бот сообщает о каждой смене пароля, чтобы пользователь заметил чужую попытку (ТЗ «Восстановление
 * пароля через Telegram»); resetBy — кто выдал временный пароль. false — Telegram не привязан или
 * сообщение не ушло.
 */
export async function notifyPasswordChanged(
  deps: ApiDeps,
  user: { userId: string; login: string; orgName: string | null },
  resetBy?: string,
): Promise<boolean> {
  if (!deps.telegram) return false;
  const chat = await telegramChat(deps.db, user.userId);
  if (!chat) return false;
  const text = withOrganization(
    resetBy === undefined
      ? await botText(deps, 'tgPassChanged', { логин: user.login })
      : await botText(deps, 'tgPassReset', { логин: user.login, кто: resetBy }),
    user.orgName,
    chat.shared,
  );
  return sendNow(
    deps,
    chat.chatId,
    text,
    'password_changed',
    {},
    {
      userId: user.userId,
      kind: resetBy === undefined ? 'pass_changed' : 'pass_reset',
    },
  );
}
