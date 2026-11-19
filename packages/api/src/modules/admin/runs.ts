import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminJobAlertMessage,
  exportJobs,
  exportRuns,
  jobRunFacts,
  jobStates,
  listJobsPage,
  listJobValues,
  listRunsPage,
  listRunValues,
  runWithAttempts,
  withUserContext,
  type JobListRow,
  type RunJobText,
  type RunRecord,
  type RunScope,
  type RunTexts,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  bishkekDate,
  cronEvery,
  cronEveryMinutes,
  formatText,
  JOB_STATE_RANK,
  jobDoneKey,
  jobStateOf,
  jobTitleKey,
  jobWhatKey,
  pluralForm,
  RUN_KEEP_DAYS,
  RUN_MAX_ATTEMPTS,
  RUN_PERIOD_DEFAULT,
  RUN_STATUSES,
  type IsoDate,
  type JobStateCode,
  type RunStatus,
} from '@buhuchet/domain';
import {
  AdminJobList,
  AdminJobSummary,
  AdminRunCard,
  AdminRunExportQuery,
  AdminRunId,
  AdminRunList,
  AdminRunQuery,
  type AdminRunRow,
  AdminRunValuesQuery,
  ApiError,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
} from '@buhuchet/shared';
import { z } from 'zod';
import type { ApiDeps, Job } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { overdueSlot } from '../../jobs/runner';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Запуски» (решение заказчика 17.11.2026; ТЗ «Доработки 17.11.2026», блок «Админка: запуски
 * по расписанию и переписка бота», пункты 1–2; прототип v132 admin/runs.js; docs/decisions.md п. Т-15):
 * задачи по расписанию с состоянием и журнал их запусков. Только администратору платформы и только
 * чтение: запустить задачу или сменить расписание отсюда нельзя. Задачи — список из кода (`deps.jobs`),
 * состояние — те же данные и правила, что у оповещения «Сбой в работе сайта» (`jobs/runner.ts`).
 */

const error = { 'application/json': { schema: ApiError } };
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const json = <T>(schema: T) => ({ 'application/json': { schema } });

type Texts = (key: string) => string;

/** Текст словаря по ключу или запасной: у задачи, добавленной без своих текстов, ключа нет. */
const textOr = (t: Texts, key: string, fallback: string) => {
  const text = t(key);
  return text === key ? fallback : text;
};

/** «Как часто» словами — по расписанию задачи (время расписания — по Бишкеку). */
export function everyText(t: Texts, cron: string): string {
  const every = cronEvery(cron);
  switch (every.kind) {
    case 'minute':
      return t('runs.every.minute');
    case 'minutes':
      return formatText(t(`runs.every.minutes.${pluralForm(every.n)}`), { n: every.n });
    case 'hourly':
      return formatText(t('runs.every.hourly'), { minute: every.minute });
    case 'daily':
      return formatText(t('runs.every.daily'), { time: every.time });
    case 'times':
      return formatText(t(`runs.every.times.${pluralForm(every.n)}`), {
        n: every.n,
        times: every.times,
      });
    default:
      return formatText(t('runs.every.other'), { cron: every.cron });
  }
}

const titleOf = (t: Texts, name: string) => textOr(t, jobTitleKey(name), name);

const dayStart = (day: IsoDate): Date => new Date(`${day}T00:00:00+06:00`);

/**
 * Задачи из кода и «сейчас»: в открытую транзакцию идут только они, а не `deps` с пулом соединений
 * (docs/decisions.md п. О-46).
 */
interface JobSource {
  now: Date;
  jobs: ApiDeps['jobs'];
}
const jobSource = (deps: ApiDeps): JobSource => ({ now: deps.clock.now(), jobs: deps.jobs });

/**
 * Строки списка задач (расписание из кода, состояние и последние запуски — из базы) и число ошибок
 * всех задач за сутки — для плашки.
 */
