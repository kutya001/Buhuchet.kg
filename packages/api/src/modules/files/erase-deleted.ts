import { fileTrashDone, fileTrashDue, FILE_TRASH_BATCH } from '@buhuchet/db';
import { FILE_TRASH_STUCK_ATTEMPTS } from '@buhuchet/domain';
import { alertTexts, sendPlatformAlert } from '../../jobs/alerts';
import type { Job, JobContext } from '../../deps';

/*
 * «Файлы: стирание удалённых» (доработки 20.11.2026, пакет 2, блок 5, пункт 3; прототип `ftPurge`;
 * этап 1, П6, поток И): удалённые сотрудником файлы, прежние версии после замены, непринятые файлы от
 * контрагентов и лишние файлы хранилища стираются из хранилища через сутки после удаления (срок — по
 * часам базы). Перед стиранием база ещё раз смотрит, не нужен ли ключ живой записи: нужен — не
 * стирается. Не удалось стереть — повтор в следующий запуск, в «Проверке хранилища» — «Не удалось
 * стереть»; сутки не удаётся — оповещение администратору платформы. Стирание отсутствующего ключа — не
 * ошибка (S3), поэтому повтор безопасен.
 */

const STUCK_ALERT_EVERY_SECONDS = 24 * 3600;

/** Стереть то, чей срок наступил. Ответ — сколько стёрто. */
export async function eraseDeletedFiles(ctx: JobContext): Promise<number> {
  const due = await fileTrashDue(ctx.db, FILE_TRASH_BATCH);
  if (!due.length) return 0;
  const done: string[] = [];
  const failed: string[] = [];
  for (const row of due) {
    try {
      await ctx.storage.delete(row.storageKey);
      done.push(row.id);
    } catch (err) {
      ctx.logger.error({ err }, 'хранилище: удалённый файл не стёрт');
      failed.push(row.id);
    }
  }
  const { stuck } = await fileTrashDone(ctx.db, {
    done,
    failed,
    stuck: FILE_TRASH_STUCK_ATTEMPTS,
  });
  if (stuck > 0) {
    const t = await alertTexts(ctx);
    await sendPlatformAlert(ctx, {
      key: 'file-trash-erase',
      everySeconds: STUCK_ALERT_EVERY_SECONDS,
      text: t('alert.file_trash_erase', { n: stuck }),
    });
  }
  return done.length;
}

export const eraseDeletedFilesJob: Job = {
  name: 'files.erase-deleted',
  cron: '50 * * * *',
  lookbackMinutes: 60,
  run: (ctx) => eraseDeletedFiles(ctx),
};
