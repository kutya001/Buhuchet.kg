import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  createTask,
  employeeActive,
  getTask,
  lockTask,
  lockSeries,
  seriesNext,
  seriesRuleColumns,
  seriesTaskFacts,
  seriesTextOf,
  setSeriesFacts,
  storedRule,
  updateLaterSeriesTasks,
  updateSeries,
  type SeriesRecord,
  orgMenuSettings,
  taskCategoryActive,
  taskContractorOf,
  taskProjectAllowed,
  updateTask,
  withOrgContext,
  type TaskFields,
  type TaskLock,
  type TaskRecord,
  type Tx,
} from '@buhuchet/db';
import {
  monthLastDay,
  seriesBossRefusal,
  seriesRuleEqual,
  taskOpen,
  type IsoDate,
  type SeriesRule,
  taskActionRefusal,
  taskConfirmEditable,
  taskStatusAfterEdit,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import { CreateTaskRequest, Task, UpdateTaskRequest, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { projectWhere, taskProjectsOn } from '../projects/common';
import { queueTelegramEvents } from '../telegram/events';
import { flushEvents } from '../telegram/outbox';
import { taskOut } from './card';
import {
  checkedRule,
  firstDateOf,
  logSeries,
  ruleBody,
  ruleOfBody,
  seriesActorOf,
  seriesRefuse,
  startSeries,
  templateOf,
} from './series';
import { nextTaskEvent } from './series-job';
import { newTaskEvent } from './task-events';
import {
  actorOf,
  cpScopeOf,
  error,
  factsOf,
  refuse,
  requireTasks,
  subjectOf,
  taskAccessOf,
  taskNotFound,
  todayOf,
} from './common';

type Body = Omit<z.infer<typeof CreateTaskRequest>, 'repeat'>;

/** Что было у задачи до «Изменить»: неизменённое отключённое значение сохраняется как есть. */
interface Before {
  lock: TaskLock;
  categoryCode: string;
}

function bad(code: string, message: string, field: string): never {
  apiFail(400, code, message, { field });
}

/**
 * Поля формы для сохранения (прототип `taskDlg`): категория из справочника платформы (действующая),
 * контрагент в области сотрудника и не в архиве, исполнитель — действующий сотрудник организации;
 * срок «На месяц» — последний день месяца. Без «Файлов в карточках» «Требуется файл» не предлагается
 * и не меняется (docs/deviations.md п. Б-1); у закрытой задачи «Требуется подтверждение» не меняется.
 */
async function fieldsOf(
  tx: Tx,
  subject: AccessSubject,
  body: Body,
  filesOn: boolean,
  before: Before | null,
  features: Readonly<Record<Feature, boolean>>,
): Promise<TaskFields> {
  const category = await taskCategoryActive(tx, body.categoryCode);
  if (category === null) {
    bad('task_category_not_found', 'Нет такой категории задач', 'categoryCode');
  }
  if (category === false && body.categoryCode !== before?.categoryCode) {
    bad('task_category_inactive', 'Категория отключена — выберите другую', 'categoryCode');
  }
  if (body.contractorId && body.contractorId !== before?.lock.contractorId) {
    const cp = await taskContractorOf(tx, body.contractorId, cpScopeOf(subject));
    if (!cp) bad('task_contractor_not_found', 'Контрагент не найден', 'contractorId');
    if (cp.archived) {
      bad(
        'task_contractor_archived',
        'Контрагент в архиве — сначала верните его из архива',
        'contractorId',
      );
    }
  }
  if (body.executorEmployeeId !== before?.lock.executorEmployeeId) {
    const active = await employeeActive(tx, body.executorEmployeeId);
    if (active === null)
      bad('task_executor_not_found', 'Исполнитель не найден', 'executorEmployeeId');
    if (!active) {
      bad(
        'task_executor_inactive',
        'Исполнитель заблокирован — выберите другого',
        'executorEmployeeId',
      );
    }
  }
  const confirmLocked = before && !taskConfirmEditable(before.lock.status);
  return {
    title: body.title,
    description: body.description,
    categoryCode: body.categoryCode,
    contractorId: body.contractorId,
    projectId: await projectOf(tx, subject, body, before, features),
    executorEmployeeId: body.executorEmployeeId,
    term: body.term,
    dueDate: body.term === 'month' ? monthLastDay(body.dueDate.slice(0, 7)) : body.dueDate,
    // ОТКЛОНЕНИЕ: docs/deviations.md#Б-1
    needFile: filesOn ? body.needFile : (before?.lock.needFile ?? false),
    confirm: confirmLocked ? before.lock.confirm : body.confirm,
  };
}

/**
 * «Проект» задачи (задача 2.26; прототип `taskDlg`, `projsOf`): только у задачи по контрагенту, проект
 * этого контрагента, который сотрудник видит, — не отменённый и не завершённый (уже выбранный остаётся).
 * Поля «Проект» в форме нет (выключены «Проекты контрагентов» или нет права «Просматривать проекты») —
 * проект задачи не меняется, пока не сменился контрагент.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
async function projectOf(
  tx: Tx,
  subject: AccessSubject,
  body: Body,
  before: Before | null,
  features: Readonly<Record<Feature, boolean>>,
): Promise<string | null> {
  const was = before?.lock.projectId ?? null;
  if (!taskProjectsOn(subject, features)) {
    return was && before?.lock.contractorId === body.contractorId ? was : null;
  }
  if (!body.projectId) return null;
  if (
    !body.contractorId ||
    !(await taskProjectAllowed(tx, body.projectId, body.contractorId, was, projectWhere(subject)))
  ) {
    bad(
      'task_project_invalid',
      'Проект не найден, отменён или завершён — выберите другой',
      'projectId',
    );
  }
  return body.projectId;
}

/** Что сделать с повтором при «Изменить»: добавить серию или «Эту и следующие». */
type SeriesEdit =
  | { kind: 'add'; rule: SeriesRule }
  | { kind: 'next'; series: SeriesRecord; rule: SeriesRule };

/**
 * Повтор при «Изменить» (блок 2, пункт 1; блок 3, пункт 1; прототип `taskDlg`, `tsAsk`): разовой
 * незакрытой задаче можно добавить повтор (право «Ставить задачи»); у задачи серии «Только эту задачу»
 * правило не меняет, «Эту и следующие» правит серию — постановщик серии с правом или владелец. У
 * закончившейся серии меняется только задача.
 */
async function seriesPlanOfEdit(
  tx: Tx,
  subject: AccessSubject,
  lock: TaskLock,
  series: SeriesRecord | null,
  body: Omit<z.infer<typeof UpdateTaskRequest>, 'version'>,
  fields: TaskFields,
  today: IsoDate,
): Promise<SeriesEdit | null> {
  if (!series) {
    if (!body.repeat) return null;
    if (!seriesActorOf(subject).canCreate) refuse('task_create_right');
    if (!taskOpen(lock.status)) seriesRefuse('series_task_closed');
    return { kind: 'add', rule: checkedRule(body.repeat, fields.dueDate, fields.term) };
  }
  if (series.state === 'finished') return null;
  if (body.scope === 'one') {
    const changed =
      body.repeat &&
      !seriesRuleEqual(storedRule(ruleOfBody(body.repeat), fields.term), series.rule);
    if (changed || fields.term !== series.term) seriesRefuse('series_rule_one');
    return null;
  }
  const boss = seriesBossRefusal(series.authorEmployeeId, seriesActorOf(subject));
  if (boss) seriesRefuse(boss);
  const rule = checkedRule(body.repeat ?? ruleBody(series.rule), fields.dueDate, fields.term);
  return { kind: 'next', series, rule };
}

/**
 * Повтор после сохранения задачи: новая серия с этой задачей первой или «Эту и следующие» (прототип
 * `tsApplyAll`): поля и правило серии, начало — срок этой задачи, открытые следующие задачи — с новыми
 * полями; в истории — «Повтор изменён: было → стало» или «Изменены эта и следующие задачи серии».
 */
async function applySeriesEdit(
  tx: Tx,
  plan: SeriesEdit,
  o: { id: string; fields: TaskFields; today: IsoDate; subject: AccessSubject },
) {
  if (plan.kind === 'add') {
    await startSeries(tx, {
      fields: o.fields,
      rule: plan.rule,
      start: o.fields.dueDate,
      authorEmployeeId: o.subject.employeeId,
      today: o.today,
      taskId: o.id,
      date: o.fields.dueDate,
    });
    return;
  }
  const s = plan.series;
  const tpl = templateOf(o.fields);
  const after: SeriesRecord = { ...s, ...tpl, rule: plan.rule, start: o.fields.dueDate };
  await updateSeries(
    tx,
    s.id,
    s.version,
    { ...tpl, ...seriesRuleColumns(plan.rule, tpl.term), startDate: o.fields.dueDate },
    s.contractorId,
  );
  await updateLaterSeriesTasks(tx, s.id, { id: o.id, dueDate: o.fields.dueDate }, tpl);
  const was = seriesTextOf(s);
  const now = seriesTextOf(after);
  await logSeries(
    tx,
    s,
    o.today,
    'series_edit',
    was !== now ? [{ field: 'repeat', from: was, to: now }] : undefined,
    o.id,
  );
  if (s.state === 'active') {
    const facts = await seriesTaskFacts(tx, s.id, o.today);
    await setSeriesFacts(tx, s.id, { nextDate: seriesNext(after, facts, o.today) });
  }
}

const fieldErrors =
  'Неверные данные; категория, контрагент или исполнитель не найдены, отключены, в архиве или заблокированы';

export const createTaskRoute = createRoute({
  method: 'post',
  path: '/tasks',
  tags: ['tasks'],
  summary: 'Поставить задачу',
  middleware: [requirePermission('tasksCreate')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateTaskRequest } } },
  },
  responses: {
    201: {
      description: 'Задача поставлена: «К выполнению», постановщик — тот, кто ставит',
      content: { 'application/json': { schema: Task } },
    },
    400: { description: fieldErrors, content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Ставить задачи» или задачи выключены', content: error },
  },
});

