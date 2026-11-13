import {
  botPressTarget,
  loadEmployeeAccess,
  lockBotPress,
  markViaTelegram,
  messageTemplates,
  openBotAsks,
  saveBotPress,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  type BotPressTarget,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  askBotMessage,
  bishkekDate,
  BOT_HIDDEN_REPLY_MAX,
  botKeyboard,
  botTemplate,
  closeBotAsk,
  fillTemplate,
  findBotButton,
  formatText,
  hasPermission,
  loginDenial,
  parseBotPress,
  pressBotButton,
  RecordChangedError,
  RecordNotFoundError,
  type BotButton,
  type BotMessage,
  type OutboxKind,
  type PermissionId,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { BOT_ACTIONS } from './actions';
import { botText, sendBotMessage } from './bot';
import { queueTelegramEvents, type TelegramEvent } from './events';
import { flushEvents } from './outbox';

/*
 * Нажатие кнопки под сообщением бота (поток Т, задача Т1; прототип modules/tg-chat.js — `tgPress`,
 * `tgRefusal`). Данные нажатия сами ничего не разрешают: бот находит своё отправленное сообщение по
 * чату и номеру, сверяет, что такая кнопка в нём была и ещё активна, и что чат всё ещё привязан к той
 * учётной записи, которой сообщение отправлено. Дальше действие выполняется от имени этого
 * пользователя в его организации (RLS), записи истории получают пометку «через Telegram».
 *
 * Ядро проверяет: личный чат и нажал его хозяин; сообщение и кнопка; привязка; блокировка учётной
 * записи и организации, временный пароль; «Действия из Telegram» организации — у действий, которые
 * меняют данные; право действия (`permission`). Область «Свои / Все контрагенты» по записи и условия
 * самого действия проверяет его обработчик — тем же правилом, что метод сайта (тесты прав, области
 * и изоляции — у потока, который добавил действие).
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
   * Транзакция нажатия от имени нажавшего: в его организации (RLS), с его правами и областью
   * (`access`); всё, что в ней пишется в историю, помечается «через Telegram». Она одна на всё
   * нажатие: вместе с действием гаснет кнопка, сбой действия откатывает всё. Свою транзакцию мимо неё
   * (`ctx.deps.db`) обработчик не открывает — иначе запись останется без отметки и без отката.
   */
  asUser<T>(fn: (tx: Tx, access: BotPressAccess) => Promise<T>): Promise<T>;
  /** Текст шаблона бота: для скрытого ответа и новой подписи кнопки. */
  text(
    key: TelegramTemplateKey,
    values?: Readonly<Record<string, string | number>>,
  ): Promise<string>;
  /** Текст словаря интерфейса с подстановками. */
  tr: Translate;
}

/**
 * Тексты нажатия — шаблоны бота и словарь — читаются до транзакции нажатия: внутри неё `ctx.text` и
 * `ctx.tr` второго соединения с базой не берут. Иначе одновременные нажатия (каждое держит соединение
 * своей транзакции и ждёт ещё одно ради текста) могли бы занять все соединения и встать.
 */
export async function botPressTexts(deps: ApiDeps): Promise<Pick<BotPressContext, 'text' | 'tr'>> {
  const [templates, dict] = await Promise.all([messageTemplates(deps.db), serverTexts(deps)]);
  return {
    text: async (key, values = {}) => fillTemplate(botTemplate(key, templates[key]), values),
    tr: (key, params) => formatText(dict(key), params),
  };
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
  /** Новое сообщение в чат после действия. */
  send?: { message: BotMessage; kind: OutboxKind };
  /**
   * Действию нужен ответ (задача Т2; прототип v97 `r.ask`): бот отдельным сообщением с кнопкой «Отмена»
   * просит файл или текст и ждёт до конца дня. Ответ получит `reply` действия `action` с той же
   * записью. Нажатая кнопка пока не меняется: она погаснет, когда ответ будет принят. Такая просьба уже
   * открыта — вторую бот не шлёт, а скрыто отвечает «уже жду ответ».
   */
  ask?: { text: string; action: string; kind: 'file' | 'text' };
  /** Сообщение, под которым нажали, — просьба бота: больше ответа не ждать («Отмена»). */
  closeAsk?: boolean;
  /** Сообщения другим сотрудникам о сделанном: в очередь в той же транзакции, отправка — после неё. */
  events?: readonly TelegramEvent[];
  /**
   * Строки очереди, которые обработчик сам поставил в транзакции нажатия (`enqueueTelegram` — когда
   * нужен свой ключ «один раз в день»): после транзакции они отправляются сразу, как `events`.
   */
  queued?: readonly string[];
}

