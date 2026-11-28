import {
  bellDigestTime,
  getSeries,
  getTask,
  insertSeriesTask,
  lockSeries,
  orgIds,
  seriesForRun,
  seriesNext,
  seriesNotices,
  seriesPlanOf,
  seriesTaskFacts,
  seriesTextOf,
  setSeriesFacts,
  taskOrgSettings,
  withOrgContext,
  writeHistory,
  type SeriesRecord,
  type SeriesRunRow,
  type TaskRecord,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  bishkekDate,
  bishkekTime,
  cpNoticeAt,
  seriesRunStep,
  SERIES_STOP_TEXTS,
  type IsoDate,
  type SeriesStopReason,
} from '@buhuchet/domain';
import type { ApiDeps, Job, JobContext } from '../../deps';
import { queueTelegramEvents, taskBell, type TelegramEvent } from '../telegram/events';
import { flushEvents } from '../telegram/outbox';
import { serverTexts } from '../l10n/texts';
import { newTaskEvent } from './task-events';

/*
 * Ночной запуск «Задачи: повторы» (доработки 28.11.2026: повторяющиеся задачи, блок 1, пункты 2 и 7,
 * блок 3, пункты 5–6, блок 6, пункт 3; прототип v168 `tsRun`): в 00:05 по Бишкеку каждая организация
 * — своей транзакцией без пользователя. У серии всегда одна ближайшая задача: следующая ставится в ночь
 * после срока предыдущей, пропущенные даты задним числом не ставятся. Серию без человека останавливают
 * заблокированный исполнитель, контрагент в архиве, неактивный проект; контрагент приостановлен или
 * «Задачи» выключены — пропуск без остановки. Одна дата — одна задача: уникальный ключ серии и даты и
 * блокировка строки серии, поэтому повторный и одновременный запуск вторую не ставят.
 *
 * Сообщения о задачах, поставленных ночью, и «Повтор закончился / остановлен» уходят в «Час напоминаний»
 * организации (блок 5, пункты 2 и 4): их собирает задача `tasks.series-notify` по записям истории.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-109

/** Что сделал шаг серии. */
export type SeriesStepDone = 'none' | 'made' | 'stopped' | 'finished';

/** Причина остановки без человека (прототип `tsStopWhy`); null — можно ставить. */
export function seriesStopOf(
  r: Pick<SeriesRunRow, 'executorActive' | 'contractorStatus' | 'projectStatus'>,
  s: Pick<SeriesRecord, 'contractorId' | 'projectId'>,
): Exclude<SeriesStopReason, 'manual'> | null {
  if (!r.executorActive) return 'executor';
  if (s.contractorId && r.contractorStatus === null) return 'contractor';
  if (r.contractorStatus === 'archived') return 'archive';
  if (s.projectId && (r.projectStatus === null || ['done', 'cancelled'].includes(r.projectStatus)))
    return 'project';
  return null;
}

/** Запись истории серии — на её ближайшей задаче (прототип `tsLog`). */
async function logOnCurrent(
  tx: Tx,
  s: SeriesRecord,
  today: IsoDate,
  action: 'series_stop' | 'series_end',
  why?: string,
) {
  const { currentTaskId } = await seriesTaskFacts(tx, s.id, today);
  if (!currentTaskId) return;
  await writeHistory(tx, {
    entity: 'task',
    entityId: currentTaskId,
    action,
    contractorId: s.contractorId,
    ...(why ? { changes: [{ field: 'why', to: why }] } : {}),
  });
}

/** «Завершена» с записью «Повтор закончился» (прототип `tsFin`). */
export async function finishSeries(tx: Tx, s: SeriesRecord, today: IsoDate) {
  await setSeriesFacts(tx, s.id, { state: 'finished', stopReason: null, nextDate: null });
  await logOnCurrent(tx, s, today, 'series_end');
}

/**
 * Шаг одной серии под блокировкой её строки (`tsRun` для одной серии): остановить, завершить, поставить
 * задачу на ближайшую дату или ничего. В контексте организации без пользователя: задачу серии от имени
 * постановщика база вставляет только так (политика `tasks_insert_own`). `paused` — функция «Задачи»
 * выключена. `after` — шаг сразу после «Возобновить» или «Изменить повтор»: серия без задач впереди и
 * без дат по правилу завершается (прототип `tsResume`).
 */
