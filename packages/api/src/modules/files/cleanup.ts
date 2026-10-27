import { dropPendingFiles, stalePendingFiles, withOrgContext } from '@buhuchet/db';
import { orgIds } from '@buhuchet/db/organizations';
import { FILE_PENDING_TTL_MS } from '@buhuchet/domain';
import type { JobContext } from '../../deps';

/** Сколько незаконченных загрузок одной организации убирается за один запуск. */
const BATCH = 500;

/**
 * Незаконченные загрузки старше суток (файл не дошёл до хранилища или окно закрыли до конца): файл, если
 * что-то дошло, удаляется из хранилища, затем запись. Не удалось удалить файл — запись остаётся до
 * следующего запуска. Безопасно при повторе.
 */
export async function cleanupPendingFiles(ctx: JobContext): Promise<void> {
  const before = new Date(Date.now() - FILE_PENDING_TTL_MS);
  for (const orgId of await orgIds(ctx.db)) {
    const stale = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
      stalePendingFiles(tx, before, BATCH),
    );
    const removed: string[] = [];
    for (const file of stale) {
      try {
        await ctx.storage.delete(file.storageKey);
        removed.push(file.id);
      } catch (err) {
        ctx.logger.error({ err }, 'файлы: не удалось удалить незаконченную загрузку');
      }
    }
    await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) => dropPendingFiles(tx, removed));
  }
}