/** Файл, присланный боту и уже положенный в хранилище организации (ключ — с номером от сервера). */
export interface BotReplyFile {
  id: string;
  name: string;
  /** Фактический размер. */
  size: number;
  contentType: string;
  storageKey: string;
}

/** Ответ человека на просьбу бота: текст либо файл с подписью (одной строкой; пустая — null). */
export type BotReply = { text: string } | { file: BotReplyFile; note: string | null };

export interface BotReplyResult {
  /** Ответ не подошёл (пустая причина): бот пишет это в чат и ждёт другой ответ на ту же просьбу. */
  again?: string;
  /** Ответ принят: кнопка, которой открыта просьба, гаснет с этой подписью. */
  done?: string;
  /** Коды действий, чьи кнопки под тем же сообщением гаснут. */
  off?: readonly string[];
  /** Что бот пишет в чат после ответа (обычным сообщением: скрытого ответа у сообщения нет). */
  say?: string;
  /** Присланный файл прикреплён к записи; иначе после транзакции он удаляется из хранилища. */
  fileKept?: boolean;
  events?: readonly TelegramEvent[];
}

/** Что знает обработчик ответа: то же, что обработчик нажатия, без кнопки. */
export type BotReplyContext = Omit<BotPressContext, 'button'>;

export interface BotAction {
  /** Действие меняет данные: выключается владельцем («Действия из Telegram»). */
  change?: boolean;
  /**
   * Действие данные не меняет, но пишет другим людям или читает много: в предел частоты нажатий входит
   * так же, как меняющее данные («Напомнить», задача Т3).
   */
  limited?: boolean;
  /**
   * Право из 40, без которого действие не выполняется: ядро проверяет его до обработчика («Нет
   * права»). Область «Свои / Все контрагенты» по конкретной записи и условия действия проверяет сам
   * обработчик. У действия с правом администратор платформы (не сотрудник) получает отказ.
   */
  permission?: PermissionId;
  /**
   * Защита учётной записи, а не работа с данными организации («Это не я», задача Т4; прототип v101 —
   * `prev: true`): кнопка принимается в том чате, куда ушло сообщение, даже если он уже отвязан
   * (сообщения о замене и отвязке Telegram приходят в прежний чат). У такого действия нет права и
   * `change` — выключатель «Действия из Telegram» на него не влияет. Отказы — `securityRefusal`.
   */
  security?: boolean;
  /** Нажатие кнопки. У действия, которое только принимает ответ на просьбу, его нет. */
  run?(ctx: BotPressContext): Promise<BotPressResult>;
  /**
   * Ответ на просьбу бота (файл или текст): те же проверки ядра и та же одна транзакция, что у нажатия.
   * Без `again` просьба закрывается.
   */
  reply?(ctx: BotReplyContext, reply: BotReply): Promise<BotReplyResult>;
}

/** Действие реестра по коду: только свои ключи (`constructor`, `toString` — не действия). */
export function botActionOf(deps: ApiDeps, code: string): BotAction | undefined {
  const actions = deps.botActions ?? BOT_ACTIONS;
  return Object.hasOwn(actions, code) ? actions[code] : undefined;
}

