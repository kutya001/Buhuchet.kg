import {
  OUTBOX_ERROR_MAX,
  OUTBOX_UNDELIVERABLE,
  RecordChangedError,
  type NotifyKind,
  type NotifyMode,
  type NotifySettings,
  type OutboxKind,
  type OutboxStatus,
} from '@buhuchet/domain';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import {
  telegramDigestDays,
  telegramLinks,
  telegramNotifySettings,
  telegramOutbox,
  users,
} from './schema';
import { writeHistory } from './history';

/*
 * Журнал отправок и очередь Telegram (задача 2.25, docs/decisions.md, п. Б-5; миграции 0076–0077):
 * постановка в очередь, разбор очереди пачками с повторами, запись служебных сообщений бота и отметка
 * «напоминания за день собраны». Всё, кроме `logTelegram`, `telegramOutboxOrgs` и `telegramDigestOrgs`,
 * — в контексте организации `withOrgContext` (RLS).
 */

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** Сообщение в очередь: кому, в какой чат, что и о чём. */
export interface OutboxMessage {
  userId: string;
  chatId: number;
  kind: OutboxKind;
  text: string;
  /** Одно такое сообщение: повтор с тем же ключом ничего не добавляет. */
  dedupeKey?: string | null;
}

/**
 * Поставить в очередь организации из контекста; повтор с тем же ключом пропускается. Номера новых строк.
 * `now` — часы приложения: с этого момента строку можно отправлять (в тестах и на демо-стенде часы стоят
 * на месте, поэтому время базы не годится).
 */
export async function enqueueTelegram(
  tx: Tx,
  messages: readonly OutboxMessage[],
  now?: Date,
): Promise<string[]> {
  if (!messages.length) return [];
  const rows = await tx
    .insert(telegramOutbox)
    .values(
      messages.map((m) => ({
        orgId: sql`app.current_org_id()`,
        userId: m.userId,
        chatId: m.chatId,
        kind: m.kind,
        text: m.text,
        dedupeKey: m.dedupeKey ?? null,
        ...(now ? { nextAt: now } : {}),
      })),
    )
    .onConflictDoNothing({ target: telegramOutbox.dedupeKey })
    .returning({ id: telegramOutbox.id });
  return rows.map((r) => r.id);
}

/** Строка очереди, взятая на отправку. */
export interface ClaimedOutbox {
  id: string;
  chatId: number;
  kind: OutboxKind;
  text: string;
  /** Номер этой попытки (с 1). */
  tries: number;
}

/**
 * Взять на отправку до `limit` строк, которым пора (`next_at` наступил): попытка засчитывается сразу, а
 * строка до `leaseSeconds` не достаётся другому запуску (`for update skip locked`). `ids` — только эти
 * строки (отправить сразу после действия).
 */
export async function claimOutbox(
  tx: Tx,
  o: { now: Date; limit: number; leaseSeconds: number; ids?: readonly string[] },
): Promise<ClaimedOutbox[]> {
  if (o.ids && !o.ids.length) return [];
  // Получатель отвязал или сменил Telegram, его заблокировали — строка не уходит в прежний чат.
  await tx
    .update(telegramOutbox)
    .set({ status: 'error', lastError: OUTBOX_UNDELIVERABLE })
    .where(
      and(
        eq(telegramOutbox.status, 'pending'),
        lte(telegramOutbox.nextAt, o.now),
        o.ids ? inArray(telegramOutbox.id, [...o.ids]) : undefined,
        sql`not exists (select 1 from ${telegramLinks} inner join ${users} on ${users.id} = ${telegramLinks.userId} where ${telegramLinks.userId} = ${telegramOutbox.userId} and ${telegramLinks.chatId} = ${telegramOutbox.chatId} and not ${users.blocked})`,
      ),
    );
  const due = tx
    .select({ id: telegramOutbox.id })
    .from(telegramOutbox)
    .where(
      and(
        eq(telegramOutbox.status, 'pending'),
        lte(telegramOutbox.nextAt, o.now),
        o.ids ? inArray(telegramOutbox.id, [...o.ids]) : undefined,
      ),
    )
    .orderBy(asc(telegramOutbox.nextAt), asc(telegramOutbox.createdAt))
    .limit(o.limit)
    .for('update', { skipLocked: true });
  const lease = new Date(o.now.getTime() + o.leaseSeconds * 1000);
  const rows = await tx
    .update(telegramOutbox)
    .set({ tries: sql`${telegramOutbox.tries} + 1`, nextAt: lease })
    .where(inArray(telegramOutbox.id, due))
    .returning({
      id: telegramOutbox.id,
      chatId: telegramOutbox.chatId,
      kind: telegramOutbox.kind,
      text: telegramOutbox.text,
      tries: telegramOutbox.tries,
      nextAt: telegramOutbox.nextAt,
    });
  return rows
    .sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime())
    .map((r) => ({ id: r.id, chatId: r.chatId, kind: r.kind, text: r.text ?? '', tries: r.tries }));
}