async function jobData(
  src: JobSource,
  tx: Tx,
  t: Texts,
): Promise<{ rows: JobListRow[]; dayErrors: number }> {
  const { now, jobs } = src;
  const names = jobs.map((j) => j.name);
  const states = await jobStates(tx);
  // «Ошибок за сутки» считает то же, что открывает плашка, — запуски за «Сегодня» по Бишкеку.
  const facts = await jobRunFacts(tx, names, dayStart(bishkekDate(now)));
  const dayErrors = [...facts.values()].reduce((sum, f) => sum + f.errors, 0);
  const rows = jobs.map((job): JobListRow => {
    const state = states.get(job.name);
    const fact = facts.get(job.name);
    const code = jobStateOf({
      fails: state?.fails ?? 0,
      alert: state?.alert ?? null,
      lastSlot: state?.lastSlot ?? null,
      overdue: overdueSlot(job, now),
    });
    const lastStatus = fact?.lastStatus ?? null;
    return {
      name: job.name,
      title: titleOf(t, job.name),
      every: everyText(t, job.cron),
      everyMin: cronEveryMinutes(cronEvery(job.cron)),
      what: textOr(t, jobWhatKey(job.name), ''),
      lastAt: fact?.lastAt?.toISOString() ?? null,
      lastStatus,
      lastStatusText: lastStatus ? t(`runs.st.${lastStatus}`) : '',
      okAt: fact?.okAt?.toISOString() ?? null,
      fails: state?.fails ?? 0,
      state: code,
      stateText: t(`runs.state.${code}`),
      stateRank: JOB_STATE_RANK[code],
    };
  });
  return { rows, dayErrors };
}

const jobRows = async (src: JobSource, tx: Tx, t: Texts) => (await jobData(src, tx, t)).rows;