/**
 * «Новая задача» (ТЗ «Ручные задачи»; прототип `taskDlg`): ставят старшие с правом «Ставить задачи»;
 * постановщик — сотрудник из сеанса (не из тела запроса, проверяет и база).
 */
export function createTaskHandler(deps: ApiDeps): RouteHandler<typeof createTaskRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await serverTexts(deps);
    let queued: string[] = [];
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const { features } = await orgMenuSettings(tx, orgContextOf(c).orgId);
      const fields = await fieldsOf(tx, subject, body, settings.files, null, features);
      // С повтором (доработки 28.11.2026, блок 2): серия и первая задача — одной транзакцией; первая —
      // на ближайшую дату по правилу не раньше сегодня; в сообщении — строка «Повтор: <правило>».
      let id: string;
      let series: SeriesRecord | null = null;
      if (body.repeat) {
        const rule = checkedRule(body.repeat, fields.dueDate, fields.term);
        const first = firstDateOf(rule, fields.dueDate, fields.term, today);
        const made = await startSeries(tx, {
          fields,
          rule,
          start: fields.dueDate,
          authorEmployeeId: subject.employeeId,
          today,
          first,
        });
        id = made.taskId;
        series = made.series;
      } else {
        id = await createTask(tx, fields, subject.employeeId);
      }
      const task = (await getTask(tx, id, undefined))!;
      queued = await queueTelegramEvents(deps, tx, [
        series
          ? await nextTaskEvent(deps, tx, task, series, { by: subject.employeeId })
          : await newTaskEvent(deps, tx, task, subject.employeeId, t),
      ]);
      return taskOut(tx, task, { today, filesOn: settings.files, subject });
    });
    await flushEvents(deps, orgContextOf(c).orgId, queued);
    return c.json(out, 201);
  };
}