/** Итог попытки: отправлено, повторить в такой момент или окончательная ошибка. */
export type OutboxOutcome =
  | { id: string; result: 'sent'; at: Date }
  | { id: string; result: 'retry'; at: Date; error: string }
  | { id: string; result: 'error'; error: string };

/** Записать итоги попыток. */
export async function finishOutbox(tx: Tx, outcomes: readonly OutboxOutcome[]): Promise<void> {
  for (const o of outcomes) {
    const set =
      o.result === 'sent'
        ? { status: 'sent' as const, sentAt: o.at, lastError: null }
        : o.result === 'retry'
          ? {
              status: 'pending' as const,
              nextAt: o.at,
              lastError: o.error.slice(0, OUTBOX_ERROR_MAX),
            }
          : { status: 'error' as const, lastError: o.error.slice(0, OUTBOX_ERROR_MAX) };
    await tx.update(telegramOutbox).set(set).where(eq(telegramOutbox.id, o.id));
  }
}

/**
 * Служебное сообщение бота отправлено (или нет) — в журнал (функция `app.telegram_log`, работает и без
 * организации). У кода восстановления текст не пишется.
 */
export async function logTelegram(
  db: Db | Tx,
  entry: {
    userId: string;
    chatId: number;
    kind: OutboxKind;
    text: string;
    ok: boolean;
    error?: string;
  },
): Promise<void> {
  await db.execute(
    // Текст кода в базу не передаётся вовсе (его не пишет и функция): не попадёт и в журнал PostgreSQL.
    sql`select app.telegram_log(${entry.userId}, ${entry.chatId}, ${entry.kind}, ${entry.kind === 'code' ? null : entry.text}, ${entry.ok}, ${entry.error ?? null})`,
  );
}

/** Организации, у которых в очереди есть что отправить сейчас. */
export async function telegramOutboxOrgs(db: Db, now: Date): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(
    sql`select f.id from app.telegram_outbox_orgs(${now.toISOString()}::timestamptz) as f(id)`,
  );
  return rows.map((r) => r.id);
}

/** Организации, которым пора собрать напоминания за день, и этот день по их часовому поясу. */
export async function telegramDigestOrgs(
  db: Db,
  now: Date,
): Promise<{ orgId: string; day: string }[]> {
  const rows = await db.execute<{ org_id: string; day: string | Date }>(
    sql`select org_id, day::text as day from app.telegram_digest_orgs(${now.toISOString()}::timestamptz)`,
  );
  return rows.map((r) => ({ orgId: r.org_id, day: String(r.day).slice(0, 10) }));
}

/**
 * Отметить, что напоминания организации за день собраны. false — уже собраны (другой запуск успел):
 * тогда собирать не нужно. Отметка — в той же транзакции, что и очередь: упавший сбор её не оставит.
 */
export async function markDigestDay(tx: Tx, day: string): Promise<boolean> {
  const rows = await tx
    .insert(telegramDigestDays)
    .values({ orgId: sql`app.current_org_id()`, day })
    .onConflictDoNothing()
    .returning({ day: telegramDigestDays.day });
  return rows.length > 0;
}

/** Привязанные Telegram пользователей организации из контекста. */
export async function telegramChatsOf(
  tx: Tx,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await tx
    .select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId })
    .from(telegramLinks)
    .where(inArray(telegramLinks.userId, [...userIds]));
  return new Map(rows.map((r) => [r.userId, r.chatId]));
}

