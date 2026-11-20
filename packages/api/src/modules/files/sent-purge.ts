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
 * 30 и больше дней назад по Бишкеку, пропадают у фирмы: строка удаляется с записью в историю контрагента
 * от имени системы, а сам файл сутки ждёт стирания в «Ждут удаления» (пакет 20.11.2026, блок 5,
 * пункт 3; прототип `ftPush` с `why: 'auto'`) — его стирает задача `files.erase-deleted`. Незаконченные
 * загрузки старше 30 минут — сразу из хранилища (и загрузка со страницы по ссылке), потом строка, без
 * истории: не удалось удалить файл — строка остаётся до следующего запуска. Принятые не удаляются.
 * Безопасно при повторе.
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
    const ready = stale.filter((f) => f.state === 'ready');
    const removed: StaleSentFile[] = [];
    for (const file of stale.filter((f) => f.state !== 'ready')) {
      try {
        await ctx.storage.delete(sentUploadKey(file.storageKey));
        await ctx.storage.delete(file.storageKey);
        removed.push(file);
      } catch (err) {
        ctx.logger.error({ err }, 'файлы от контрагентов: файл не удалён из хранилища');
      }
    }
    total += await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
      const pending = await dropSentFiles(tx, removed);
      return pending + (await dropSentFiles(tx, ready, { trash: true }));
    });
    // Загрузка со страницы по ссылке у загруженного файла уже не нужна — её стирают сразу, без строки.
    for (const file of ready) {
      try {
        await ctx.storage.delete(sentUploadKey(file.storageKey));
      } catch (err) {
        ctx.logger.error({ err }, 'файлы от контрагентов: загрузка не удалена из хранилища');
      }
    }
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