export const updateTaskRoute = createRoute({
  method: 'patch',
  path: '/tasks/{id}',
  tags: ['tasks'],
  summary: 'Изменить задачу',
  middleware: [requireEmployee] as const,
  request: {
    params: z.object({ id: Uuid }),
    body: { required: true, content: { 'application/json': { schema: UpdateTaskRequest } } },
  },
  responses: {
    200: {
      description:
        'Задача сохранена; изменения — в истории «было → стало»; снятое подтверждение у ждущей — сразу «Выполнена»',
      content: { 'application/json': { schema: Task } },
    },
    400: { description: fieldErrors, content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Изменить может только постановщик или владелец; задачи выключены',
      content: error,
    },
    ...versionedSaveResponses,
    404: { description: 'Нет такой задачи или сотрудник её не видит', content: error },
    409: { description: 'Задача уже закрыта или изменена другим пользователем', content: error },
  },
});

/**
 * «Изменить» (ТЗ: «Задачу можно изменить или отменить только тому, кто её поставил, и владельцу»;
 * прототип `taskDlg`): у открытой и ждущей подтверждения задачи. Снят «Требуется подтверждение» у
 * ждущей — сразу «Выполнена», у возвращённой на доработку — «В работе» (в «Истории статусов» —
 * «подтверждение не требуется»).
 */
export function updateTaskHandler(deps: ApiDeps): RouteHandler<typeof updateTaskRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...body } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await serverTexts(deps);
    let queued: string[] = [];
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const visible = await getTask(tx, id, taskAccessOf(subject));
      const lock = visible && (await lockTask(tx, id));
      if (!visible || !lock) taskNotFound();
      const refusal = taskActionRefusal('edit', factsOf(lock), actorOf(subject));
      if (refusal) refuse(refusal);
      const { features } = await orgMenuSettings(tx, orgContextOf(c).orgId);
      const fields = await fieldsOf(
        tx,
        subject,
        body,
        settings.files,
        { lock, categoryCode: visible.category.code },
        features,
      );
      const series = visible.seriesId ? await lockSeries(tx, visible.seriesId) : null;
      const plan = await seriesPlanOfEdit(tx, subject, lock, series, body, fields, today);
      const to = taskStatusAfterEdit(lock.status, lock.confirm, fields.confirm);
      await updateTask(
        tx,
        id,
        version,
        fields,
        to ? { from: lock.status, to, reason: t('task.hist.confirm_off') } : null,
        lock.contractorId,
      );
      if (plan) await applySeriesEdit(tx, plan, { id, fields, today, subject });
      const task = (await getTask(tx, id, undefined))!;
      // Задачу передали другому исполнителю — для него это новая задача.
      if (task.executor.id !== visible.executor.id) {
        queued = await queueTelegramEvents(deps, tx, [
          await newTaskEvent(deps, tx, task, subject.employeeId, t),
        ]);
      }
      return taskOut(tx, task, { today, filesOn: settings.files, subject });
    });
    await flushEvents(deps, orgContextOf(c).orgId, queued);
    return c.json(out, 200);
  };
}
