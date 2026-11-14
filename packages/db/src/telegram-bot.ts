import { asBotMessage, CODE_KINDS, type BotMessage, type OutboxKind } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { writePlatformHistory } from './platform-history';
import { platformReference } from './schema';

/*
 * Основа бота (поток Т, задача Т1; миграции 0121–0122): сообщения с кнопками и нажатия. Вебхук бота
 * работает без входа и без организации, поэтому сообщение по нажатию находит функция
 * `app.telegram_press_target`, а всё остальное идёт уже от имени нажавшего — в его организации (RLS).
 */

const isCodeKind = (kind: OutboxKind) => (CODE_KINDS as readonly OutboxKind[]).includes(kind);

/**
 * Сообщение, отправленное сразу, — в журнал отправок вместе с описанием сообщения (по нему принимаются
 * нажатия кнопок) и номером сообщения в чате. У сообщений с кодом текст и описание не пишутся.
 */
export async function logBotMessage(
  db: Db | Tx,
  entry: {
    userId: string;
    chatId: number;
    kind: OutboxKind;
    text: string;
    ok: boolean;
    error?: string;
    message?: BotMessage | null;
    messageId?: number | null;
  },
): Promise<void> {
  const code = isCodeKind(entry.kind);
  const payload = code || !entry.message ? null : JSON.stringify(entry.message);
  await db.execute(
    sql`select app.telegram_log(${entry.userId}, ${entry.chatId}, ${entry.kind}, ${code ? null : entry.text}, ${entry.ok}, ${entry.error ?? null}, ${payload}::jsonb, ${entry.messageId ?? null}::bigint)`,
  );
}

/** Сообщение, под которым нажали кнопку, и состояние учётной записи того, кому оно отправлено. */
export interface BotPressTarget {
  outboxId: string;
  userId: string;
  orgId: string | null;
  employeeId: string | null;
  login: string;
  orgName: string | null;
  message: BotMessage;
  /** Чат, из которого нажали, всё ещё привязан к этой учётной записи. */
  linked: boolean;
  /** Пароль сброшен (временный): на сайте доступна только смена пароля, кнопки не действуют. */
  mustChangePassword: boolean;
  /** После сброса пароля разрешено привязать другой Telegram без кода — кнопки не действуют. */
  relinkFree: boolean;
  isPlatformAdmin: boolean;
  userBlocked: boolean;
  employeeActive: boolean | null;
  orgStatus: 'active' | 'blocked' | null;
  /** «Действия из Telegram» организации (у администратора платформы — всегда включены). */
  telegramActions: boolean;
}

/**
 * Найти отправленное сообщение с кнопками по чату и номеру сообщения. null — такого сообщения бот не
 * отправлял (или в нём нет кнопок-действий): нажатие не принимается.
 */
export async function botPressTarget(
  db: Db,
  chatId: number,
  messageId: number,
): Promise<BotPressTarget | null> {
  const [row] = await db.execute<{
    outbox_id: string;
    user_id: string;
    org_id: string | null;
    employee_id: string | null;
    login: string;
    org_name: string | null;
    payload: unknown;
    linked: boolean;
    must_change_password: boolean;
    relink_free: boolean;
    is_platform_admin: boolean;
    user_blocked: boolean;
    employee_active: boolean | null;
    org_status: 'active' | 'blocked' | null;
    telegram_actions: boolean;
  }>(sql`select * from app.telegram_press_target(${chatId}::bigint, ${messageId}::bigint)`);
  if (!row) return null;
  const message = asBotMessage(
    typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  );
  if (!message) return null;
  return {
    outboxId: row.outbox_id,
    userId: row.user_id,
    orgId: row.org_id,
    employeeId: row.employee_id,
    login: row.login,
    orgName: row.org_name,
    message,
    linked: row.linked,
    mustChangePassword: row.must_change_password,
    relinkFree: row.relink_free,
    isPlatformAdmin: row.is_platform_admin,
    userBlocked: row.user_blocked,
    employeeActive: row.employee_active,
    orgStatus: row.org_status,
    telegramActions: row.telegram_actions,
  };
}

/**
 * Взять сообщение на обработку нажатия: строка журнала блокируется до конца транзакции (нажатия одного
 * сообщения идут по одному), возвращается её описание на этот момент. Только своё сообщение:
 * вызывается в транзакции от имени нажавшего. null — сообщение не найдено.
 */
