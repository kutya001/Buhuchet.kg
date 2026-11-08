import { dropStaleVideoUploads, staleVideoUploads } from '@buhuchet/db';
import { VIDEO_UPLOAD_TTL_MS } from '@buhuchet/domain';
import type { Job } from '../../deps';

/** Сколько брошенных загрузок видео убирается за один запуск. */
const BATCH = 200;

/**
 * Брошенные загрузки видео и обложек старше суток (окно формы закрыли, файл не подошёл, видео так и не
 * сохранили): незаконченная загрузка по частям отменяется, дошедший файл удаляется из хранилища, затем
 * строка загрузки. Не удалось удалить файл — строка остаётся до следующего запуска. Загрузка,
 * использованная в видео, строки уже не имеет: файл видео эта задача не трогает. Безопасно при повторе.
 */
export const cleanupVideoUploadsJob: Job = {
  name: 'kb.cleanup-video-uploads',
  cron: '50 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    const before = new Date(ctx.clock.now().getTime() - VIDEO_UPLOAD_TTL_MS);
    const stale = await staleVideoUploads(ctx.db, before, BATCH);
    const removed: string[] = [];
    for (const u of stale) {
      try {
        if (u.s3_upload_id) await ctx.storage.abortMultipart(u.storage_key, u.s3_upload_id);
        await ctx.storage.delete(u.storage_key);
        removed.push(u.id);
      } catch (err) {
        ctx.logger.error({ err }, 'видео: не удалось удалить брошенную загрузку');
      }
    }
    await dropStaleVideoUploads(ctx.db, removed, before);
  },
};
