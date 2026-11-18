import type { IncomingEntry, InboxStatus } from '@buhuchet/domain';
import { INBOX_ERROR_MAX } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import type { Db } from './client';

/*
 * Полученные ботом сообщения (решение заказчика 17.11.2026; прототип v132; docs/decisions.md п. Т-16;
 * миграции 0162–0163): строку пишет вебхук до разбора обновления, итог — после. Роль приложения таблицу
 * не видит: только эти функции базы. Код и ссылка привязки идут без текста — он не передаётся в базу
 * вовсе, поэтому не попадёт и в журнал PostgreSQL.
 */

/**
 * Записать полученное сообщение. Номер строки — для итога; null — это повторная доставка обновления,
 * которое уже записано, или чат, который ни к кому не привязан, превысил предел записи (30 строк в час,
 * 200 в сутки; все такие чаты вместе — 2000 в час).
 */
export async function beginTelegramInbox(
  db: Db,
  entry: IncomingEntry,
  now: Date,
): Promise<string | null> {
  const text = entry.hide ? null : entry.text;
  const [row] = await db.execute<{ id: string | null }>(
    sql`select app.telegram_inbox_begin(${entry.updateId}::bigint, ${entry.chatId}::bigint, ${entry.group}, ${entry.sender}, ${entry.kind}, ${text}, ${entry.hide}, ${entry.data}, ${entry.replyTo}::bigint, ${entry.fileName}, ${entry.fileSize}::bigint, ${now.toISOString()}::timestamptz) as id`,
  );
  return row?.id ?? null;
}

/** Итог разбора: «Обработано», «Не распознано» или «Ошибка»; `command` — бот узнал команду меню. */
export async function finishTelegramInbox(
  db: Db,
  id: string,
  result: { status: Exclude<InboxStatus, 'new'>; command?: boolean; error?: string | null },
): Promise<void> {
  await db.execute(
    sql`select app.telegram_inbox_finish(${id}::uuid, ${result.status}, ${result.command ? 'command' : null}, ${result.error ? result.error.slice(0, INBOX_ERROR_MAX) : null})`,
  );
}

/** Удалить полученные сообщения старше `before` (хранятся 90 дней). Сколько удалено. */
export async function cleanupTelegramInbox(db: Db, before: Date): Promise<number> {
  const [row] = await db.execute<{ n: number }>(
    sql`select app.telegram_inbox_cleanup(${before.toISOString()}::timestamptz) as n`,
  );
  return Number(row?.n ?? 0);
}