/** Строка журнала (для проверок и экрана журнала Админки). */
export interface OutboxRow {
  id: string;
  userId: string;
  chatId: number;
  kind: OutboxKind;
  text: string | null;
  status: OutboxStatus;
  tries: number;
  nextAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  dedupeKey: string | null;
  createdAt: Date;
}

/** Журнал организации из контекста, сначала новые (до `limit` строк). */
export async function listOutbox(tx: Tx, limit = 200): Promise<OutboxRow[]> {
  const rows = await tx
    .select()
    .from(telegramOutbox)
    .orderBy(sql`${telegramOutbox.createdAt} desc`, sql`${telegramOutbox.id} desc`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    chatId: r.chatId,
    kind: r.kind,
    text: r.text,
    status: r.status,
    tries: r.tries,
    nextAt: asDate(r.nextAt),
    lastError: r.lastError,
    sentAt: r.sentAt ? asDate(r.sentAt) : null,
    dedupeKey: r.dedupeKey,
    createdAt: asDate(r.createdAt),
  }));
}

/** Настройки уведомлений пользователя организации из контекста (нет строки — «Все», всё включено). */
export interface StoredNotifySettings extends NotifySettings {
  version: number;
}

export async function getNotifySettings(tx: Tx, userId: string): Promise<StoredNotifySettings> {
  const [row] = await tx
    .select({
      mode: telegramNotifySettings.mode,
      off: telegramNotifySettings.off,
      version: telegramNotifySettings.version,
    })
    .from(telegramNotifySettings)
    .where(eq(telegramNotifySettings.userId, userId));
  return row
    ? { mode: row.mode, off: row.off as NotifyKind[], version: row.version }
    : { mode: 'all', off: [], version: 0 };
}

/** Настройки уведомлений всех сотрудников организации из контекста. */
export async function notifySettingsOf(tx: Tx): Promise<Map<string, NotifySettings>> {
  const rows = await tx
    .select({
      userId: telegramNotifySettings.userId,
      mode: telegramNotifySettings.mode,
      off: telegramNotifySettings.off,
    })
    .from(telegramNotifySettings);
  return new Map(rows.map((r) => [r.userId, { mode: r.mode, off: r.off as NotifyKind[] }]));
}

/**
 * Сохранить режим и переключатели своего профиля: версия 0 — строки ещё нет (создаётся), иначе — правка
 * с проверкой версии (устаревшая — «запись изменена другим пользователем»). В историю сотрудника —
 * «Уведомления: было → стало» (прототип `bindNotify`), в той же транзакции.
 */
export async function saveNotifySettings(
  tx: Tx,
  input: {
    userId: string;
    employeeId: string;
    version: number;
    mode: NotifyMode;
    off: readonly NotifyKind[];
    /** Подпись «было» и «стало» для истории: «Все», «Только ручные задачи», «… отключено». */
    from: string;
    to: string;
  },
): Promise<StoredNotifySettings> {
  const rows =
    input.version === 0
      ? await tx
          .insert(telegramNotifySettings)
          .values({
            userId: input.userId,
            orgId: sql`app.current_org_id()`,
            mode: input.mode,
            off: [...input.off],
            updatedBy: sql`app.current_user_id()`,
          })
          .onConflictDoNothing()
          .returning({ version: telegramNotifySettings.version })
      : await tx
          .update(telegramNotifySettings)
          .set({
            mode: input.mode,
            off: [...input.off],
            version: sql`${telegramNotifySettings.version} + 1`,
            updatedAt: sql`now()`,
            updatedBy: sql`app.current_user_id()`,
          })
          .where(
            and(
              eq(telegramNotifySettings.userId, input.userId),
              eq(telegramNotifySettings.version, input.version),
            ),
          )
          .returning({ version: telegramNotifySettings.version });
  if (!rows.length) {
    const now = await getNotifySettings(tx, input.userId);
    throw new RecordChangedError('telegram_notify_settings', input.userId, now.version);
  }
  await writeHistory(tx, {
    entity: 'employee',
    entityId: input.employeeId,
    action: 'update',
    changes: [{ field: 'notify', from: input.from, to: input.to }],
  });
  return getNotifySettings(tx, input.userId);
}
