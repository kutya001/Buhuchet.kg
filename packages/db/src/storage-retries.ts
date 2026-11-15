import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { STORAGE_RETRY_KEY_RE } from './schema/files';

/*
 * Повторное удаление файлов из хранилища (доработки 14.11.2026, этап 3; миграция 0154): ключи публичных
 * загрузок, которые не удалось удалить сразу, — после «Одобрить» и «Удалить» заявки, после «Принять»
 * отправленного файла, после отказа загрузки. Таблицу `storage_delete_retries` роль приложения не видит:
 * только функции `app.storage_retry_*`. Ключи — только публичных загрузок и копий принятого файла
 * (ограничение таблицы); ключ, на который ещё ссылается живая строка, задача не удаляет.
 */

type Exec = Db | Tx;

const RETRY_KEY = new RegExp(STORAGE_RETRY_KEY_RE);

/**
 * Примет ли ключ таблица повторов (то же выражение, что у ограничения `storage_delete_retries_key_check`):
 * один неверный ключ иначе отказал бы всей пачке.
 */
export const isStorageRetryKey = (key: string): boolean => RETRY_KEY.test(key);

/** Сколько ключей можно записать за раз (как в `app.storage_retry_add`). */
export const STORAGE_RETRY_ADD_MAX = 100;

const textArray = (items: readonly string[]) =>
  items.length
    ? sql`array[${sql.join(
        items.map((k) => sql`${k}`),
        sql`, `,
      )}]::text[]`
    : sql`'{}'::text[]`;

/** Запомнить ключи на повторное удаление. Ответ — сколько новых записано. */
export async function storageRetryAdd(db: Exec, keys: readonly string[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < keys.length; i += STORAGE_RETRY_ADD_MAX) {
    const part = keys.slice(i, i + STORAGE_RETRY_ADD_MAX);
    const rows = await db.execute<{ n: number }>(
      sql`select app.storage_retry_add(${textArray(part)}) as n`,
    );
    added += Number(rows[0]?.n ?? 0);
  }
  return added;
}

/**
 * Какие ключи повторить: ещё не пробовали или пробовали не позже чем `everyMinutes` минут назад. Ключи,
 * которые ещё нужны живой строке, функция снимает с повтора и не отдаёт.
 */
export async function storageRetryDue(
  db: Exec,
  now: Date,
  everyMinutes: number,
  limit: number,
): Promise<string[]> {
  const rows = await db.execute<{ key: string }>(sql`
    select k as key from app.storage_retry_due(${now.toISOString()}::timestamptz, ${everyMinutes},
      ${limit}) as k`);
  return rows.map((r) => r.key);
}

/**
 * Итог попытки: удалённые убираются, у остальных — ещё одна попытка. Ответ — сколько ключей осталось и
 * сколько из них не удаётся удалить `stuckAttempts` раз и больше.
 */
export async function storageRetryDone(
  db: Exec,
  o: { now: Date; done: readonly string[]; failed: readonly string[]; stuckAttempts: number },
): Promise<{ left: number; stuck: number }> {
  const rows = await db.execute<{ left_count: number; stuck_count: number }>(sql`
    select left_count, stuck_count from app.storage_retry_done(${o.now.toISOString()}::timestamptz,
      ${textArray(o.done)}, ${textArray(o.failed)}, ${o.stuckAttempts})`);
  return { left: Number(rows[0]?.left_count ?? 0), stuck: Number(rows[0]?.stuck_count ?? 0) };
}