export const jobListRoute = createRoute({
  method: 'get',
  path: '/admin/runs/jobs',
  tags: ['admin'],
  summary: 'Задачи по расписанию: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Задачи с расписанием, последним запуском и состоянием',
      content: json(AdminJobList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** «Задачи» (прототип grid `run-jobs`): сначала «Падает» и «Не запускалась». */
export function jobListHandler(deps: ApiDeps): RouteHandler<typeof jobListRoute, AppEnv> {
  return async (c) => {
    const src = jobSource(deps);
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, async (tx) =>
      listJobsPage(tx, await jobRows(src, tx, t), query),
    );
    return c.json(
      {
        items: page.rows.map((r) => ({
          name: r.name,
          title: r.title,
          every: r.every,
          what: r.what,
          lastAt: r.lastAt ? r.lastAt.toISOString() : null,
          lastStatus: r.lastStatus,
          okAt: r.okAt ? r.okAt.toISOString() : null,
          fails: r.fails,
          state: r.state as JobStateCode,
        })),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const jobValuesRoute = createRoute({
  method: 'get',
  path: '/admin/runs/jobs/values',
  tags: ['admin'],
  summary: 'Значения столбца списка задач для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом задач', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function jobValuesHandler(deps: ApiDeps): RouteHandler<typeof jobValuesRoute, AppEnv> {
  return async (c) => {
    const src = jobSource(deps);
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, async (tx) =>
      listJobValues(tx, await jobRows(src, tx, t), col, q),
    );
    return c.json(values, 200);
  };
}

export const jobExportRoute = createRoute({
  method: 'get',
  path: '/admin/runs/jobs/export',
  tags: ['admin'],
  summary: 'Задачи по расписанию в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с задачами под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function jobExportHandler(deps: ApiDeps): RouteHandler<typeof jobExportRoute, AppEnv> {
  return async (c) => {
    const src = jobSource(deps);
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        async (tx) => exportJobs(tx, await jobRows(src, tx, t), query, keys),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.runs')} — ${t('tab.runs.jobs')}`,
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const jobSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/runs/jobs/summary',
  tags: ['admin'],
  summary: 'Плашки над задачами по расписанию',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Сколько задач работает, падает, не запускалось и сколько ошибок за сутки',
      content: json(AdminJobSummary),
    },
    ...denied,
  },
});

export function jobSummaryHandler(deps: ApiDeps): RouteHandler<typeof jobSummaryRoute, AppEnv> {
  return async (c) => {
    const src = jobSource(deps);
    const t = await serverTexts(deps);
    const summary = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const { rows, dayErrors } = await jobData(src, tx, t);
      const count = (state: JobStateCode) => rows.filter((r) => r.state === state).length;
      return {
        total: rows.length,
        ok: count('ok'),
        failing: count('failing'),
        missed: count('missed'),
        dayErrors,
      };
    });
    return c.json(summary, 200);
  };
}

// ───── Запуски ─────

/** Подписи журнала запусков: названия задач, «Что сделано» и итоги — тексты словаря. */
function runTexts(
  t: Texts,
  jobs: readonly Job[],
): { jobs: RunJobText[]; texts: RunTexts; done: Map<string, string> } {
  const any = t('runs.done.any');
  const list = jobs.map((j) => ({
    name: j.name,
    title: titleOf(t, j.name),
    done: textOr(t, jobDoneKey(j.name), any),
  }));
  return {
    jobs: list,
    texts: {
      status: Object.fromEntries(RUN_STATUSES.map((s) => [s, t(`runs.st.${s}`)])) as Record<
        RunStatus,
        string
      >,
      attempt: formatText(t('runs.try'), { max: RUN_MAX_ATTEMPTS }),
      nothing: t('runs.done.nothing'),
      seconds: t('runs.dur.s'),
      minutes: t('runs.dur.m'),
    },
    done: new Map(list.map((j) => [j.name, j.done])),
  };
}

/** Период («Сегодня» — с начала дня по Бишкеку, не дольше срока хранения) и «Важные · Все». */
function runScopeOf(
  now: Date,
  p: { days?: string | undefined; all?: string | undefined },
): RunScope {
  const days = Math.min(Number(p.days ?? RUN_PERIOD_DEFAULT), RUN_KEEP_DAYS);
  return { from: dayStart(addDays(bishkekDate(now), -(days - 1))), important: p.all !== '1' };
}

const runId = (r: { job: string; slot: Date; attempt: number }) =>
  `${r.job}:${r.slot.getTime()}:${r.attempt}`;

/** Запуск для ответа: «Что сделано» — словами (0 — «Нечего делать», пусто — задача число не сообщает). */
function runBody(
  r: RunRecord,
  o: { title: string; done: string | undefined; texts: RunTexts; any: string },
): AdminRunRow {
  return {
    id: runId(r),
    job: r.job,
    title: o.title,
    slot: r.slot.toISOString(),
    attempt: r.attempt,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    status: r.status,
    ms: r.finishedAt ? Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()) : null,
    done: r.done,
    doneText:
      r.done === null
        ? null
        : r.done === 0
          ? o.texts.nothing
          : formatText(o.done ?? o.any, { n: r.done }),
    error: r.error,
  };
}

export const runListRoute = createRoute({
  method: 'get',
  path: '/admin/runs',
  tags: ['admin'],
  summary: 'Журнал запусков задач по расписанию: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminRunQuery },
  responses: {
    200: {
      description: 'Запуски за период: каждая попытка — строка; сначала новые',
      content: json(AdminRunList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** «Запуски» (прототип grid `run-list`): «Важные» — ошибки и запуски, которые что-то сделали. */
export function runListHandler(deps: ApiDeps): RouteHandler<typeof runListRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const t = await serverTexts(deps);
    const { jobs, texts, done } = runTexts(t, deps.jobs);
    const scope = runScopeOf(deps.clock.now(), params);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listRunsPage(tx, { query, jobs, texts, scope }),
    );
    const any = t('runs.done.any');
    return c.json(
      {
        items: page.rows.map((r) =>
          runBody(r, { title: titleOf(t, r.job), done: done.get(r.job), texts, any }),
        ),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const runValuesRoute = createRoute({
  method: 'get',
  path: '/admin/runs/values',
  tags: ['admin'],
  summary: 'Значения столбца журнала запусков для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminRunValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом запусков за период',
      content: json(ListValues),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function runValuesHandler(deps: ApiDeps): RouteHandler<typeof runValuesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const t = await serverTexts(deps);
    const { jobs, texts } = runTexts(t, deps.jobs);
    const scope = runScopeOf(deps.clock.now(), params);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listRunValues(tx, { key: params.col, q: params.q, jobs, texts, scope }),
    );
    return c.json(values, 200);
  };
}

export const runExportRoute = createRoute({
  method: 'get',
  path: '/admin/runs/export',
  tags: ['admin'],
  summary: 'Журнал запусков в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminRunExportQuery },
  responses: {
    200: { description: 'Файл Excel с запусками под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function runExportHandler(deps: ApiDeps): RouteHandler<typeof runExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    const scope = runScopeOf(deps.clock.now(), params);
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const { jobs, texts } = runTexts(t, deps.jobs);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportRuns(tx, { query, keys, jobs, texts, scope }),
        'export',
      );
      return xlsxResponse(c, {
        title: t('nav.runs'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

export const runCardRoute = createRoute({
  method: 'get',
  path: '/admin/runs/card',
  tags: ['admin'],
  summary: 'Окно «Запуск»: попытка, другие попытки того же запуска и сообщение о сбое',
  middleware: [requirePlatformAdmin] as const,
  request: { query: z.object({ id: AdminRunId }) },
  responses: {
    200: { description: 'Запуск целиком', content: json(AdminRunCard) },
    400: { description: 'Неверный номер запуска', content: error },
    404: { description: 'Запуска нет: журнал хранится 30 дней', content: error },
    ...denied,
  },
});

/**
 * «Запуск» (прототип `runDlg`): всё о попытке, прежние и следующие попытки того же запуска и — после
 * неудачной попытки — сообщение о сбое администраторам из журнала Telegram (только его номер и время).
 */
export function runCardHandler(deps: ApiDeps): RouteHandler<typeof runCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('query');
    const [job, slotMs, attemptText] = id.split(':') as [string, string, string];
    const attempt = Number(attemptText);
    const t = await serverTexts(deps);
    const { texts, done } = runTexts(t, deps.jobs);
    const card = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const found = await runWithAttempts(tx, job, new Date(Number(slotMs)));
      if (!found) return null;
      const all: RunRecord[] = [
        ...found.prev.map((p) => ({
          job,
          slot: found.last.slot,
          attempt: p.attempt,
          startedAt: new Date(p.startedAt),
          finishedAt: p.finishedAt ? new Date(p.finishedAt) : null,
          status: 'error' as const,
          error: p.error,
          done: null,
        })),
        found.last,
      ];
      const run = all.find((r) => r.attempt === attempt);
      if (!run) return null;
      const alert =
        run.status === 'error'
          ? await adminJobAlertMessage(tx, job, run.finishedAt ?? run.startedAt)
          : null;
      return { run, others: all.filter((r) => r !== run), alert };
    });
    if (!card) return apiFail(404, 'not_found', 'Запуск не найден');
    const body = (r: RunRecord) =>
      runBody(r, { title: titleOf(t, job), done: done.get(job), texts, any: t('runs.done.any') });
    const known = deps.jobs.find((j) => j.name === job);
    return c.json(
      {
        run: body(card.run),
        every: known ? everyText(t, known.cron) : null,
        attempts: card.others.sort((a, b) => a.attempt - b.attempt).map(body),
        alert: card.alert ? { id: card.alert.id, at: card.alert.at.toISOString() } : null,
      },
      200,
    );
  };
}
