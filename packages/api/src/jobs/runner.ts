import { createHash } from 'node:crypto';
import { safeErrorMessage } from '@buhuchet/adapters/logger';
import { dueJobs, latestDueSlot, parseCron } from '@buhuchet/adapters/scheduler';
import {
  claimJobSlot,
  failHungJobRuns,
  finishJobRun,
  jobStates,
  recordJobOutcome,
  setJobAlert,
} from '@buhuchet/db';
import { formatMomentRu } from '@buhuchet/domain';
import type { CronTickResponse } from '@buhuchet/shared';
import type { JobContext, Job } from '../deps';
import { alertTexts, jobTitle, sendPlatformAlert } from './alerts';

/*
 * Запуск задач по расписанию (ревью безопасности Р-9 А и Р-8 А, docs/decisions.md п. О-30).
 * - Слот задачи сначала занимается строкой `scheduler_runs`, поэтому повторный или параллельный вызов
 *   не выполнит его второй раз.
 * - Упавший слот повторяется, пока он ещё в окне догоняния задачи: через 2 минуты, затем через 10, всего
 *   не больше 3 попыток. Задачи безопасны при повторе (досоздают только недостающее).
 * - Попытка, которая не закончилась за 10 минут (функцию Vercel обрывает через 5, процесс могли
 *   остановить), считается упавшей — слот тоже повторяется.
 * - 3 неудачные попытки подряд — оповещение администратору платформы, первая удачная после него —
 *   «снова выполняется». Задача, у которой прошёл слот с окном догоняния и запасом 15 минут, а запуска не
 *   было, — оповещение «не запускались дольше положенного» (одно на все такие задачи).
 * - Ошибка задачи — ещё и в Sentry, если задан `SENTRY_DSN`.
 */

/** Попыток одного слота не больше. */
export const JOB_MAX_ATTEMPTS = 3;
/** Пауза перед повтором после первой и второй неудачной попытки, минут. */
export const JOB_RETRY_DELAYS_MINUTES = [2, 10] as const;
/** Попытка без итога дольше стольких минут — зависла. */
export const JOB_HANG_MINUTES = 10;
/** После стольких неудачных попыток подряд — оповещение. */
export const JOB_ALERT_FAILS = 3;
/** Запас после окна догоняния, прежде чем считать слот пропущенным, минут. */
export const JOB_MISSED_GRACE_MINUTES = 15;
/** Насколько далеко назад искать прошлый слот по расписанию (неделя с запасом), минут. */
const MISSED_SCAN_MINUTES = 8 * 24 * 60;

const MINUTE = 60_000;

/** Выполнить задачи, которым пора. */
export async function runDueJobs(ctx: JobContext, jobs: readonly Job[]): Promise<CronTickResponse> {
  const now = ctx.clock.now();
  const result: CronTickResponse = { ran: [], skipped: [] };
  if (!jobs.length) return result;
  const names = new Set(jobs.map((j) => j.name));
  // До занятия слотов: зависшие попытки становятся неудачными (их слот можно повторить), а пропуск
  // виден по прошлым запускам — после занятия слота этого запуска он бы уже не был виден.
  await watch(ctx, 'hung', () => settleHungRuns(ctx, names, now));
  await watch(ctx, 'missed', () => alertMissedJobs(ctx, jobs, now));
  for (const { job, slot } of dueJobs(jobs, now)) {
    const attempt = await claimJobSlot(ctx.db, {
      job: job.name,
      slot,
      now,
      maxAttempts: JOB_MAX_ATTEMPTS,
      retryDelaysMinutes: JOB_RETRY_DELAYS_MINUTES,
    });
    if (attempt === null) {
      result.skipped.push(job.name);
      continue;
    }
    let error: string | null = null;
    const started = Date.now();
    try {
      await job.run(ctx, slot);
      // Чтобы по журналу стенда и рабочего сайта было видно, что задачи действительно идут.
      ctx.logger.info(
        { job: job.name, slot: slot.toISOString(), attempt, ms: Date.now() - started },
        'задача по расписанию выполнена',
      );
    } catch (e) {
      // Журнал задач виден из любой организации: без значений параметров запроса к базе.
      error = safeErrorMessage(e);
      ctx.logger.error(
        { job: job.name, slot: slot.toISOString(), attempt, err: e },
        'задача по расписанию упала',
      );
      await ctx.errors?.capture(e, { job: job.name, slot: slot.toISOString(), attempt });
    }
    await finishJobRun(ctx.db, { job: job.name, slot, attempt, now: ctx.clock.now(), error });
    await watch(ctx, job.name, () => afterAttempt(ctx, job.name, error));
    result.ran.push({ job: job.name, slot: slot.toISOString(), ok: error === null });
  }
  return result;
}

