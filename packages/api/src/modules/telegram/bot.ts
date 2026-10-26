import { messageTemplates, telegramChat } from '@buhuchet/db';
import {
  fillTemplate,
  TELEGRAM_TEMPLATE_DEFAULTS,
  withOrganization,
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
 * сообщение о смене пароля). Очередь напоминаний с повторами — поток Б. Ошибка Telegram не роняет
 * метод: она пишется в журнал без текста сообщения (в нём может быть код).
 */
export async function sendNow(
  deps: ApiDeps,
  chatId: number,
  text: string,
  purpose: string,
): Promise<boolean> {
  if (!deps.telegram) return false;
  try {
    const res = await deps.telegram.sendMessage(chatId, text);
    if (!res.ok) {
      deps.logger.warn(
        { purpose, errorCode: res.errorCode, description: res.description },
        'Telegram: сообщение не отправлено',
      );
    }
    return res.ok;
  } catch (err) {
    deps.logger.warn({ err, purpose }, 'Telegram: сообщение не отправлено');
    return false;
  }
}

/**
 * Бот сообщает о каждой смене пароля, чтобы пользователь заметил чужую попытку (ТЗ «Восстановление
 * пароля через Telegram»). false — Telegram не привязан или сообщение не ушло.
 */
export async function notifyPasswordChanged(
  deps: ApiDeps,
  user: { userId: string; login: string; orgName: string | null },
): Promise<boolean> {
  if (!deps.telegram) return false;
  const chat = await telegramChat(deps.db, user.userId);
  if (!chat) return false;
  const text = withOrganization(
    await botText(deps, 'tgPassChanged', { логин: user.login }),
    user.orgName,
    chat.shared,
  );
  return sendNow(deps, chat.chatId, text, 'password_changed');
}
