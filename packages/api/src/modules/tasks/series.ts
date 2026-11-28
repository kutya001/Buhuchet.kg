import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  attachTaskToSeries,
  createSeries,
  exportSeries,
  getSeries,
  insertSeriesTask,
  listSeriesPage,
  listSeriesValues,
  lockSeries,
  seriesNext,
  seriesStopFacts,
  seriesTaskFacts,
  seriesTaskList,
  seriesTaskVisible,
  seriesTextOf,
  seriesTexts,
  setSeriesFacts,
  storedRule,
  seriesRuleColumns,
  updateSeries,
  withOrgContext,
  writeHistory,
  type SeriesListOptions,
  type SeriesRecord,
  type SeriesTemplate,
  type TaskFields,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  hasPermission,
  monthLastDay,
  SERIES_MESSAGES,
  SERIES_RULE_MESSAGES,
  seriesBossRefusal,
  seriesFirstDate,
  seriesRuleProblems,
  seriesStopText,
  seriesUpcoming,
  type AccessSubject,
  type IsoDate,
  type SeriesActor,
  type SeriesRefusal,
  type SeriesRule,
  type TaskTerm,
} from '@buhuchet/domain';
import {
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  SeriesList,
  SeriesRuleUpdate,
  SeriesTasks,
  SeriesVersionBody,
  TaskSeriesInfo,
  Uuid,
  type SeriesListRow,
  type SeriesRuleBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { error, requireTasks, subjectOf, taskAccessOf, todayOf } from './common';
import { finishSeries, seriesStopOf, stepSeriesAfter, type SeriesStepDone } from './series-job';

/*
 * Повторяющиеся задачи (доработки 28.11.2026: повторяющиеся задачи, блоки 2–4; прототип v168
 * modules/task-series.js): строка «Повтор» карточки задачи, «Все задачи серии», «Изменить повтор»,
 * «Остановить повтор», «Возобновить» и вкладка «Повторы». Права проверяет сервер: настраивает повтор
 * тот, у кого «Ставить задачи»; менять, останавливать и возобновлять — постановщик с этим правом и
 * владелец (`seriesBossRefusal`, как у задачи); видят серию те, кто видит её задачи, вкладку «Повторы» —
 * свои серии, владелец и «Видеть задачи всех» — все.
 */

/** Кто действует с серией — для правил @buhuchet/domain. */
export function seriesActorOf(subject: AccessSubject): SeriesActor {
  return {
    employeeId: subject.employeeId,
    isOwner: subject.isOwner,
    canCreate: hasPermission(subject, 'tasksCreate'),
  };
}

/** Видит все серии: владелец и «Видеть задачи всех» (прототип `tsScope`). */
export const seriesSeeAll = (subject: AccessSubject) =>
  subject.isOwner || hasPermission(subject, 'tasksAll');

const STATE_REFUSALS: readonly SeriesRefusal[] = [
  'series_not_active',
  'series_not_stopped',
  'series_finished',
  'series_resume_blocked',
  'series_task_closed',
];
const BAD_REFUSALS: readonly SeriesRefusal[] = ['series_no_dates', 'series_rule_one'];

/** Отказ по правилу серии: данные — 400, состояние — 409, кто действует — 403. */
export function seriesRefuse(code: SeriesRefusal, values: Record<string, string> = {}): never {
  const status = BAD_REFUSALS.includes(code) ? 400 : STATE_REFUSALS.includes(code) ? 409 : 403;
  apiFail(status, code, formatText(SERIES_MESSAGES[code], values), values.why ? values : undefined);
}

export function seriesNotFound(): never {
  apiFail(404, 'series_not_found', 'Повтор не найден');
}

/** Правило из тела запроса. */
export function ruleOfBody(body: SeriesRuleBody): SeriesRule {
  return {
    every: body.every,
    unit: body.unit,
    ...(body.weekDays ? { weekDays: body.weekDays } : {}),
    ...(body.monthMode ? { monthMode: body.monthMode } : {}),
    end: { kind: body.end.kind, date: body.end.date ?? null, count: body.end.count ?? null },
  };
}

/** Правило для ответа API (как его хранит база). */
export function ruleBody(rule: SeriesRule): SeriesRuleBody {
  return {
    every: rule.every,
    unit: rule.unit,
    ...(rule.weekDays ? { weekDays: [...rule.weekDays] } : {}),
    ...(rule.monthMode ? { monthMode: rule.monthMode } : {}),
    end: {
      kind: rule.end.kind,
      ...(rule.end.kind === 'date' ? { date: rule.end.date ?? null } : {}),
      ...(rule.end.kind === 'count' ? { count: rule.end.count ?? null } : {}),
    },
  };
}

/**
 * Проверка окна «Повтор» на сервере (`seriesRuleProblems`): первое неверное поле — 400 с кодом
 * правила и `details.field`. Ответ — правило, как его сохранит база.
 */
export function checkedRule(body: SeriesRuleBody, start: IsoDate, term: TaskTerm): SeriesRule {
  const rule = ruleOfBody(body);
  const problems = seriesRuleProblems({ rule, start, term });
  const first = Object.entries(problems)[0];
  if (first) {
    const [field, code] = first;
    apiFail(400, code!, SERIES_RULE_MESSAGES[code!], { field: `repeat.${field}` });
  }
  return storedRule(rule, term);
}

/** Первая дата серии не раньше сегодня; дат нет — 400 `series_no_dates`. */
export function firstDateOf(rule: SeriesRule, start: IsoDate, term: TaskTerm, today: IsoDate) {
  const d = seriesFirstDate({ rule, start, term }, today);
  if (!d) seriesRefuse('series_no_dates');
  return d;
}

/** Строка «Повтор» карточки задачи (прототип `tsCardHtml`). */
export async function seriesInfoOf(
  tx: Tx,
  seriesId: string,
  subject: AccessSubject,
  today: IsoDate,
): Promise<TaskSeriesInfo | null> {
  const s = await getSeries(tx, seriesId);
  if (!s) return null;
  const facts = await seriesTaskFacts(tx, s.id, today);
  const refusal = seriesBossRefusal(s.authorEmployeeId, seriesActorOf(subject));
  return {
    id: s.id,
    rule: ruleBody(s.rule),
    start: s.start,
    term: s.term,
    text: seriesTextOf(s),
    state: s.state,
    stopReason: s.stopReason,
    stopText: seriesStopText(s.stopReason),
    next: seriesNext(s, facts, today),
    count: facts.made,
    manage: refusal === null,
    // Постановщик без права видит кнопки неактивными с подсказкой; остальные — без кнопок.
    refusal: refusal === 'series_create_right' ? SERIES_MESSAGES[refusal] : null,
    version: s.version,
  };
}

/**
 * Серия, которую сотрудник видит: свою серию — постановщик, все — владелец и «Видеть задачи всех»,
 * иначе — если видна хоть одна её задача (область задач, как у карточки). Нет — 404, как чужой
 * организации.
 */
async function visibleSeries(
  tx: Tx,
  id: string,
  subject: AccessSubject,
  lock = false,
): Promise<SeriesRecord> {
  const s = lock ? await lockSeries(tx, id) : await getSeries(tx, id);
  if (!s) seriesNotFound();
  if (s.authorEmployeeId === subject.employeeId || seriesSeeAll(subject)) return s;
  if (!(await seriesTaskVisible(tx, s.id, taskAccessOf(subject)))) seriesNotFound();
  return s;
}

/** Менять серию: постановщик с «Ставить задачи» или владелец. */
function requireBoss(s: SeriesRecord, subject: AccessSubject) {
  const refusal = seriesBossRefusal(s.authorEmployeeId, seriesActorOf(subject));
  if (refusal) seriesRefuse(refusal);
}

/** Запись истории серии на её ближайшей задаче (прототип `tsLog`). */
export async function logSeries(
  tx: Tx,
  s: SeriesRecord,
  today: IsoDate,
  action: 'series_set' | 'series_edit' | 'series_stop' | 'series_resume' | 'series_end',
  changes?: { field: string; from?: string; to?: string }[],
  taskId?: string,
) {
  const id = taskId ?? (await seriesTaskFacts(tx, s.id, today)).currentTaskId;
  if (!id) return;
  await writeHistory(tx, {
    entity: 'task',
    entityId: id,
    action,
    contractorId: s.contractorId,
    ...(changes ? { changes } : {}),
  });
}

/** «Остановлена» человеком (прототип `tsHalt` с `S.me`): «Повтор остановлен». */
export async function stopSeriesByUser(tx: Tx, s: SeriesRecord, today: IsoDate, taskId?: string) {
  await updateSeries(
    tx,
    s.id,
    s.version,
    { state: 'stopped', stopReason: 'manual', nextDate: null },
    s.contractorId,
  );
  await logSeries(tx, s, today, 'series_stop', undefined, taskId);
}

/** Поля задачи, которые повторяет серия (блок 1, пункт 6). */
export function templateOf(f: TaskFields): SeriesTemplate {
  return {
    title: f.title,
    description: f.description,
    categoryCode: f.categoryCode,
    contractorId: f.contractorId,
    projectId: f.projectId,
    executorEmployeeId: f.executorEmployeeId,
    term: f.term,
    needFile: f.needFile,
    confirm: f.confirm,
  };
}

/**
 * «Повтор настроен: <правило>» (блок 2, пункт 1; прототип `taskDlg` → `tsNew`): серия от имени того,
 * кто сохраняет, и её первая задача — новая на `first` или уже существующая незакрытая `taskId`.
 * Последняя задача по правилу — серия сразу «Завершена».
 */
export async function startSeries(
  tx: Tx,
  o: {
    fields: TaskFields;
    rule: SeriesRule;
    start: IsoDate;
    authorEmployeeId: string;
    today: IsoDate;
  } & ({ first: IsoDate } | { taskId: string; date: IsoDate }),
): Promise<{ series: SeriesRecord; taskId: string }> {
  const id = await createSeries(tx, templateOf(o.fields), o.rule, o.start, o.authorEmployeeId);
  const s = (await getSeries(tx, id))!;
  let taskId: string;
  let date: IsoDate;
  if ('first' in o) {
    taskId = (await insertSeriesTask(tx, s, o.first, 'create'))!;
    date = o.first;
  } else {
    await attachTaskToSeries(tx, o.taskId, id, o.date);
    taskId = o.taskId;
    date = o.date;
  }
  await logSeries(tx, s, o.today, 'series_set', [{ field: 'repeat', to: seriesTextOf(s) }], taskId);
  const next = seriesNext(s, { lastDate: date, made: 1 }, o.today);
  await setSeriesFacts(tx, id, { made: 1, nextDate: next });
  if (!next) await finishSeries(tx, s, o.today);
  return { series: (await getSeries(tx, id))!, taskId };
}

const idParam = z.object({ id: Uuid });
const off = { description: 'Задачи выключены в учётной политике', content: error };
const seriesErrors = {
  401: { description: 'Нет входа', content: error },
  403: {
    description:
      'Нет права «Ставить задачи», менять повтор может только постановщик или владелец, задачи выключены',
    content: error,
  },
  404: { description: 'Нет такого повтора или сотрудник не видит его задач', content: error },
};

const SeriesActionResult = z.object({
  series: TaskSeriesInfo,
  /** Шаг сразу после действия: поставлена ли задача на ближайшую дату. */
  made: z.boolean(),
});

/** Ответ действия: серия после шага без пользователя. */
async function actionResult(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
  done: SeriesStepDone,
) {
  const subject = subjectOf(c);
  const series = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
    seriesInfoOf(tx, id, subject, todayOf(deps)),
  );
  return { series: series!, made: done === 'made' };
}