/** Слежение не должно мешать задачам: его ошибка — только в журнал (и в Sentry). */
async function watch(ctx: JobContext, what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    ctx.logger.error({ err, watch: what }, 'слежение за задачами по расписанию не сработало');
    await ctx.errors?.capture(err, { watch: what });
  }
}

/** Текст ошибки зависшей попытки (журнал запусков и оповещение). */
export const JOB_HUNG_ERROR = `Не закончилась за ${JOB_HANG_MINUTES} минут: оборвана по времени или процесс остановлен`;

/** Зависшие попытки — неудачные: засчитываются в неудачи подряд своей задачи. */
async function settleHungRuns(ctx: JobContext, names: ReadonlySet<string>, now: Date) {
  const error = JOB_HUNG_ERROR;
  const hung = await failHungJobRuns(ctx.db, {
    startedBefore: new Date(now.getTime() - JOB_HANG_MINUTES * MINUTE),
    now,
    error,
  });
  for (const run of hung) {
    ctx.logger.error(
      { job: run.job, slot: run.slot.toISOString(), attempt: run.attempts },
      'задача по расписанию зависла',
    );
    if (names.has(run.job)) await afterAttempt(ctx, run.job, error);
  }
}

/** Итог попытки — в состояние задачи; при нужде — оповещение. */
async function afterAttempt(ctx: JobContext, name: string, error: string | null) {
  const state = await recordJobOutcome(ctx.db, { job: name, now: ctx.clock.now(), error });
  if (error === null) {
    if (state.alert !== 'failing') return;
    const t = await alertTexts(ctx);
    await sendPlatformAlert(ctx, {
      key: `job:${name}:ok:${state.alertedAt?.toISOString() ?? ''}`,
      text: t('alert.job_recovered', { job: jobTitle(t, name) }),
    });
    await setJobAlert(ctx.db, { job: name, alert: null, now: ctx.clock.now(), onlyIf: 'failing' });
    return;
  }
  if (state.fails < JOB_ALERT_FAILS || state.alert === 'failing') return;
  const t = await alertTexts(ctx);
  // Ключ — последний успех задачи: одна серия неудач даёт одно оповещение, даже если два запуска
  // упали одновременно.
  await sendPlatformAlert(ctx, {
    key: `job:${name}:failing:${state.lastOkAt?.toISOString() ?? 'never'}`,
    text: t('alert.job_failing', { job: jobTitle(t, name), n: state.fails, error }),
  });
  await setJobAlert(ctx.db, { job: name, alert: 'failing', now: ctx.clock.now() });
}

/**
 * Прошлый слот задачи, окно догоняния которого (с запасом) уже закончилось, или null. Если он позже
 * последнего занятого слота — запуска по расписанию не было.
 */
export function overdueSlot(job: Job, now: Date): Date | null {
  const window = (job.lookbackMinutes ?? 60) + JOB_MISSED_GRACE_MINUTES;
  return latestDueSlot(
    parseCron(job.cron),
    new Date(now.getTime() - window * MINUTE),
    MISSED_SCAN_MINUTES,
  );
}

/** Задачи, которые не запускались дольше положенного, — одно оповещение на все. */
async function alertMissedJobs(ctx: JobContext, jobs: readonly Job[], now: Date) {
  const states = await jobStates(ctx.db);
  const missed: { job: Job; last: Date; expected: Date }[] = [];
  for (const job of jobs) {
    const state = states.get(job.name);
    // Задача ещё ни разу не запускалась (только что добавлена) — сравнивать не с чем.
    if (!state?.lastSlot || state.alert === 'missed') continue;
    const expected = overdueSlot(job, now);
    if (expected && expected > state.lastSlot) {
      missed.push({ job, last: state.lastSlot, expected });
    }
  }
  if (!missed.length) return;
  const t = await alertTexts(ctx);
  const list = missed
    .map((m) =>
      t('alert.jobs_missed_item', {
        job: jobTitle(t, m.job.name),
        last: formatMomentRu(m.last),
        expected: formatMomentRu(m.expected),
      }),
    )
    .join('\n');
  const key = createHash('sha256')
    .update(missed.map((m) => `${m.job.name}@${m.expected.toISOString()}`).join(','))
    .digest('hex')
    .slice(0, 32);
  await sendPlatformAlert(ctx, { key: `missed:${key}`, text: t('alert.jobs_missed', { list }) });
  for (const m of missed) {
    await setJobAlert(ctx.db, { job: m.job.name, alert: 'missed', now: ctx.clock.now() });
  }
}
