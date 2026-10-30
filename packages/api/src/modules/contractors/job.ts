import { loadUiTexts, orgIds, syncServiceStatuses, withOrgContext } from '@buhuchet/db';
import { bishkekDate, DEFAULT_UI_LANGUAGE } from '@buhuchet/domain';
import type { Job } from '../../deps';
import { DEFAULT_TEXTS } from '../l10n/texts';
import { serviceTextsOf } from './service';

/**
 * Статус обслуживания по периодам (задача 2.12): наступил месяц запланированной приостановки или
 * возобновления — статус контрагента меняется системой с записью «Истории статусов». Раньше
 * создания отчётов по расписанию (`reports.create-due` в :05); повтор ничего не меняет. Организация,
 * у которой запуск упал, не мешает остальным; ошибка — в журнал задачи.
 */
export const syncServiceStatusesJob: Job = {
  name: 'contractors.sync-service-status',
  cron: '2 0,6,12,18 * * *',
  lookbackMinutes: 6 * 60,
  async run(ctx) {
    const today = bishkekDate(ctx.clock.now());
    // Причины — словами словаря, как у методов API (с правками «Локализации»).
    const dict: Record<string, string> = {
      ...DEFAULT_TEXTS,
      ...(await loadUiTexts(ctx.db, DEFAULT_UI_LANGUAGE)),
    };
    const texts = serviceTextsOf((key) => dict[key] ?? key);
    const failed: string[] = [];
    let changed = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        const r = await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          syncServiceStatuses(tx, { today, texts }),
        );
        changed += r.paused + r.resumed;
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'contractors.sync-service-status', orgId, err },
          'статусы обслуживания организации не сверены',
        );
      }
    }
    ctx.logger.info(
      { job: 'contractors.sync-service-status', today, changed },
      'статусы обслуживания сверены',
    );
    if (failed.length) {
      throw new Error(`contractors.sync-service-status: не сверены организации: ${failed.length}`);
    }
  },
};