/**
 * Общие отказы ядра по получателю сообщения — одни для нажатия и для ответа на просьбу (прототип
 * `tgRefusal`): привязка; вход закрыт — как на сайте (блокировка, временный пароль, разрешение привязать
 * другой Telegram без кода после сброса пароля, docs/deviations.md п. О-20); «Действия из Telegram».
 */
export function botTargetRefusal(
  target: BotPressTarget,
  action: BotAction,
): TelegramTemplateKey | null {
  if (action.security) return securityRefusal(target);
  if (!target.linked) return 'tgActNoLink';
  if (loginDenial(target) || target.mustChangePassword || target.relinkFree) return 'tgActNoRight';
  if (action.change && !target.isPlatformAdmin && !target.telegramActions) return 'tgActOff';
  return null;
}

/**
 * Отказы действия защиты учётной записи («Это не я»): привязка чата не нужна. Учётная запись или
 * организация заблокированы — войти и так нельзя («Нет права»). Пароль сброшен (временный) или после
 * сброса разрешено привязать другой Telegram без кода — «Кнопка устарела»: новый пароль уже выдал
 * владелец или администратор платформы, сеансы завершены, а прежний чат мог остаться у постороннего —
 * закрыть вход заново и отменить разрешение ему нельзя.
 */
function securityRefusal(target: BotPressTarget): TelegramTemplateKey | null {
  if (loginDenial(target)) return 'tgActNoRight';
  if (target.mustChangePassword || target.relinkFree) return 'tgActStale';
  return null;
}

/** Транзакция от имени получателя сообщения с пометкой «через Telegram». */
export function botUserContext<T>(
  deps: ApiDeps,
  target: BotPressTarget,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const marked = async (tx: Tx) => {
    await markViaTelegram(tx);
    return fn(tx);
  };
  return target.orgId
    ? withOrgContext(deps.db, { orgId: target.orgId, userId: target.userId }, marked)
    : withUserContext(deps.db, target.userId, marked);
}

export const botUserOf = (target: BotPressTarget): BotPressUser => ({
  userId: target.userId,
  orgId: target.orgId,
  employeeId: target.employeeId,
  login: target.login,
  orgName: target.orgName,
  isPlatformAdmin: target.isPlatformAdmin,
});

/** Нажатие из обновления Telegram (`callback_query`). */
export interface BotPress {
  callbackId: string;
  fromId: number;
  chatId: number;
  chatType: string;
  messageId: number;
  data: string;
}