export const seriesTasksRoute = createRoute({
  method: 'get',
  path: '/task-series/{id}/tasks',
  tags: ['tasks'],
  summary: 'Все задачи серии',
  middleware: [requireEmployee] as const,
  request: { params: idParam },
  responses: {
    200: {
      description: 'Задачи серии: срок, исполнитель, статус — новые сверху',
      content: { 'application/json': { schema: SeriesTasks } },
    },
    ...seriesErrors,
  },
});

/** «Все задачи серии» (прототип `tsListDlg`). */
export function seriesTasksHandler(deps: ApiDeps): RouteHandler<typeof seriesTasksRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await requireTasks(tx, orgContextOf(c).orgId);
      const s = await visibleSeries(tx, id, subject);
      return { title: s.title, text: seriesTextOf(s), items: await seriesTaskList(tx, s.id) };
    });
    return c.json(body, 200);
  };
}

export const updateSeriesRuleRoute = createRoute({
  method: 'put',
  path: '/task-series/{id}/rule',
  tags: ['tasks'],
  summary: 'Изменить повтор',
  middleware: [requireEmployee] as const,
  request: {
    params: idParam,
    body: { required: true, content: { 'application/json': { schema: SeriesRuleUpdate } } },
  },
  responses: {
    200: {
      description:
        'Правило и начало изменены («Повтор изменён: было → стало»); закончившийся повтор с датами впереди снова действует',
      content: { 'application/json': { schema: SeriesActionResult } },
    },
    400: { description: 'Неверное правило повтора', content: error },
    ...seriesErrors,
    ...versionedSaveResponses,
  },
});