export async function stepSeries(
  tx: Tx,
  id: string,
  today: IsoDate,
  o: { paused?: boolean; after?: boolean } = {},
): Promise<SeriesStepDone> {
  const locked = await lockSeries(tx, id);
  if (!locked || locked.state !== 'active') return 'none';
  const [row] = await seriesForRun(tx, [id]);
  if (!row) return 'none';
  const s = row.series;
  const stop = seriesStopOf(row, s);
  const paused = Boolean(o.paused) || row.contractorStatus === 'paused';
  const facts = { ...seriesPlanOf(s), state: s.state, lastDate: row.lastDate, made: row.made };
  const step = seriesRunStep(facts, { stop, paused }, today);
  if (step.kind === 'stop') {
    await setSeriesFacts(tx, s.id, { state: 'stopped', stopReason: step.reason, nextDate: null });
    await logOnCurrent(tx, s, today, 'series_stop', SERIES_STOP_TEXTS[step.reason]);
    return 'stopped';
  }
  if (step.kind === 'finish') {
    await finishSeries(tx, s, today);
    return 'finished';
  }
  if (step.kind === 'make') {
    const made = await insertSeriesTask(tx, s, step.date, 'series_make');
    if (!made) return 'none';
    const after = { lastDate: step.date, made: row.made + 1 };
    if (step.finish) {
      await setSeriesFacts(tx, s.id, { made: after.made });
      await finishSeries(tx, s, today);
    } else {
      await setSeriesFacts(tx, s.id, { made: after.made, nextDate: seriesNext(s, after, today) });
    }
    return 'made';
  }
  const next = seriesNext(s, row, today);
  if (o.after && !paused && !next && !(await seriesTaskFacts(tx, s.id, today)).nearDate) {
    await finishSeries(tx, s, today);
    return 'finished';
  }
  if (next !== s.nextDate || row.made !== s.made) {
    await setSeriesFacts(tx, s.id, { nextDate: next, made: row.made });
  }
  return 'none';
}

/** Все действующие серии организации из контекста; число поставленных задач. */
export async function runOrgSeries(tx: Tx, today: IsoDate): Promise<number> {
  const paused = !(await taskOrgSettings(tx)).tasks;
  let made = 0;
  for (const r of await seriesForRun(tx)) {
    if ((await stepSeries(tx, r.series.id, today, { paused })) === 'made') made++;
  }
  return made;
}

/**
 * После действия сотрудника («Возобновить», «Изменить повтор») — шаг серии без пользователя (как
 * `tsRun()` прототипа сразу после действия): задача ближайшей даты ставится от имени постановщика.
 */
export async function stepSeriesAfter(
  deps: Pick<ApiDeps, 'db' | 'clock'>,
  orgId: string,
  id: string,
): Promise<SeriesStepDone> {
  const today = bishkekDate(deps.clock.now());
  return withOrgContext(deps.db, { orgId, kind: 'job' }, async (tx) => {
    const paused = !(await taskOrgSettings(tx)).tasks;
    return stepSeries(tx, id, today, { paused, after: true });
  });
}

export const taskSeriesJob: Job = {
  name: 'tasks.series',
  cron: '5 0 * * *',
  lookbackMinutes: 24 * 60,
  async run(ctx) {
    const today = bishkekDate(ctx.clock.now());
    const failed: string[] = [];
    let made = 0;
    for (const orgId of await orgIds(ctx.db)) {
      try {
        made += await withOrgContext(ctx.db, { orgId, kind: 'job' }, (tx) =>
          runOrgSeries(tx, today),
        );
      } catch (err) {
        failed.push(orgId);
        ctx.logger.error({ job: 'tasks.series', orgId, err }, 'повторы организации не обработаны');
      }
    }
    if (made) ctx.logger.info({ job: 'tasks.series', today, made }, 'задачи по повтору');
    if (failed.length) {
      throw new Error(`tasks.series: не обработаны повторы организаций: ${failed.length}`);
    }
    // Сколько задач поставлено — в Админку → «Запуски», столбец «Что сделано».
    return made;
  },
};

/** Ключ сообщения о событии серии: номер записи истории. */
export const seriesNoticeKey = (auditId: number) => `ser:${auditId}`;

