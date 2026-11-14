import {
  botChatUsers,
  botPressTarget,
  loadEmployeeAccess,
  lockBotPress,
  messageTemplates,
  openBotAsks,
  orgMenuSettings,
  saveBotPress,
  takeRateLimit,
  withOrgContext,
  type BotChatUser,
} from '@buhuchet/db';
import {
  askBotMessage,
  bishkekDate,
  BOT_COMMANDS,
  BOT_FIND_ACTION,
  botAskLive,
  botKeyboard,
  botTemplate,
  closeBotAsk,
  fillTemplate,
  formatText,
  hasPermission,
  loginDenial,
  parseBotCommand,
  withOrganization,
  type BotCommand,
  type BotCommandCode,
  type BotMessage,
  type CommandTexts,
  type IsoDate,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { sendBotMessage, sendNow } from './bot';
import {
  botMenuRows,
  commandLabel,
  commandMessageFor,
  commandTexts,
  reportsCommandMessage,
} from './command-view';
import { BOT_PRESS_RATE_LIMIT } from './press';
import { BOT_REPLY_ONCE } from './reply';
import { replyTopicOrg } from './topics';

/*
 * Меню команд бота (поток Т, задача Т5; пакет заказчика 13.11.2026, идея 4; прототип v102
 * modules/tg-menu.js — `tgCmd`): «Сегодня», «Неделя», «Просрочено», «Найти контрагента». Команда — обычное
 * сообщение в личном чате: «/today» из меню бота или подпись кнопки под полем ввода.
 *
 * Сообщение само ничего не разрешает. Кому отвечать, бот решает по привязке чата (`botChatUsers`):
 * непривязанному — прежняя подсказка «привяжите Telegram»; привязанному — те же отказы, что у нажатия
 * кнопки (блокировка, временный пароль, разрешение привязать другой Telegram без кода — «Нет права»),
 * у администратора платформы организации нет — тоже «Нет права». Дальше — от имени сотрудника в его
 * организации (RLS): «Напоминания в Telegram» включены и есть право команды; данные — в его области.
 * Чат привязан к нескольким учётным записям — отвечает каждая, с названием организации первой строкой.
 * Команды ничего не меняют, поэтому работают и при выключенных «Действиях из Telegram»; с одного чата —
 * не чаще общего предела нажатий; одно сообщение принимается один раз (Telegram повторяет доставку).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-9

/** Сообщение человека боту в личном чате — возможная команда. */
export interface BotCommandMessage {
  chatId: number;
  fromId: number;
  /** Номер самого сообщения в чате: одно сообщение принимается один раз. */
  messageId: number | null;
  /**
   * Сообщение — ответ (reply) на другое сообщение: подпись кнопки («Просрочено») тогда не команда, а
   * ответ на просьбу бота (например, причина возврата); командой остаётся только «/overdue».
   */
  reply: boolean;
  text: string;
}

export async function botMenu(deps: ApiDeps): Promise<string[][]> {
  return botMenuRows(await messageTemplates(deps.db));
}

/**
 * Подсказка на сообщение, которое бот не понял: в привязанном чате — где команды (и кнопки меню под полем
 * ввода), в непривязанном — прежняя «привяжите Telegram» (кнопки меню убираются: команды там не работают).
 */
export async function sendBotHint(deps: ApiDeps, chatId: number): Promise<void> {
  const [templates, users] = await Promise.all([
    messageTemplates(deps.db),
    botChatUsers(deps.db, chatId),
  ]);
  if (!users.length) {
    const text = fillTemplate(botTemplate('tgStart', templates.tgStart), {});
    await sendNow(deps, chatId, text, 'bot_reply', { menu: [] });
    return;
  }
  const dict = await serverTexts(deps);
  await sendNow(deps, chatId, dict('telegram.cmd.menu_hint'), 'bot_reply', {
    menu: botMenuRows(templates),
  });
}

/** Просьбы поиска этой учётной записи, ещё открытые в чате: новая просьба их отменяет. */
async function openFindAsks(
  deps: ApiDeps,
  chatId: number,
  userId: string,
  today: IsoDate,
): Promise<{ outboxId: string; messageId: number }[]> {
  const out: { outboxId: string; messageId: number }[] = [];
  for (const ask of await openBotAsks(deps.db, chatId, today)) {
    if (ask.action !== BOT_FIND_ACTION) continue;
    const target = await botPressTarget(deps.db, chatId, ask.messageId);
    if (target?.userId === userId)
      out.push({ outboxId: target.outboxId, messageId: ask.messageId });
  }
  return out;
}

interface CommandRun {
  deps: ApiDeps;
  chatId: number;
  command: BotCommand;
  today: IsoDate;
  t: CommandTexts;
  tr: Translate;
  menu: string[][];
  /** Чат привязан к нескольким учётным записям: в ответах — название организации. */
  shared: boolean;
}

/** Ответ одной учётной записи чата на команду. */
async function answerCommand(run: CommandRun, user: BotChatUser): Promise<void> {
  const { deps, chatId, command, today, t, tr, menu, shared } = run;
  const { orgId, employeeId } = user;
  const refuse = () =>
    sendNow(
      deps,
      chatId,
      withOrganization(t.tpl('tgActNoRight'), user.orgName, shared),
      'bot_cmd',
      { menu },
    );
  // Те же отказы, что у нажатия кнопки (`botTargetRefusal`); администратор платформы — не сотрудник.
  if (
    loginDenial(user) ||
    user.mustChangePassword ||
    user.relinkFree ||
    user.isPlatformAdmin ||
    !orgId ||
    !employeeId
  ) {
    await refuse();
    return;
  }
  const stale = command.code === 'find' ? await openFindAsks(deps, chatId, user.userId, today) : [];
  const outcome = await withOrgContext(deps.db, { orgId, userId: user.userId }, async (tx) => {
    const [access, { features }] = [
      await loadEmployeeAccess(tx, employeeId),
      await orgMenuSettings(tx, orgId),
    ];
    if (!access || !features.telegram || !hasPermission(access.subject, command.permission)) {
      return null;
    }
    if (command.code !== 'find') {
      const message = await reportsCommandMessage(
        deps,
        tx,
        { subject: access.subject, orgId },
        command.code,
        { today, t, tr },
      );
      return { message, closed: [] };
    }
    // Новая просьба отменяет прежнюю: бот ждёт один ответ (прототип `tgCmd`).
    const closed: { messageId: number; message: BotMessage }[] = [];
    for (const ask of stale) {
      const current = await lockBotPress(tx, ask.outboxId, chatId);
      if (!current || !botAskLive(current, today)) continue;
      const off = closeBotAsk(current);
      await saveBotPress(tx, ask.outboxId, chatId, off);
      closed.push({ messageId: ask.messageId, message: off });
    }
    const message = askBotMessage(
      t.tpl('tgFindAsk'),
      { action: BOT_FIND_ACTION, kind: 'text', day: today },
      t.tpl('tgBtnCancel'),
    );
    return { message, closed };
  });
  if (!outcome) {
    await refuse();
    return;
  }
  for (const ask of outcome.closed) {
    try {
      await deps.telegram?.editKeyboard(chatId, ask.messageId, botKeyboard(ask.message));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_cmd' }, 'Telegram: кнопки сообщения не обновлены');
    }
  }
  await sendBotMessage(
    deps,
    { userId: user.userId, chatId },
    commandMessageFor(outcome.message, user.orgName, shared),
    command.code === 'find' ? 'bot_ask' : 'bot_cmd',
    'bot_cmd',
    { menu },
  );
}

/**
 * Принять сообщение как команду меню. false — это не команда: сообщение разбирает вебхук дальше (ответ
 * на просьбу бота или подсказка).
 */
export async function handleBotCommand(deps: ApiDeps, msg: BotCommandMessage): Promise<boolean> {
  if (!deps.telegram || msg.fromId !== msg.chatId) return false;
  const templates = await messageTemplates(deps.db);
  const labels = Object.fromEntries(
    BOT_COMMANDS.map((c) => [c.code, commandLabel(templates, c)]),
  ) as Record<BotCommandCode, string>;
  const command = parseBotCommand(msg.text, labels);
  if (!command || (msg.reply && !msg.text.trim().startsWith('/'))) return false;
  const tpl = (key: TelegramTemplateKey) => fillTemplate(botTemplate(key, templates[key]), {});
  const menu = botMenuRows(templates);

  const slot = await takeRateLimit(deps.db, BOT_PRESS_RATE_LIMIT, String(msg.chatId));
  if (!slot.ok) {
    await sendNow(deps, msg.chatId, tpl('tgActFailed'), 'bot_cmd');
    return true;
  }
  if (msg.messageId !== null) {
    const once = await takeRateLimit(deps.db, BOT_REPLY_ONCE, `${msg.chatId}:${msg.messageId}`);
    if (!once.ok) return true;
  }
  const all = await botChatUsers(deps.db, msg.chatId);
  if (!all.length) {
    await sendNow(deps, msg.chatId, tpl('tgStart'), 'bot_cmd', { menu: [] });
    return true;
  }
  // В теме организации (чат нескольких организаций, задача Т7) — ответ по учётным записям этой
  // организации.
  const topicOrg = await replyTopicOrg(deps, msg.chatId);
  const own = topicOrg ? all.filter((u) => u.orgId === topicOrg) : [];
  const users = own.length ? own : all;
  const dict = await serverTexts(deps);
  const tr: Translate = (key, params) => formatText(dict(key), params);
  const run: CommandRun = {
    deps,
    chatId: msg.chatId,
    command,
    today: bishkekDate(deps.clock.now()),
    t: commandTexts(templates, tr),
    tr,
    menu,
    shared: users.length > 1,
  };
  for (const user of users) {
    try {
      await answerCommand(run, user);
    } catch (err) {
      deps.logger.error({ err, command: command.code }, 'Telegram: команда меню не выполнена');
      deps.errors?.capture(err);
      await sendNow(
        deps,
        msg.chatId,
        withOrganization(tpl('tgActFailed'), user.orgName, run.shared),
        'bot_cmd',
        { menu },
      );
    }
  }
  return true;
}