export async function lockBotPress(
  tx: Tx,
  outboxId: string,
  chatId: number,
): Promise<BotMessage | null> {
  const [row] = await tx.execute<{ payload: unknown }>(
    sql`select app.telegram_press_lock(${outboxId}::uuid, ${chatId}::bigint) as payload`,
  );
  if (!row?.payload) return null;
  return asBotMessage(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
}

/**
 * Запомнить сообщение после нажатия (кнопка стала неактивной). Только своё сообщение: вызывается в
 * транзакции от имени нажавшего. false — сообщение не найдено.
 */
export async function saveBotPress(
  tx: Tx,
  outboxId: string,
  chatId: number,
  message: BotMessage,
): Promise<boolean> {
  const [row] = await tx.execute<{ ok: boolean | null }>(
    sql`select app.telegram_press_save(${outboxId}::uuid, ${chatId}::bigint, ${JSON.stringify(message)}::jsonb) as ok`,
  );
  return row?.ok === true;
}

/** Открытая просьба бота в чате: номер сообщения-просьбы и что бот ждёт. */
export interface OpenBotAsk {
  messageId: number;
  action: string;
  arg: string | null;
  kind: 'file' | 'text';
}

/**
 * Открытые просьбы бота в чате за день `day` (поток Т, задача Т2): сначала последняя. К ней относится
 * файл или текст, присланный без ответа на сообщение; по ним же видно, что такую просьбу бот уже
 * отправил. Чей чат и можно ли действовать — дальше `botPressTarget` по номеру сообщения.
 */
export async function openBotAsks(db: Db | Tx, chatId: number, day: string): Promise<OpenBotAsk[]> {
  const rows = await db.execute<{ message_id: string | number; ask: unknown }>(
    sql`select message_id, ask from app.telegram_open_asks(${chatId}::bigint, ${day})`,
  );
  const out: OpenBotAsk[] = [];
  for (const row of rows) {
    const ask = (typeof row.ask === 'string' ? JSON.parse(row.ask) : row.ask) as {
      action?: unknown;
      arg?: unknown;
      kind?: unknown;
    } | null;
    if (!ask || typeof ask.action !== 'string') continue;
    if (ask.kind !== 'file' && ask.kind !== 'text') continue;
    out.push({
      messageId: Number(row.message_id),
      action: ask.action,
      arg: typeof ask.arg === 'string' ? ask.arg : null,
      kind: ask.kind,
    });
  }
  return out;
}

/**
 * Пометить транзакцию «через Telegram»: записи истории (`audit_log`, `status_history`), сделанные в ней,
 * получают `via = 'telegram'` значением столбца по умолчанию.
 */
export async function markViaTelegram(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.via', 'telegram', true)`);
}

/** Что сделало нажатие «Это не я» (поток Т, задача Т4). */
export interface TelegramNotMeResult {
  /**
   * done — выполнено; locked — вход уже закрыт этой кнопкой; reset — пароль сброшен владельцем или
   * администратором платформы (кнопка из прежнего чата не действует); denied — учётная запись
   * заблокирована.
   */
  status: 'done' | 'locked' | 'reset' | 'denied';
  /** Сколько сеансов завершено. */
  sessions: number;
  /** Отвязан другой Telegram, привязанный вместо чата, из которого нажали; его имя — для истории. */
  cut: { username: string | null; firstName: string | null } | null;
  /** Вход закрыт (у администратора платформы — нет: новый пароль ему выдать некому). */
  locked: boolean;
  /** Нажал владелец организации: новый пароль ему выдаёт администратор платформы. */
  isOwner: boolean;
  /** Строки очереди: сообщения тем, кто выдаёт новый пароль. */
  queued: string[];
}

/**
 * «Это не я» под сообщением бота о безопасности — в транзакции нажатия от имени получателя сообщения
 * (миграция 0135, `app.telegram_not_me`): сеансы завершены, другой Telegram отвязан, ожидающие коды и
 * ссылки отменены, вход закрыт, тем, кто выдаёт новый пароль, — сообщения в очередь (`staffText` — о
 * сотруднике владельцам организации, `ownerText` — о владельце администраторам платформы; null — не
 * писать). null — такого сообщения этому пользователю в этот чат бот не отправлял.
 */
export async function telegramNotMe(
  tx: Tx,
  input: {
    chatId: number;
    staffText: string | null;
    ownerText: string | null;
    now: Date;
    /** Сколько часов действует кнопка: сообщение с ней должно быть не старше. */
    hours: number;
  },
): Promise<TelegramNotMeResult | null> {
  const [row] = await tx.execute<{
    status: TelegramNotMeResult['status'];
    sessions: number;
    cut: boolean;
    cut_username: string | null;
    cut_first_name: string | null;
    locked: boolean;
    is_owner: boolean;
    queued: string[] | string;
  }>(
    sql`select * from app.telegram_not_me(${input.chatId}::bigint, ${input.staffText}, ${input.ownerText}, ${input.now.toISOString()}::timestamptz, ${input.hours}::integer)`,
  );
  if (!row) return null;
  // Массив uuid драйвер отдаёт списком или текстом «{a,b}».
  const queued = Array.isArray(row.queued)
    ? row.queued
    : row.queued
        .replace(/^\{|\}$/g, '')
        .split(',')
        .filter(Boolean);
  return {
    status: row.status,
    sessions: Number(row.sessions),
    cut: row.cut ? { username: row.cut_username, firstName: row.cut_first_name } : null,
    locked: row.locked,
    isOwner: row.is_owner,
    queued,
  };
}

/**
 * Кнопка «Это не я» сейчас ничего не сделает: у пользователя временный пароль или действует разрешение
 * привязать Telegram без кода — пароль сбросил владелец или администратор платформы. Сообщение о
 * безопасности в это время уходит с кнопкой, которая только объясняет, что делать.
 */
export async function telegramNotMeInert(db: Db | Tx, userId: string): Promise<boolean> {
  const [row] = await db.execute<{ inert: boolean | null }>(
    sql`select app.telegram_not_me_inert(${userId}::uuid) as inert`,
  );
  return row?.inert === true;
}

/** «Сообщения простым текстом» пользователя (хранится у пользователя и отвязку переживает). */
export async function telegramPlainText(db: Db | Tx, userId: string): Promise<boolean> {
  const [row] = await db.execute<{ plain: boolean | null }>(
    sql`select app.telegram_plain_text(${userId}::uuid) as plain`,
  );
  return row?.plain === true;
}

/**
 * Включить или выключить свои «Сообщения простым текстом» (в транзакции от имени пользователя).
 * Возвращает прежнее значение; null — Telegram не привязан.
 */
export async function setTelegramPlainText(tx: Tx, plain: boolean): Promise<boolean | null> {
  const [row] = await tx.execute<{ was: boolean | null }>(
    sql`select app.telegram_set_plain_text(${plain}) as was`,
  );
  return row?.was ?? null;
}

/** Раздел `platform_reference` с настройками бота платформы. */
const BOT_SETTINGS_KEY = 'telegramBot';

/**
 * «Сообщения с таблицами» платформы (Админка → «Телеграм» → «Бот платформы»): выключено — все получают
 * простой текст. Настройки ещё нет — включено.
 */
export async function telegramBotRich(db: Db | Tx): Promise<boolean> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, BOT_SETTINGS_KEY));
  const payload = row?.payload as { rich?: unknown } | undefined;
  return payload?.rich !== false;
}