/**
 * «Изменить повтор» из карточки задачи и вкладки «Повторы» (прототип `tsEditRule`): это «Эту и
 * следующие» для правила. Закончившийся повтор, у которого по новому правилу есть даты, снова
 * «Действует» («Повтор возобновлён»); сразу после — шаг серии (задача на ближайшую дату).
 */
export function updateSeriesRuleHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateSeriesRuleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const org = orgContextOf(c);
    await withOrgContext(deps.db, org, async (tx) => {
      await requireTasks(tx, org.orgId);
      const s = await visibleSeries(tx, id, subject, true);
      requireBoss(s, subject);
      const start = s.term === 'month' ? monthLastDay(body.start.slice(0, 7)) : body.start;
      const rule = checkedRule(body.rule, start, s.term);
      const was = seriesTextOf(s);
      const after: SeriesRecord = { ...s, rule, start };
      const now = seriesTextOf(after);
      const facts = await seriesTaskFacts(tx, s.id, today);
      const revive =
        s.state === 'finished' && seriesUpcoming({ ...after, state: 'active', ...facts }, today);
      await updateSeries(
        tx,
        s.id,
        body.version,
        {
          ...seriesRuleColumns(rule, s.term),
          startDate: start,
          ...(revive ? { state: 'active', stopReason: null } : {}),
        },
        s.contractorId,
      );
      if (was !== now) {
        await logSeries(tx, s, today, 'series_edit', [{ field: 'repeat', from: was, to: now }]);
      }
      if (revive) await logSeries(tx, s, today, 'series_resume');
      const state = revive ? 'active' : s.state;
      if (state === 'active') {
        await setSeriesFacts(tx, s.id, { nextDate: seriesNext(after, facts, today, state) });
      }
    });
    const done = await stepSeriesAfter(deps, org.orgId, id);
    return c.json(await actionResult(deps, c, id, done), 200);
  };
}

