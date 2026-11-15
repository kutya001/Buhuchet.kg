import { storageRetryAdd, storageRetryDone, storageRetryDue } from '@buhuchet/db';
import { alertTexts, sendPlatformAlert } from '../../jobs/alerts';
import type { ApiDeps, Job, JobContext } from '../../deps';

/*
 * «Удаление убирает и сам файл из хранилища» для публичных загрузок (доработки 14.11.2026, этап 3):
 * файл заявки после «Одобрить» и «Удалить», отправленный файл после «Принять», загрузка после отказа.
 * Строки к этому моменту уже стёрты (или файл им больше не нужен), и задача удаления по сроку его не
 * найдёт, поэтому ключ, который не удалось удалить сразу, запоминается, а задача `files.storage-retry`
 * повторяет удаление раз в час, пока оно не удастся; сутки не удаётся — оповещение администратору
 * платформы. Удаление отсутствующего ключа — не ошибка (S3), поэтому повтор безопасен.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10

/** Сколько ключей задача пробует за один запуск. */
const BATCH = 500;
/** Повтор — не чаще раза в 50 минут: задача идёт раз в час. */
const RETRY_EVERY_MINUTES = 50;
/** Сутки попыток раз в час — оповещение администратору платформы (не чаще раза в сутки). */
export const STORAGE_RETRY_STUCK_ATTEMPTS = 24;
const STUCK_ALERT_EVERY_SECONDS = 24 * 3600;

/**
 * Удалить объекты хранилища после того, как строки базы им больше не нужны. Не удалось — в журнал и на
 * повторное удаление. Не бросает: удаление не должно отменять уже сохранённое. Вызывать вне транзакции.
 */
export async function removeStoredObjects(
  deps: Pick<ApiDeps, 'db' | 'storage' | 'logger'>,
  keys: readonly string[],
  what: string,
): Promise<void> {
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await deps.storage.delete(key);
    } catch (err) {
      deps.logger.error({ err }, `${what}: файл не удалён из хранилища`);
      failed.push(key);
    }
  }
  if (!failed.length) return;
  try {
    await storageRetryAdd(deps.db, failed);
  } catch (err) {
    deps.logger.error(
      { err, n: failed.length },
      `${what}: файл не поставлен на повторное удаление`,
    );
  }
}

/** Повторить удаление запомненных ключей. Ответ — сколько удалено. */
export async function retryStorageDeletes(ctx: JobContext): Promise<number> {
  const now = ctx.clock.now();
  const due = await storageRetryDue(ctx.db, now, RETRY_EVERY_MINUTES, BATCH);
  if (!due.length) return 0;
  const done: string[] = [];
  const failed: string[] = [];
  for (const key of due) {
    try {
      await ctx.storage.delete(key);
      done.push(key);
    } catch (err) {
      ctx.logger.error({ err }, 'хранилище: повторное удаление файла не удалось');
      failed.push(key);
    }
  }
  const { stuck } = await storageRetryDone(ctx.db, {
    now,
    done,
    failed,
    stuckAttempts: STORAGE_RETRY_STUCK_ATTEMPTS,
  });
  if (stuck > 0) {
    const t = await alertTexts(ctx);
    await sendPlatformAlert(ctx, {
      key: 'storage-retry',
      everySeconds: STUCK_ALERT_EVERY_SECONDS,
      text: t('alert.storage_retry', { n: stuck }),
    });
  }
  return done.length;
}

export const storageRetryJob: Job = {
  name: 'files.storage-retry',
  cron: '40 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    await retryStorageDeletes(ctx);
  },
};
