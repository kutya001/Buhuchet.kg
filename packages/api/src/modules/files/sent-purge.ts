import { dropSentFiles, staleSentFiles, withOrgContext, type StaleSentFile } from '@buhuchet/db';
import { orgIds } from '@buhuchet/db/organizations';
import {
  bishkekDate,
  sentFilePurgeUpTo,
  sentUploadKey,
  SENT_PENDING_TTL_MS,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';

/** Сколько отправленных файлов одной организации удаляется за один запуск. */
const BATCH = 500;

/**
 * Удаление через 30 дней (доработки 14.11.2026, блок 2; прототип v112 `sntPurge`; решение заказчика
 * 14.11.2026 — без напоминания): непринятые файлы от контрагентов («Новый» и «Отклонён»), отправленные
 * 30 и больше дней назад по Бишкеку, удаляются полностью — сначала файл в хранилище (и загрузка со
 * страницы по ссылке), потом строка с записью в историю контрагента от имени системы; незаконченные
 * загрузки старше 30 минут — так же, без истории. Не удалось удалить файл — строка остаётся до
 * следующего запуска. Принятые не удаляются. Безопасно при повторе.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
export async function purgeSentFiles(ctx: JobContext): Promise<number> {
  // Время отправки ставит база по настоящим часам — и сроки по ним, а не по часам демо-стенда.
  const now = new Date();
  const upTo = sentFilePurgeUpTo(bishkekDate(now));
  const pendingBefore = new Date(now.getTime() - SENT_PENDING_TTL_MS);
  let total = 0;
  for (const orgId of await orgIds(ctx.db)) {
    const stale = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
      staleSentFiles(tx, { upTo, pendingBefore, limit: BATCH }),
    );
    if (!stale.length) continue;
    const removed: StaleSentFile[] = [];
    for (const file of stale) {
      try {
        await ctx.storage.delete(sentUploadKey(file.storageKey));
        await ctx.storage.delete(file.storageKey);
        removed.push(file);
      } catch (err) {
        ctx.logger.error({ err }, 'файлы от контрагентов: файл не удалён из хранилища');
      }
    }
    total += await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
      dropSentFiles(tx, removed),
    );
  }
  return total;
}

export const purgeSentFilesJob: Job = {
  name: 'files.sent-purge',
  cron: '20 * * * *',
  lookbackMinutes: 60,
  async run(ctx) {
    await purgeSentFiles(ctx);
  },
};