export const stopSeriesRoute = createRoute({
  method: 'post',
  path: '/task-series/{id}/stop',
  tags: ['tasks'],
  summary: 'Остановить повтор',
  middleware: [requireEmployee] as const,
  request: {
    params: idParam,
    body: { required: true, content: { 'application/json': { schema: SeriesVersionBody } } },
  },
  responses: {
    200: {
      description: 'Повтор «Остановлена»: новые задачи не ставятся, поставленные остаются',
      content: { 'application/json': { schema: SeriesActionResult } },
    },
    ...seriesErrors,
    ...versionedSaveResponses,
    409: { description: 'Повтор уже остановлен или закончился; запись изменена', content: error },
  },
});

/** «Остановить повтор» (прототип `tsStopDlg`). */
export function stopSeriesHandler(deps: ApiDeps): RouteHandler<typeof stopSeriesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const org = orgContextOf(c);
    await withOrgContext(deps.db, org, async (tx) => {
      await requireTasks(tx, org.orgId);
      const s = await visibleSeries(tx, id, subject, true);
      requireBoss(s, subject);
      if (s.state !== 'active') seriesRefuse('series_not_active');
      await stopSeriesByUser(tx, { ...s, version }, today);
    });
    return c.json(await actionResult(deps, c, id, 'stopped'), 200);
  };
}

export const resumeSeriesRoute = createRoute({
  method: 'post',
  path: '/task-series/{id}/resume',
  tags: ['tasks'],
  summary: 'Возобновить повтор',
  middleware: [requireEmployee] as const,
  request: {
    params: idParam,
    body: { required: true, content: { 'application/json': { schema: SeriesVersionBody } } },
  },
  responses: {
    200: {
      description:
        'Повтор «Действует»: задача — на ближайшую дату по правилу, пропущенные не ставятся',
      content: { 'application/json': { schema: SeriesActionResult } },
    },
    ...seriesErrors,
    ...versionedSaveResponses,
    409: {
      description:
        'Повтор не остановлен; исполнитель заблокирован, контрагент в архиве или проект не активен; запись изменена',
      content: error,
    },
  },
});

/**
 * «Возобновить» (блок 3, пункт 3; прототип `tsResume`): пока серию останавливает заблокированный
 * исполнитель, архив контрагента или неактивный проект — отказ с причиной. Сразу после — шаг серии без
 * пользователя: задача на ближайшую дату; дат впереди нет — «Завершена».
 */
