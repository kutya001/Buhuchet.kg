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
