import type { TelegramSendOptions } from '@buhuchet/adapters';
import { logTelegram, messageTemplates, telegramChat } from '@buhuchet/db';
import {
  fillTemplate,
  TELEGRAM_TEMPLATE_DEFAULTS,
  withOrganization,
  type OutboxKind,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';

/**
 * Текст сообщения бота: шаблон «Справочников платформы» с этим ключом, а пока его там нет — текст по
 * умолчанию из @buhuchet/domain (docs/deviations.md, п. 6).
 */
export async function botText(
  deps: ApiDeps,
  key: TelegramTemplateKey,
  values: Readonly<Record<string, string | number>> = {},
): Promise<string> {
  const templates = await messageTemplates(deps.db);
  return fillTemplate(templates[key] ?? TELEGRAM_TEMPLATE_DEFAULTS[key], values);
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
    error = err instanceof Error ? err.message : String(err);
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
  return sendNow(deps, chat.chatId, text, 'password_changed', {}, {
    userId: user.userId,
    kind: resetBy === undefined ? 'pass_changed' : 'pass_reset',
  });
}
