import {
  botPressTarget,
  loadEmployeeAccess,
  markViaTelegram,
  saveBotPress,
  withOrgContext,
  withUserContext,
  type Tx,
} from '@buhuchet/db';
import {
  BOT_HIDDEN_REPLY_MAX,
  botKeyboard,
  findBotButton,
  loginDenial,
  parseBotPress,
  pressBotButton,
  RecordChangedError,
  RecordNotFoundError,
  type BotButton,
  type BotMessage,
  type OutboxKind,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { BOT_ACTIONS } from './actions';
import { botText, sendBotMessage } from './bot';

/*
 * Нажатие кнопки под сообщением бота (поток Т, задача Т1; прототип modules/tg-chat.js — `tgPress`,
 * `tgRefusal`). Данные нажатия сами ничего не разрешают: бот находит своё отправленное сообщение по
 * чату и номеру, сверяет, что такая кнопка в нём была и ещё активна, и что чат всё ещё привязан к той
 * учётной записи, которой сообщение отправлено. Дальше действие выполняется от имени этого
 * пользователя в его организации (RLS), записи истории получают пометку «через Telegram».
 *
 * Ядро проверяет: личный чат и нажал его хозяин; сообщение и кнопка; привязка; блокировка учётной
 * записи и организации; «Действия из Telegram» организации — у действий, которые меняют данные.
 * Право, область «Свои / Все контрагенты» и условия самого действия проверяет его обработчик — тем же
 * правилом, что метод сайта (тесты прав, области и изоляции — у потока, который добавил действие).
 * Из чата — только обратимые действия; деньги и удаление остаются на сайте.
 */

/** Права и область сотрудника (как у методов сайта); у администратора платформы — null. */
export type BotPressAccess = Awaited<ReturnType<typeof loadEmployeeAccess>>;

export interface BotPressUser {
  userId: string;
  orgId: string | null;
  employeeId: string | null;
  login: string;
  orgName: string | null;
  isPlatformAdmin: boolean;
}

export interface BotPressContext {
  deps: ApiDeps;
  /** Кому отправлено сообщение и кто нажал кнопку. */
  user: BotPressUser;
  chatId: number;
  /** Запись, к которой относится кнопка (`arg` кнопки). */
  arg: string | null;
  message: BotMessage;
  button: BotButton;
  /**
   * Транзакция от имени нажавшего: в его организации (RLS), с его правами и областью (`access`); всё,
   * что в ней пишется в историю, помечается «через Telegram».
   */
  asUser<T>(fn: (tx: Tx, access: BotPressAccess) => Promise<T>): Promise<T>;
  /** Текст шаблона бота: для скрытого ответа и новой подписи кнопки. */
  text(
    key: TelegramTemplateKey,
    values?: Readonly<Record<string, string | number>>,
  ): Promise<string>;
}

export interface BotPressResult {
  /** Скрытый ответ: его видит только нажавший, в переписке он не остаётся (до 200 знаков). */
  reply?: string;
  /** Показать скрытый ответ окном, а не строкой вверху чата (отказы ядра — всегда окном). */
  alert?: boolean;
  /** Действие выполнено: нажатая кнопка становится неактивной с этой подписью. */
  done?: string;
  /** Коды действий, чьи кнопки в этом сообщении гаснут (действие их отменяет). */
  off?: readonly string[];
  /** Новое сообщение в чат после действия (например, «пришлите файл»). */
  send?: { message: BotMessage; kind: OutboxKind };
}

export interface BotAction {
  /** Действие меняет данные: выключается владельцем («Действия из Telegram»). */
  change?: boolean;
  run(ctx: BotPressContext): Promise<BotPressResult>;
}

/** Нажатие из обновления Telegram (`callback_query`). */
export interface BotPress {
  callbackId: string;
  fromId: number;
  chatId: number;
  chatType: string;
  messageId: number;
  data: string;
}

const clip = (text: string) =>
  text.length > BOT_HIDDEN_REPLY_MAX ? `${text.slice(0, BOT_HIDDEN_REPLY_MAX - 1)}…` : text;

/**
 * Принять нажатие. Telegram всегда получает ответ на нажатие (иначе кнопка «крутится»); ошибка
 * Telegram и ошибка действия вебхук не роняют.
 */
export async function handleBotPress(deps: ApiDeps, press: BotPress): Promise<void> {
  const answer = async (text?: string, alert = false) => {
    try {
      await deps.telegram?.answerCallback(press.callbackId, text ? clip(text) : undefined, {
        alert,
      });
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_press' }, 'Telegram: ответ на нажатие не отправлен');
    }
  };
  const refuse = async (key: TelegramTemplateKey) => answer(await botText(deps, key), true);

  // Кнопки работают только в личном чате, и нажать может только его хозяин.
  if (press.chatType !== 'private' || press.fromId !== press.chatId) return answer();
  const parsed = parseBotPress(press.data);
  const target = parsed ? await botPressTarget(deps.db, press.chatId, press.messageId) : null;
  if (!parsed || !target) return refuse('tgActStale');
  if (!target.linked) return refuse('tgActNoLink');
  if (loginDenial(target)) return refuse('tgActNoRight');
  const button = findBotButton(target.message, parsed.action, parsed.arg);
  const action = (deps.botActions ?? BOT_ACTIONS)[parsed.action];
  if (!button || !action) return refuse('tgActStale');
  if (action.change && !target.isPlatformAdmin && !target.telegramActions) {
    return refuse('tgActOff');
  }

  const inContext = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const marked = async (tx: Tx) => {
      await markViaTelegram(tx);
      return fn(tx);
    };
    return target.orgId
      ? withOrgContext(deps.db, { orgId: target.orgId, userId: target.userId }, marked)
      : withUserContext(deps.db, target.userId, marked);
  };
  const ctx: BotPressContext = {
    deps,
    user: {
      userId: target.userId,
      orgId: target.orgId,
      employeeId: target.employeeId,
      login: target.login,
      orgName: target.orgName,
      isPlatformAdmin: target.isPlatformAdmin,
    },
    chatId: press.chatId,
    arg: parsed.arg,
    message: target.message,
    button,
    asUser: (fn) =>
      inContext(async (tx) =>
        fn(tx, target.employeeId ? await loadEmployeeAccess(tx, target.employeeId) : null),
      ),
    text: (key, values) => botText(deps, key, values),
  };

  let result: BotPressResult;
  try {
    result = await action.run(ctx);
  } catch (err) {
    // Запись изменили или удалили, пока сообщение лежало в чате, — «Кнопка устарела».
    if (err instanceof RecordChangedError || err instanceof RecordNotFoundError) {
      return refuse('tgActStale');
    }
    deps.logger.error({ err, action: parsed.action }, 'Telegram: действие по кнопке не выполнено');
    deps.errors?.capture(err);
    return refuse('tgActFailed');
  }

  const after = pressBotButton(target.message, parsed.action, parsed.arg, result);
  if (after !== target.message) {
    await inContext((tx) => saveBotPress(tx, target.outboxId, press.chatId, after));
  }
  await answer(result.reply, result.alert);
  if (after !== target.message) {
    try {
      await deps.telegram?.editKeyboard(press.chatId, press.messageId, botKeyboard(after));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_press' }, 'Telegram: кнопки сообщения не обновлены');
    }
  }
  if (result.send) {
    await sendBotMessage(
      deps,
      { userId: target.userId, chatId: press.chatId },
      result.send.message,
      result.send.kind,
      'bot_press',
    );
  }
}
