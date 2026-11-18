import { relinkCodeOf } from '../auth/reset';
import { CP_TG_MESSAGE_KINDS } from '../contractor-page/telegram-pay';
import type { BotMessage } from './bot-message';
import { parseStartCommand } from './messages';
import { CODE_KINDS, OUTBOX_KINDS, type OutboxKind } from './notify';

/*
 * Журнал переписки бота в обе стороны (решение заказчика 17.11.2026; прототип v132 admin/tg-log.js; ТЗ
 * «Доработки 17.11.2026», блок «Админка: запуски по расписанию и переписка бота», пункт 3;
 * docs/decisions.md п. Т-16). Отправленное — журнал отправок сотрудникам и сообщения клиентам с
 * кнопками, полученное — каждое обновление от Telegram, которое бот разбирает. Коды и одноразовые
 * ссылки в журнал не пишутся никогда: вместо текста — «Текст скрыт».
 */

/** Что прислал человек: нажатие кнопки, команда, текст, файл, код, ссылка привязки, бота добавили или удалили. */
export const INBOX_KINDS = [
  'press',
  'command',
  'text',
  'file',
  'code',
  'link',
  'joined',
  'left',
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Итог разбора полученного: получено (итога ещё нет), обработано, не распознано (бот ответил подсказкой), ошибка. */
export const INBOX_STATUSES = ['new', 'done', 'unknown', 'error'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/** Вид чата: личный чат сотрудника, чат клиента контрагента, общий чат фирмы. */
export const JOURNAL_CHAT_KINDS = ['private', 'client', 'group'] as const;
export type JournalChatKind = (typeof JOURNAL_CHAT_KINDS)[number];

/** Почему текст скрыт: в сообщении код или одноразовая ссылка. */
export const JOURNAL_HIDES = ['code', 'link'] as const;
export type JournalHide = (typeof JOURNAL_HIDES)[number];

/** Направление: отправлено ботом или получено ботом. */
export const JOURNAL_DIRS = ['out', 'in'] as const;
export type JournalDir = (typeof JOURNAL_DIRS)[number];

/** Откуда строка журнала: журнал отправок, сообщения клиентам контрагентов, полученные сообщения. */
export const JOURNAL_SOURCES = ['outbox', 'client', 'inbox'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/** Сообщения хранятся и показываются 90 дней (прототип: «Сообщения хранятся 90 дней»). */
export const JOURNAL_DAYS = 90;
/** Период журнала: «Сегодня · 7 дней · 30 дней · 90 дней»; по умолчанию — 7 дней. */
export const JOURNAL_PERIODS = [1, 7, 30, 90] as const;
export type JournalPeriod = (typeof JOURNAL_PERIODS)[number];
export const JOURNAL_PERIOD_DEFAULT: JournalPeriod = 7;

export const INBOX_TEXT_MAX = 4096;
export const INBOX_SENDER_MAX = 100;
export const INBOX_ERROR_MAX = 300;
export const INBOX_FILE_NAME_MAX = 200;

/** Вид строки журнала: вид отправки, сообщение клиенту (`client_pay`) или полученное (`in_press`). */
export const JOURNAL_KINDS = [
  ...OUTBOX_KINDS,
  ...CP_TG_MESSAGE_KINDS.map((k) => `client_${k}` as const),
  ...INBOX_KINDS.map((k) => `in_${k}` as const),
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** Статусы строки журнала: отправленного («Отправлено», «Ожидает», «Ошибка») и полученного. */
export const JOURNAL_STATUSES = ['sent', 'pending', 'error', 'new', 'done', 'unknown'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

/** Ключ словаря с подписью вида: у отправок — прежний `telegram.kind.*`, у остальных — `tgadm.kind.*`. */
export function journalKindKey(kind: string): string {
  return (OUTBOX_KINDS as readonly string[]).includes(kind)
    ? `telegram.kind.${kind}`
    : `tgadm.kind.${kind}`;
}

/** Почему у отправленного сообщения текст скрыт: код или одноразовая ссылка «Задать пароль». */
export function outboxHide(kind: OutboxKind): JournalHide | null {
  if (kind === 'setup_link') return 'link';
  return (CODE_KINDS as readonly string[]).includes(kind) ? 'code' : null;
}

/** Полученное сообщение для журнала: только то, что можно хранить. */
export interface IncomingEntry {
  /** Номер обновления Telegram: повторная доставка того же обновления второй строки не даёт. */
  updateId: number | null;
  chatId: number;
  group: boolean;
  /** «Имя @имя» со слов Telegram — для чата, который ни к кому не привязан. */
  sender: string | null;
  kind: InboxKind;
  /** Текст сообщения или подпись к файлу; у кода и ссылки — пусто. */
  text: string | null;
  hide: JournalHide | null;
  /** Данные нажатой кнопки: по ним база находит подпись кнопки в отправленном сообщении. */
  data: string | null;
  /** Номер сообщения бота, к которому относится нажатие или ответ. */
  replyTo: number | null;
  fileName: string | null;
  fileSize: number | null;
}

type Dict = Record<string, unknown>;
const dict = (v: unknown): Dict | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : null;
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Одной строкой, без управляющих и невидимых знаков, не длиннее предела (по знакам, не по половинкам). */
function clean(value: string, max: number): string {
  const chars = [
    ...value
      .replace(/(?!‍)[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** Текст сообщения для журнала: переносы строк остаются, управляющие знаки — нет. */
function body(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) return null;
  const chars = [...text];
  return chars.length > INBOX_TEXT_MAX ? `${chars.slice(0, INBOX_TEXT_MAX - 1).join('')}…` : text;
}

function senderOf(from: Dict | null): string | null {
  if (!from) return null;
  const first = str(from.first_name);
  const user = str(from.username);
  const name = clean([first, user ? `@${user}` : null].filter(Boolean).join(' '), INBOX_SENDER_MAX);
  return name || null;
}

const GROUP_TYPES = new Set(['group', 'supergroup']);

function chatOf(chat: Dict | null): { chatId: number; group: boolean } | null {
  const chatId = int(chat?.id);
  const type = str(chat?.type);
  if (chatId === null || type === null) return null;
  if (type === 'private') return { chatId, group: false };
  return GROUP_TYPES.has(type) ? { chatId, group: true } : null;
}

const blank = {
  text: null,
  hide: null,
  data: null,
  replyTo: null,
  fileName: null,
  fileSize: null,
} as const;

/**
 * Что записать в журнал о полученном обновлении; null — в журнал не идёт (чужие виды обновлений,
 * сообщения ботов, обычная переписка в группе). Код (шесть цифр) и ссылка «/start <ключ>» идут без
 * текста: в журнале остаётся только вид сообщения.
 */
export function incomingEntry(update: unknown): IncomingEntry | null {
  const u = dict(update);
  if (!u) return null;
  const updateId = int(u.update_id);

  const press = dict(u.callback_query);
  if (press) {
    const from = dict(press.from);
    const message = dict(press.message);
    const chat = chatOf(dict(message?.chat));
    if (!chat || from?.is_bot === true) return null;
    return {
      ...blank,
      updateId,
      ...chat,
      sender: senderOf(from),
      kind: 'press',
      data: str(press.data)?.slice(0, 64) ?? null,
      replyTo: int(message?.message_id),
    };
  }

  const widget = dict(u.widget_query);
  if (widget) {
    const from = dict(widget.from);
    const chat = chatOf(dict(widget.chat));
    if (!chat || from?.is_bot === true) return null;
    return {
      ...blank,
      updateId,
      ...chat,
      sender: senderOf(from),
      kind: 'press',
      replyTo: int(widget.message_id),
    };
  }

  const member = dict(u.my_chat_member);
  if (member) {
    const chat = chatOf(dict(member.chat));
    const status = str(dict(member.new_chat_member)?.status);
    if (!chat || !chat.group || status === null) return null;
    const joined = status === 'member' || status === 'administrator';
    const left = status === 'left' || status === 'kicked';
    if (!joined && !left) return null;
    return {
      ...blank,
      updateId,
      ...chat,
      sender: senderOf(dict(member.from)),
      kind: joined ? 'joined' : 'left',
    };
  }

  const message = dict(u.message);
  if (!message) return null;
  const from = dict(message.from);
  const chat = chatOf(dict(message.chat));
  if (!chat || from?.is_bot === true) return null;
  const text = str(message.text);
  const start = text === null ? null : parseStartCommand(text);
  const base = { ...blank, updateId, ...chat, sender: senderOf(from) };
  if (start?.token) return { ...base, kind: 'link', hide: 'link' };
  // В группе бот разбирает только ссылку подключения: обычная переписка сотрудников в журнал не идёт.
  if (chat.group) return null;
  const replyTo = int(dict(message.reply_to_message)?.message_id);
  if (text !== null) {
    if (relinkCodeOf(text)) return { ...base, kind: 'code', hide: 'code', replyTo };
    const shown = body(text);
    if (shown === null) return null;
    return {
      ...base,
      kind: text.trim().startsWith('/') ? 'command' : 'text',
      text: shown,
      replyTo,
    };
  }
  const document = dict(message.document);
  const photo = Array.isArray(message.photo) ? message.photo.map(dict) : [];
  if (!document && photo.length === 0) return null;
  const caption = str(message.caption);
  const size = document
    ? int(document.file_size)
    : Math.max(0, ...photo.map((p) => int(p?.file_size) ?? 0)) || null;
  const name = document ? str(document.file_name) : null;
  return {
    ...base,
    kind: 'file',
    // Код в подписи к файлу тоже не хранится.
    text: caption === null || relinkCodeOf(caption) ? null : body(caption),
    replyTo,
    fileName: name ? clean(name, INBOX_FILE_NAME_MAX) || null : null,
    fileSize: size,
  };
}

/**
 * Текст отправленного сообщения одной строкой (столбец «Текст»); null — текст скрыт или его нет. У
 * сообщения без своего текста (сообщения клиентам) — заголовок, подзаголовок и текст описания, без
 * таблиц: так же считает запрос списка.
 */
export function journalLine(entry: {
  hide: JournalHide | null;
  text: string | null;
  payload: BotMessage | null;
}): string | null {
  if (entry.hide) return null;
  const p = entry.payload;
  const text = entry.text ?? (p ? [p.heading, p.sub, p.text].filter(Boolean).join(' ') : null);
  if (text === null) return null;
  return text.replace(/\s+/g, ' ').trim() || null;
}

/** Чего нет в журнале полученного: кнопка «Повторить отправку» — только у отправленного. */
export function journalRetryable(entry: {
  src: JournalSource;
  status: string;
  kind: string;
}): boolean {
  return (
    entry.src === 'outbox' &&
    entry.status === 'error' &&
    !(CODE_KINDS as readonly string[]).includes(entry.kind)
  );
}