/** Нажатий кнопок, меняющих данные, с одного чата — не больше стольких в минуту. */
export const BOT_PRESS_RATE_LIMIT: RateLimit = { kind: 'bot_press', max: 60, windowSeconds: 60 };

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

  // Кнопки работают только в личном чате, и нажать может только его хозяин; отказы — окном.
  // ОТКЛОНЕНИЕ: docs/deviations.md#Т-2
  if (press.chatType !== 'private' || press.fromId !== press.chatId) return answer();
  const parsed = parseBotPress(press.data);
  const target = parsed ? await botPressTarget(deps.db, press.chatId, press.messageId) : null;
  if (!parsed || !target) return refuse('tgActStale');
  // Порядок отказов — как `tgRefusal` прототипа: сначала «такой кнопки нет», потом привязка и вход.
  const action = botActionOf(deps, parsed.action);
  const run = action?.run?.bind(action);
  if (!findBotButton(target.message, parsed.action, parsed.arg) || !action || !run) {
    return refuse('tgActStale');
  }
  const denied = botTargetRefusal(target, action);
  if (denied) return refuse(denied);
  // Действие, меняющее данные, — не чаще предела с одного чата (docs/decisions.md п. Т-1): человек столько
  // не нажимает, а поток нажатий не должен держать транзакции и блокировки записей.
  if (action.change || action.limited) {
    const slot = await takeRateLimit(deps.db, BOT_PRESS_RATE_LIMIT, String(press.chatId));
    if (!slot.ok) return refuse('tgActFailed');
  }
  const today = bishkekDate(deps.clock.now());
  const texts = await botPressTexts(deps);

  // Нажатие — одна транзакция от имени получателя: строка сообщения блокируется, кнопка сверяется ещё
  // раз (два быстрых нажатия и повторная доставка от Telegram идут по одному), действие выполняется, и
  // кнопка гаснет вместе с ним. Сбой действия откатывает всё, кнопка остаётся активной.
  type Done = {
    result: BotPressResult;
    after: BotMessage | null;
    ask: BotMessage | null;
    queued: string[];
  };
  let outcome: Done | { refusal: TelegramTemplateKey };
  try {
    outcome = await botUserContext(deps, target, async (tx) => {
      const current = await lockBotPress(tx, target.outboxId, press.chatId);
      const button = current && findBotButton(current, parsed.action, parsed.arg);
      if (!current || !button) return { refusal: 'tgActStale' as const };
      const access = target.employeeId ? await loadEmployeeAccess(tx, target.employeeId) : null;
      if (action.permission && !(access && hasPermission(access.subject, action.permission))) {
        return { refusal: 'tgActNoRight' as const };
      }
      const ctx: BotPressContext = {
        deps,
        user: botUserOf(target),
        chatId: press.chatId,
        arg: parsed.arg,
        message: current,
        button,
        asUser: (fn) => fn(tx, access),
        ...texts,
      };
      const result = await run(ctx);
      // Действию нужен ответ: просьба с «Отменой» уйдёт после транзакции. Такая же уже открыта в этом
      // чате — вторую не шлём (прототип `tgPress`: «бот уже ждёт ваш ответ»).
      let ask: BotMessage | null = null;
      if (result.ask) {
        const wanted = result.ask;
        const open = await openBotAsks(tx, press.chatId, today);
        if (open.some((x) => x.action === wanted.action && x.arg === parsed.arg)) {
          result.reply = await texts.text('tgActAskWait');
          result.alert = false;
        } else {
          ask = askBotMessage(
            wanted.text,
            {
              action: wanted.action,
              ...(parsed.arg ? { arg: parsed.arg } : {}),
              kind: wanted.kind,
              day: today,
              src: { messageId: press.messageId, action: parsed.action },
            },
            await texts.text('tgBtnCancel'),
          );
        }
      }
      const queued = [
        ...(result.queued ?? []),
        ...(result.events?.length ? await queueTelegramEvents(deps, tx, result.events) : []),
      ];
      const pressed = pressBotButton(current, parsed.action, parsed.arg, result);
      const after = result.closeAsk ? closeBotAsk(pressed) : pressed;
      if (after === current) return { result, after: null, ask, queued };
      await saveBotPress(tx, target.outboxId, press.chatId, after);
      return { result, after, ask, queued };
    });
  } catch (err) {
    // Запись изменили или удалили, пока сообщение лежало в чате, — «Кнопка устарела».
    if (err instanceof RecordChangedError || err instanceof RecordNotFoundError) {
      return refuse('tgActStale');
    }
    deps.logger.error({ err, action: parsed.action }, 'Telegram: действие по кнопке не выполнено');
    deps.errors?.capture(err);
    return refuse('tgActFailed');
  }
  if ('refusal' in outcome) return refuse(outcome.refusal);

  const { result, after, ask, queued } = outcome;
  await answer(result.reply, result.alert);
  if (after) {
    try {
      await deps.telegram?.editKeyboard(press.chatId, press.messageId, botKeyboard(after));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_press' }, 'Telegram: кнопки сообщения не обновлены');
    }
  }
  const to = { userId: target.userId, chatId: press.chatId };
  if (result.send) {
    await sendBotMessage(deps, to, result.send.message, result.send.kind, 'bot_press');
  }
  if (ask) await sendBotMessage(deps, to, ask, 'bot_ask', 'bot_ask');
  if (target.orgId) await flushEvents(deps, target.orgId, queued);
}
