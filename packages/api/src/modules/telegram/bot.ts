import type { TelegramSendOptions } from '@buhuchet/adapters';
import {
  logBotMessage,
  logTelegram,
  messageTemplates,
  telegramBotRich,
  telegramChat,
  telegramNotMeInert,
  telegramPlainText,
  type Db,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekTime,
  botMessageProblem,
  botPlainText,
  botTemplate,
  codeBotMessage,
  fillTemplate,
  SECURITY_NOTICE_DEFS,
  securityBotMessage,
  withOrganization,
  type BotMessage,
  type OutboxKind,
  type SecurityNotice,
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
  /** Кнопки меню под полем ввода: уйдут с сообщением, если под ним самим кнопок нет (задача Т5). */
  options: Pick<TelegramSendOptions, 'menu'> = {},
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
    const res = await deps.telegram.sendMessage(to.chatId, text, {
      ...botSendOptions(message, { plain }),
      ...(options.menu ? { menu: options.menu } : {}),
    });
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
 * Сообщение о безопасности с кнопкой «Это не я» (поток Т, задача Т4; прототип v101 `tgSecSend`): «Пароль
 * изменён» — в привязанный чат, «Привязан другой Telegram» и «Telegram отвязан» — в прежний. Уходит
 * сразу; описание с кнопкой пишется в журнал отправок и для прежнего, уже не привязанного чата
 * (миграция 0127) — по нему бот примет нажатие. В записи кнопки — момент отправки: кнопка действует
 * `NOT_ME_HOURS` часов. Организация в начале — если Telegram привязан к нескольким логинам.
 *
 * После сброса пароля владельцем или администратором платформы прежнему чату доверять нельзя (он мог
 * остаться у постороннего): пока у пользователя временный пароль или действует разрешение привязать
 * Telegram без кода, и под сообщением о привязке по такому разрешению (`inert`) кнопка ничего не
 * закрывает — бот отвечает, что делать (docs/deviations.md п. Т-7).
 */
export async function sendSecurityNotice(
  deps: ApiDeps,
  to: { userId: string; chatId: number; shared: boolean; orgName: string | null },
  notice: SecurityNotice,
  values: Readonly<Record<string, string | number>>,
  purpose: string,
  options: { inert?: boolean } = {},
): Promise<boolean> {
  const def = SECURITY_NOTICE_DEFS[notice];
  const now = deps.clock.now();
  const inert = options.inert === true || (await telegramNotMeInert(deps.db, to.userId));
  const text = withOrganization(
    await botText(deps, def.template, { ...values, время: bishkekTime(now) }),
    to.orgName,
    to.shared,
  );
  const message = securityBotMessage(text, notice, now, await botText(deps, 'tgBtnNotMe'), inert);
  return sendBotMessage(deps, to, message, def.kind, purpose);
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
  /** Заменён временный пароль: кнопка под сообщением ничего не закрывает (`sendSecurityNotice`). */
  temporaryReplaced = false,
): Promise<boolean> {
  if (!deps.telegram) return false;
  const chat = await telegramChat(deps.db, user.userId);
  if (!chat) return false;
  // Пароль сменил сам пользователь — под сообщением кнопка «Это не я»; под «Пароль сброшен» её нет:
  // пароль сбросил владелец или администратор платформы.
  if (resetBy === undefined) {
    return sendSecurityNotice(
      deps,
      { userId: user.userId, chatId: chat.chatId, shared: chat.shared, orgName: user.orgName },
      'pass',
      { логин: user.login },
      'password_changed',
      { inert: temporaryReplaced },
    );
  }
  const text = withOrganization(
    await botText(deps, 'tgPassReset', { логин: user.login, кто: resetBy }),
    user.orgName,
    chat.shared,
  );
  return sendNow(
    deps,
    chat.chatId,
    text,
    'password_changed',
    {},
    { userId: user.userId, kind: 'pass_reset' },
  );
}
