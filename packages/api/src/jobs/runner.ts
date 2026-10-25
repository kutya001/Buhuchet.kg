import { safeErrorMessage } from '@buhuchet/adapters/logger';
import { dueJobs } from '@buhuchet/adapters/scheduler';
import { schema } from '@buhuchet/db';
import type { CronTickResponse } from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import type { JobContext, Job } from '../deps';

const { schedulerRuns } = schema;

/**
 * Выполнить задачи, которым пора. Слот задачи сначала «занимается» строкой в scheduler_runs
 * (первичный ключ job+slot), поэтому повторный или параллельный вызов не выполнит его второй раз.
 */
export async function runDueJobs(ctx: JobContext, jobs: readonly Job[]): Promise<CronTickResponse> {
  const now = ctx.clock.now();
  const result: CronTickResponse = { ran: [], skipped: [] };
  for (const { job, slot } of dueJobs(jobs, now)) {
    const claimed = await ctx.db
      .insert(schedulerRuns)
      .values({ job: job.name, slot })
      .onConflictDoNothing()
      .returning({ job: schedulerRuns.job });
    if (claimed.length === 0) {
      result.skipped.push(job.name);
      continue;
    }
    let error: string | null = null;
    const started = Date.now();
    try {
      await job.run(ctx, slot);
      // Чтобы по журналу стенда и рабочего сайта было видно, что задачи действительно идут.
      ctx.logger.info(
        { job: job.name, slot: slot.toISOString(), ms: Date.now() - started },
        'задача по расписанию выполнена',
      );
    } catch (e) {
      // Журнал задач виден из любой организации: без значений параметров запроса к базе.
      error = safeErrorMessage(e);
      ctx.logger.error(
        { job: job.name, slot: slot.toISOString(), err: e },
        'задача по расписанию упала',
      );
    }
    await ctx.db
      .update(schedulerRuns)
      .set({ finishedAt: ctx.clock.now(), ok: error === null, error })
      .where(and(eq(schedulerRuns.job, job.name), eq(schedulerRuns.slot, slot)));
    result.ran.push({ job: job.name, slot: slot.toISOString(), ok: error === null });
  }
  return result;
}
