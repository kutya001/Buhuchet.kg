import { leadPurgeDone, leadPurgeDue } from '@buhuchet/db';
import type { Job, JobContext } from '../../deps';

/** Сколько файлов заявок удаляется за один запуск. */
const BATCH = 500;

/**
 * Удаление файлов заявок по сроку (доработки 14.11.2026, блок 1; прототип v114 LEAD_KEEP_REJ,
 * LEAD_KEEP): черновики документов, которые не стали заявкой, — через сутки; документы заявки без
 * организации — через 7 дней после «Отклонить» или через 30 дней после заявки. Сначала файл в
 * хранилище, потом строка; заявка без документов получает «файлы удалены» и запись истории. Не удалось
 * удалить файл — строка остаётся до следующего запуска. Сроки ставятся по тем же часам (`clock`), что и
 * заявка. Безопасно при повторе.
 */
export async function purgeLeadDocs(ctx: JobContext): Promise<number> {
  const now = ctx.clock.now();
  const due = await leadPurgeDue(ctx.db, now, BATCH);
  if (!due.length) return 0;
  const uploads: string[] = [];
  const docs: string[] = [];
  for (const item of due) {
    try {
      await ctx.storage.delete(item.storageKey);
      (item.kind === 'upload' ? uploads : docs).push(item.id);
    } catch (err) {
      ctx.logger.error({ err }, 'заявка: файл не удалён из хранилища');
    }
  }
  return leadPurgeDone(ctx.db, now, uploads, docs);
}

export const purgeLeadDocsJob: Job = {
  name: 'leads.docs-purge',
  cron: '25 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    await purgeLeadDocs(ctx);
  },
};
