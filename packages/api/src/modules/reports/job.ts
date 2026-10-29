import { createDueReports, orgIds, withOrgContext } from '@buhuchet/db';
import { bishkekDate } from '@buhuchet/domain';
import type { Job } from '../../deps';

/**
 * Отчёты к сдаче по расписанию (ТЗ «По каждому назначению система сама создаёт отчёт на каждый период:
 * на текущий и на один вперёд»): каждые 6 часов по всем организациям, каждая — своей транзакцией с
 * пределом времени задач. Создаются только недостающие (ключ «контрагент + вид + период + версия»),
 * поэтому повтор и одновременный запуск дублей не дают, а упавший запуск догонит следующий.
 * Организация, у которой запуск упал, не мешает остальным; ошибка — в журнал задачи.
 */
export const createDueReportsJob: Job = {
  name: 'reports.create-due',
  cron: '5 0,6,12,18 * * *',
  lookbackMinutes: 6 * 60,
  async run(ctx) {
    const today = bishkekDate(ctx.clock.now());
    const failed: string[] = [];
    let created = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        created += await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          createDueReports(tx, { today }),
        );
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error(
          { job: 'reports.create-due', orgId, err },
          'отчёты организации не созданы',
        );
      }
    }
    ctx.logger.info({ job: 'reports.create-due', today, created }, 'отчёты к сдаче созданы');
    if (failed.length) {
      throw new Error(`reports.create-due: не созданы отчёты организаций: ${failed.length}`);
    }
  },
};