/** Наступил ли сегодня «Час напоминаний» организации к моменту `now` (по Бишкеку). */
export function seriesNoticeDue(digestAt: string, now: Date): boolean {
  return bishkekTime(now) >= cpNoticeAt(digestAt);
}

/** События серий организации из контекста — сообщениями (с `now` после «Часа напоминаний»). */
export async function seriesNoticeEvents(
  deps: ApiDeps,
  tx: Tx,
  now: Date,
): Promise<TelegramEvent[]> {
  // Вчерашние на случай пропущенного запуска; уже отправленные отсекает ключ события.
  const since = new Date(`${addDays(bishkekDate(now), -1)}T00:00:00+06:00`);
  const out: TelegramEvent[] = [];
  for (const n of await seriesNotices(tx, since)) {
    const task = await getTask(tx, n.taskId, undefined);
    if (!task?.seriesId) continue;
    const s = await getSeries(tx, task.seriesId);
    if (!s) continue;
    const key = seriesNoticeKey(n.auditId);
    if (n.action === 'series_make') {
      out.push(await nextTaskEvent(deps, tx, task, s, { key }));
      continue;
    }
    // Остановил человек — постановщику не пишется (прототип `tsHalt`: только «system»).
    if (n.action === 'series_stop' && n.byUser) continue;
    const end = n.action === 'series_end';
    out.push({
      kind: end ? 'task_series_end' : 'task_series_stop',
      to: s.authorEmployeeId,
      by: null,
      template: end ? 'tgSerEnd' : 'tgSerStop',
      values: end ? { задача: s.title } : { задача: s.title, причина: n.why },
      link: 'tasks',
      key,
      bell: { ...taskBell(task), subject: s.title },
    });
  }
  return out;
}

/** «Новая задача» о задаче серии со строкой «Повтор: <правило>» (блок 5, пункты 1–2). */
export async function nextTaskEvent(
  deps: ApiDeps,
  tx: Tx,
  task: TaskRecord,
  s: SeriesRecord,
  o: { by?: string | null; key?: string } = {},
): Promise<TelegramEvent> {
  const t = await serverTexts(deps);
  const e = await newTaskEvent(deps, tx, task, o.by ?? null, t);
  return {
    ...e,
    extra: { template: 'tgTaskRep', values: { правило: seriesTextOf(s) } },
    ...(o.key ? { key: o.key } : {}),
  };
}

/**
 * Сообщения о событиях серий (блок 5, пункты 2 и 4): каждые 5 минут организации, у которых сегодня
 * наступил «Час напоминаний», получают сообщения о задачах, поставленных по повтору, и постановщикам —
 * «Повтор закончился», «Повтор остановлен: … <причина>»; события после этого часа — в ближайший запуск.
 * Сообщение и строка колокольчика — один раз на событие (ключ — номер записи истории).
 */
export function taskSeriesNotifyJob(baseUrl: string): Job {
  return {
    name: 'tasks.series-notify',
    cron: '*/5 * * * *',
    lookbackMinutes: 60,
    async run(ctx) {
      const deps = jobDeps(ctx, baseUrl);
      const now = ctx.clock.now();
      const failed: string[] = [];
      let sent = 0;
      for (const orgId of await orgIds(ctx.db)) {
        try {
          const queued = await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
            if (!seriesNoticeDue(await bellDigestTime(tx), now)) return null;
            const events = await seriesNoticeEvents(deps, tx, now);
            sent += events.length;
            return queueTelegramEvents(deps, tx, events);
          });
          if (queued?.length) await flushEvents(ctx, orgId, queued);
        } catch (err) {
          failed.push(orgId);
          ctx.logger.error(
            { job: 'tasks.series-notify', orgId, err },
            'сообщения о повторах не собраны',
          );
        }
      }
      if (failed.length) {
        throw new Error(`tasks.series-notify: не собраны сообщения организаций: ${failed.length}`);
      }
      return sent;
    },
  };
}

/**
 * Зависимости сообщений для задачи расписания: адрес сайта — из настройки задачи (кнопка «Открыть
 * задачу» и ссылка в простом тексте), остальное — из контекста задачи.
 */
function jobDeps(ctx: JobContext, baseUrl: string): ApiDeps {
  return { ...ctx, config: { ...ctx.config, APP_BASE_URL: baseUrl } } as unknown as ApiDeps;
}