export function resumeSeriesHandler(deps: ApiDeps): RouteHandler<typeof resumeSeriesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const org = orgContextOf(c);
    await withOrgContext(deps.db, org, async (tx) => {
      await requireTasks(tx, org.orgId);
      const s = await visibleSeries(tx, id, subject, true);
      requireBoss(s, subject);
      if (s.state !== 'stopped') seriesRefuse('series_not_stopped');
      const why = seriesStopText(seriesStopOf(await seriesStopFacts(tx, s), s));
      if (why) seriesRefuse('series_resume_blocked', { why });
      await updateSeries(tx, s.id, version, { state: 'active', stopReason: null }, s.contractorId);
      await logSeries(tx, s, today, 'series_resume');
    });
    const done = await stepSeriesAfter(deps, org.orgId, id);
    return c.json(await actionResult(deps, c, id, done), 200);
  };
}

/** Условия вкладки «Повторы» того, кто смотрит. Задачи выключены — 403. */
async function seriesListOptions(
  deps: ApiDeps,
  c: Context<AppEnv>,
  tx: Tx,
): Promise<SeriesListOptions> {
  await requireTasks(tx, orgContextOf(c).orgId);
  const subject = subjectOf(c);
  return {
    t: await serverTexts(deps),
    today: todayOf(deps),
    texts: await seriesTexts(tx),
    authorEmployeeId: seriesSeeAll(subject) ? null : subject.employeeId,
  };
}

const listErrors = {
  ...listQueryResponses,
  401: { description: 'Нет входа', content: error },
  403: { description: 'Нет права «Ставить задачи» или задачи выключены', content: error },
};

export const listSeriesRoute = createRoute({
  method: 'get',
  path: '/task-series',
  tags: ['tasks'],
  summary: 'Вкладка «Повторы»: страница списка серий',
  middleware: [requirePermission('tasksCreate')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Одна строка на серию: свои серии; владелец и «Видеть задачи всех» — все. Сортировка по «Следующая», остановленные и завершённые — в конце',
      content: { 'application/json': { schema: SeriesList } },
    },
    ...listErrors,
  },
});

/** Вкладка «Повторы» (блок 4, пункт 3; прототип `tsRender`) — тем, кто ставит задачи. */
export function listSeriesHandler(deps: ApiDeps): RouteHandler<typeof listSeriesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const subject = subjectOf(c);
    const actor = seriesActorOf(subject);
    const page = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listSeriesPage(tx, query, await seriesListOptions(deps, c, tx)),
    );
    const items: SeriesListRow[] = page.rows.map((r) => {
      const refusal = seriesBossRefusal(r.author.id, actor);
      return {
        id: r.id,
        title: r.title,
        text: r.text,
        executor: r.executor,
        contractor: r.contractor,
        next: r.next,
        end: r.end,
        state: r.state,
        stopText: seriesStopText(r.stopReason),
        author: r.author,
        createdAt: r.createdAt.toISOString(),
        made: r.made,
        task: r.task,
        manage: refusal === null,
        refusal: refusal ? SERIES_MESSAGES[refusal] : null,
        version: r.version,
      };
    });
    return c.json(
      {
        items,
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

export const seriesValuesRoute = createRoute({
  method: 'get',
  path: '/task-series/values',
  tags: ['tasks'],
  summary: 'Значения столбца вкладки «Повторы» для фильтра',
  middleware: [requirePermission('tasksCreate')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом серий',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listErrors,
  },
});

export function seriesValuesHandler(deps: ApiDeps): RouteHandler<typeof seriesValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await withOrgContext(deps.db, orgContextOf(c), async (tx) =>
      listSeriesValues(tx, col, await seriesListOptions(deps, c, tx), q),
    );
    return c.json(values, 200);
  };
}

export const exportSeriesRoute = createRoute({
  method: 'get',
  path: '/task-series/export',
  tags: ['tasks'],
  summary: 'Вкладка «Повторы» в Excel',
  middleware: [requirePermission('tasksCreate'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: { description: 'Файл Excel с сериями под поиском и фильтрами', content: xlsxContent },
    ...listErrors,
    ...exportRateResponses,
    403: off,
  },
});

export function exportSeriesHandler(deps: ApiDeps): RouteHandler<typeof exportSeriesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const t = await serverTexts(deps);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const result = await withOrgContext(
        deps.db,
        { ...orgContextOf(c), kind: 'export' },
        async (tx) => exportSeries(tx, query, keys, await seriesListOptions(deps, c, tx)),
      );
      return xlsxResponse(c, {
        title: t('tab.tasks.series'),
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