/**
 * «Темы в чате с ботом» платформы (поток Т, задача Т7; Админка → «Телеграм» → «Бот платформы»):
 * по умолчанию выключено — чат у всех прежний.
 */
export async function telegramBotTopics(db: Db | Tx): Promise<boolean> {
  const [row] = await db
    .select({ payload: platformReference.payload })
    .from(platformReference)
    .where(eq(platformReference.key, BOT_SETTINGS_KEY));
  const payload = row?.payload as { topics?: unknown } | undefined;
  return payload?.topics === true;
}

/**
 * Переключить «Темы в чате с ботом» (в транзакции администратора платформы) с записью в историю
 * платформы. Возвращает прежнее значение; null — в контексте не администратор платформы.
 */
export async function adminSetTelegramBotTopics(tx: Tx, on: boolean): Promise<boolean | null> {
  const [row] = await tx.execute<{ was: boolean | null }>(
    sql`select app.admin_set_telegram_topics(${on}) as was`,
  );
  const was = row?.was ?? null;
  if (was !== null && was !== on) {
    await writePlatformHistory(tx, {
      entity: 'telegram_bot',
      entityId: 'view',
      action: 'update',
      changes: [{ field: 'topics', from: was, to: on }],
    });
  }
  return was;
}

/** Номер темы чата у Telegram по ключу (`rep`, `task`, `lead`, `sec`, `org:<id>`); null — темы ещё нет. */
export async function telegramTopicThread(
  db: Db | Tx,
  chatId: number,
  key: string,
): Promise<number | null> {
  const [row] = await db.execute<{ thread: number | null }>(
    sql`select app.telegram_topic_thread(${chatId}, ${key}) as thread`,
  );
  return row?.thread ?? null;
}

/** Ключ темы чата по её номеру у Telegram (где человек нажал кнопку или написал); null — не наша тема. */
export async function telegramTopicKey(
  db: Db | Tx,
  chatId: number,
  threadId: number,
): Promise<string | null> {
  const [row] = await db.execute<{ key: string | null }>(
    sql`select app.telegram_topic_key(${chatId}, ${threadId}) as key`,
  );
  return row?.key ?? null;
}

/** Запомнить номер созданной темы (тема с тем же ключом заменяется). */
export async function saveTelegramTopic(
  db: Db | Tx,
  chatId: number,
  key: string,
  threadId: number,
): Promise<void> {
  await db.execute(sql`select app.telegram_topic_save(${chatId}, ${key}, ${threadId})`);
}

/** Забыть тему, которую человек удалил, — только с этим номером (её могли уже создать заново). */
export async function forgetTelegramTopic(
  db: Db | Tx,
  chatId: number,
  key: string,
  threadId: number,
): Promise<void> {
  await db.execute(sql`select app.telegram_topic_forget(${chatId}, ${key}, ${threadId})`);
}

/**
 * Переключить «Сообщения с таблицами» (в транзакции администратора платформы). Возвращает прежнее
 * значение; null — в контексте не администратор платформы.
 */
export async function adminSetTelegramBotRich(tx: Tx, rich: boolean): Promise<boolean | null> {
  const [row] = await tx.execute<{ was: boolean | null }>(
    sql`select app.admin_set_telegram_rich(${rich}) as was`,
  );
  const was = row?.was ?? null;
  if (was !== null && was !== rich) {
    await writePlatformHistory(tx, {
      entity: 'telegram_bot',
      entityId: 'view',
      action: 'update',
      changes: [{ field: 'rich', from: was, to: rich }],
    });
  }
  return was;
}
