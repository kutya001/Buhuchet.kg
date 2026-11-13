import { randomUUID } from 'node:crypto';
import { orgFileKey } from '@buhuchet/adapters';
import {
  botPressTarget,
  loadEmployeeAccess,
  lockBotPress,
  openBotAsks,
  saveBotPress,
  takeRateLimit,
  type BotPressTarget,
  type RateLimit,
} from '@buhuchet/db';
import {
  bishkekDate,
  botAskLive,
  botKeyboard,
  closeBotAsk,
  FILE_MAX_BYTES,
  fileContentType,
  fileUploadProblem,
  hasPermission,
  pressBotButton,
  RecordChangedError,
  RecordNotFoundError,
  type BotMessage,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import { FILE_NOTE_MAX } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import { FILES_SECTION, UPLOAD_RATE_LIMIT } from '../files/files';
import { botText, sendNow } from './bot';
import { queueTelegramEvents } from './events';
import { flushEvents } from './outbox';
import {
  botActionOf,
  botTargetRefusal,
  botUserContext,
  botUserOf,
  type BotReply,
  type BotReplyContext,
  type BotReplyFile,
  type BotReplyResult,
} from './press';

/*
 * Ответ на просьбу бота (поток Т, задача Т2; решение заказчика 13.11.2026: «если нужно прикрепить файл —
 * отправить боту файл, если нет файла, задача не будет сдана»; прототип v97 modules/tg-chat.js —
 * `tgReply`, `tgAskOpen`, `tgFileWhy`). Бот ждёт файл или текст на своё сообщение-просьбу: что он ждёт,
 * записано в описании этого сообщения в журнале отправок (`ask`). Ответ принимается, если человек
 * ответил на это сообщение или просто прислал файл (текст) в чат — тогда берётся последняя открытая
 * просьба чата за сегодня. Просьба без дня ждёт только ответа именно на своё сообщение.
 *
 * Сообщение человека само ничего не разрешает: просьба ищется по чату, получатель и привязка — как у
 * нажатия кнопки (`botPressTarget`), проверки ядра — те же (`botTargetRefusal`, право действия), действие
 * идёт от имени получателя в его организации одной транзакцией с пометкой «через Telegram». Присланный
 * файл проверяется как на сайте (имя, тип, 20 МБ), скачивается у Telegram и кладётся в хранилище
 * организации до транзакции; не пригодился — удаляется.
 */

/** Сообщение человека боту в личном чате. */
export interface BotIncoming {
  chatId: number;
  fromId: number;
  /** Номер сообщения, на которое ответили. */
  replyTo: number | null;
  text: string | null;
  /** Документ или фото: номер файла у Telegram, имя и размер со слов Telegram. */
  file: { fileId: string; name: string; size: number } | null;
  /** Подпись к файлу. */
  caption: string | null;
}

/** Ответы на просьбы из одного чата: не чаще 30 в минуту (каждый — запросы к базе и хранилищу). */
export const BOT_REPLY_RATE_LIMIT: RateLimit = { kind: 'bot_reply', max: 30, windowSeconds: 60 };

/** Подпись к файлу — примечание файла: одна строка, без управляющих знаков, не длиннее предела сайта. */
export function botFileNote(caption: string | null): string | null {
  const note = (caption ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FILE_NOTE_MAX);
  return note || null;
}

/** Сообщение-просьба, к которой относится ответ; null — бот ничего не ждёт. */
async function askTarget(
  deps: ApiDeps,
  msg: BotIncoming,
  today: string,
): Promise<{ target: BotPressTarget; messageId: number } | null> {
  if (msg.replyTo !== null) {
    const target = await botPressTarget(deps.db, msg.chatId, msg.replyTo);
    if (target && botAskLive(target.message, today)) return { target, messageId: msg.replyTo };
  }
  // Ответили не на просьбу или без ответа — последняя открытая просьба чата за сегодня.
  for (const open of await openBotAsks(deps.db, msg.chatId, today)) {
    const target = await botPressTarget(deps.db, msg.chatId, open.messageId);
    if (target && botAskLive(target.message, today)) return { target, messageId: open.messageId };
  }
  return null;
}

/**
 * Принять сообщение как ответ на просьбу бота. false — бот в этом чате ничего не ждёт: сообщение
 * разбирает вебхук, как раньше.
 */
export async function handleBotReply(deps: ApiDeps, msg: BotIncoming): Promise<boolean> {
  if (!deps.telegram || msg.fromId !== msg.chatId) return false;
  const today = bishkekDate(deps.clock.now());
  const found = await askTarget(deps, msg, today);
  if (!found) return false;
  const { target, messageId } = found;
  const ask = target.message.ask!;
  const say = (text: string) => sendNow(deps, msg.chatId, text, 'bot_reply');
  const sayKey = async (
    key: TelegramTemplateKey,
    values?: Readonly<Record<string, string | number>>,
  ) => say(await botText(deps, key, values));

  const slot = await takeRateLimit(deps.db, BOT_REPLY_RATE_LIMIT, String(msg.chatId));
  if (!slot.ok) {
    await sayKey('tgActFailed');
    return true;
  }
  const action = botActionOf(deps, ask.action);
  const run = action?.reply?.bind(action);
  if (!action || !run) {
    await sayKey('tgActStale');
    return true;
  }
  const denied = botTargetRefusal(target, action);
  if (denied) {
    await sayKey(denied);
    return true;
  }
  // Бот ждал другое: объясняет и ждёт дальше (прототип: `again`).
  if (ask.kind === 'file' && !msg.file) {
    await sayKey('tgAskNeedFile');
    return true;
  }
  const text = (msg.text ?? '').trim();
  if (ask.kind === 'text' && (msg.file || !text)) {
    await sayKey('tgAskNeedText');
    return true;
  }

  // Файл: проверка как на сайте — до скачивания; скачивается и кладётся в хранилище до транзакции.
  let file: BotReplyFile | null = null;
  if (ask.kind === 'file' && msg.file) {
    const name = msg.file.name.trim();
    const tooBig = () => sayKey('tgFileBig', { мб: FILE_MAX_BYTES / 1048576 });
    const problem = fileUploadProblem({ name, size: msg.file.size });
    if (problem === 'file_too_large') {
      await tooBig();
      return true;
    }
    if (problem) {
      await sayKey('tgFileType');
      return true;
    }
    // Файл кладётся в хранилище организации: у администратора платформы её нет.
    if (!target.orgId) {
      await sayKey('tgActNoRight');
      return true;
    }
    const uploads = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, target.userId);
    if (!uploads.ok) {
      await sayKey('tgActFailed');
      return true;
    }
    const loaded = await deps.telegram.loadFile(msg.file.fileId, FILE_MAX_BYTES);
    if (!loaded.ok) {
      if (loaded.reason === 'too_large') await tooBig();
      else {
        deps.logger.warn(
          { purpose: 'bot_reply', description: loaded.description },
          'Telegram: файл не скачан',
        );
        await sayKey('tgActFailed');
      }
      return true;
    }
    if (loaded.body.byteLength === 0) {
      await sayKey('tgAskNeedFile');
      return true;
    }
    const id = randomUUID();
    const storageKey = orgFileKey(target.orgId, FILES_SECTION, id);
    const contentType = fileContentType(name);
    try {
      await deps.storage.put(storageKey, loaded.body, { contentType });
    } catch (err) {
      deps.logger.error({ err, fileId: id }, 'Telegram: файл не положен в хранилище');
      deps.errors?.capture(err);
      await sayKey('tgActFailed');
      return true;
    }
    file = { id, name, size: loaded.body.byteLength, contentType, storageKey };
  }
  const dropFile = async () => {
    if (!file) return;
    try {
      await deps.storage.delete(file.storageKey);
    } catch (err) {
      deps.logger.error(
        { err, fileId: file.id, key: file.storageKey },
        'Telegram: лишний файл не удалён из хранилища',
      );
    }
  };
  const reply: BotReply = file ? { file, note: botFileNote(msg.caption) } : { text };

  // Кнопка, которой открыта просьба: после принятого ответа она гаснет — как после нажатия.
  const source = ask.src ? await botPressTarget(deps.db, msg.chatId, ask.src.messageId) : null;

  type Done = {
    result: BotReplyResult;
    closed: BotMessage | null;
    pressed: BotMessage | null;
    queued: string[];
  };
  let outcome: Done | { refusal: TelegramTemplateKey };
  try {
    outcome = await botUserContext(deps, target, async (tx) => {
      // Строка просьбы блокируется: два ответа подряд и повторная доставка идут по одному.
      const current = await lockBotPress(tx, target.outboxId, msg.chatId);
      if (!current || !botAskLive(current, today)) return { refusal: 'tgActStale' as const };
      const access = target.employeeId ? await loadEmployeeAccess(tx, target.employeeId) : null;
      if (action.permission && !(access && hasPermission(access.subject, action.permission))) {
        return { refusal: 'tgActNoRight' as const };
      }
      const ctx: BotReplyContext = {
        deps,
        user: botUserOf(target),
        chatId: msg.chatId,
        arg: ask.arg ?? null,
        message: current,
        asUser: (fn) => fn(tx, access),
        text: (key, values) => botText(deps, key, values),
      };
      const result = await run(ctx, reply);
      if (result.again !== undefined) return { result, closed: null, pressed: null, queued: [] };
      const closed = closeBotAsk(current);
      await saveBotPress(tx, target.outboxId, msg.chatId, closed);
      let pressed: BotMessage | null = null;
      if (ask.src && source && source.userId === target.userId) {
        const before = await lockBotPress(tx, source.outboxId, msg.chatId);
        const after = before && pressBotButton(before, ask.src.action, ask.arg ?? null, result);
        if (before && after && after !== before) {
          await saveBotPress(tx, source.outboxId, msg.chatId, after);
          pressed = after;
        }
      }
      const queued = result.events?.length
        ? await queueTelegramEvents(deps, tx, result.events)
        : [];
      return { result, closed, pressed, queued };
    });
  } catch (err) {
    await dropFile();
    // Запись изменили или удалили, пока бот ждал ответ.
    if (err instanceof RecordChangedError || err instanceof RecordNotFoundError) {
      await sayKey('tgActStale');
      return true;
    }
    deps.logger.error({ err, action: ask.action }, 'Telegram: ответ на просьбу не обработан');
    deps.errors?.capture(err);
    await sayKey('tgActFailed');
    return true;
  }
  if ('refusal' in outcome) {
    await dropFile();
    await sayKey(outcome.refusal);
    return true;
  }

  const { result, closed, pressed, queued } = outcome;
  if (!result.fileKept) await dropFile();
  if (result.again !== undefined) {
    await say(result.again);
    return true;
  }
  const edit = async (id: number, message: BotMessage) => {
    try {
      await deps.telegram?.editKeyboard(msg.chatId, id, botKeyboard(message));
    } catch (err) {
      deps.logger.warn({ err, purpose: 'bot_reply' }, 'Telegram: кнопки сообщения не обновлены');
    }
  };
  if (closed) await edit(messageId, closed);
  if (pressed && ask.src) await edit(ask.src.messageId, pressed);
  if (result.say) await say(result.say);
  if (target.orgId) await flushEvents(deps, target.orgId, queued);
  return true;
}
