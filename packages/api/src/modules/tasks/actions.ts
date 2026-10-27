import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  addTaskComment,
  changeTaskStatus,
  getTask,
  lockTask,
  taskReadyFiles,
  withOrgContext,
  type TaskLock,
  type TaskRecord,
  type TaskStatusChange,
  type TaskStatusPatch,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  rollbackRefusal,
  ROLLBACK_REASON_MAX,
  taskActionRefusal,
  taskDoneStatus,
  taskRollbackClears,
  taskRollbackTarget,
  type AccessSubject,
  type TaskAction,
  type TaskStatus,
} from '@buhuchet/domain';
import {
  StatusRollback,
  Task,
  TaskCommentRequest,
  TaskConfirmRequest,
  TaskDoneRequest,
  TaskFailRequest,
  TaskReworkRequest,
  Uuid,
  type Task as TaskBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireEmployee } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { taskOut } from './card';
import {
  actorOf,
  error,
  factsOf,
  refuse,
  requireTasks,
  subjectOf,
  taskAccessOf,
  taskNotFound,
  todayOf,
} from './common';

/*
 * Действия со статусом ручной задачи (ТЗ «Выполнение», «Подтверждение выполнения»; прототип
 * modules/tasks.js `taskActions`, `taskDoneDlg`, `taskConfDlg`, `taskReworkDlg`, `taskFailDlg`,
 * ui/status-scale.js `rollbackDlg`). Можно ли действие — правила @buhuchet/domain (те же, что у кнопок
 * экрана); строка задачи блокируется до конца транзакции, поэтому версия в теле не нужна: два
 * одновременных «Подтвердить» не пройдут оба — второе увидит уже другой статус.
 */

/** Что знает действие: задача глазами сотрудника, заблокированная строка, тексты словаря. */
interface ActionContext {
  tx: Tx;
  subject: AccessSubject;
  task: TaskRecord;
  lock: TaskLock;
  filesOn: boolean;
  now: Date;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** Действие: что поменять (статус и поля) или null — сделано своим путём (комментарий). */
type Act<B> = (
  ctx: ActionContext,
  body: B,
) => Promise<{ change: TaskStatusChange; patch?: TaskStatusPatch } | null>;

const actionErrors = {
  400: { description: 'Неверные данные: нет причины, файла и т. п.', content: error },
  401: { description: 'Нет входа', content: error },
  403: {
    description:
      'Действие не по правам (исполнитель, постановщик, «Подтверждать задачи», «Откат статусов») или задачи выключены',
    content: error,
  },
  404: { description: 'Нет такой задачи или сотрудник её не видит', content: error },
  409: { description: 'Задача уже в другом статусе', content: error },
};

const taskOk = (description: string) => ({
  description,
  content: { 'application/json': { schema: Task } },
});

const idParam = z.object({ id: Uuid });

const jsonBody = <S>(schema: S) => ({
  required: true,
  content: { 'application/json': { schema } },
});

/**
 * Общий ход действия: модуль включён, задача видна и заблокирована; ответ — карточка после действия.
 */
async function runAction<B>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
  body: B,
  act: Act<B>,
): Promise<TaskBody> {
  const subject = subjectOf(c);
  const today = todayOf(deps);
  const texts = await serverTexts(deps);
  const t = (key: string, params?: Record<string, string | number>) =>
    formatText(texts(key), params);
  return withOrgContext(deps.db, orgContextOf(c), async (tx) => {
    const settings = await requireTasks(tx, orgContextOf(c).orgId);
    const task = await getTask(tx, id, taskAccessOf(subject));
    const lock = task && (await lockTask(tx, id));
    if (!task || !lock) taskNotFound();
    const ctx = { tx, subject, task, lock, filesOn: settings.files, now: deps.clock.now(), t };
    const result = await act(ctx, body);
    if (result) await changeTaskStatus(tx, id, result.change, result.patch);
    return taskOut(tx, (await getTask(tx, id, undefined))!, { today, filesOn: settings.files });
  });
}

/** Действие по правилам домена: недоступно — тот же отказ, что у пункта меню. */
function allowed(ctx: ActionContext, action: TaskAction): void {
  const refusal = taskActionRefusal(action, factsOf(ctx.lock), actorOf(ctx.subject));
  if (refusal) refuse(refusal);
}

const change = (ctx: ActionContext, to: TaskStatus, extra: Partial<TaskStatusChange> = {}) => ({
  from: ctx.lock.status,
  to,
  ...extra,
});

/** «Взять в работу»: исполнитель или постановщик (прототип `taskActions`, `stepTo`). */
const start: Act<null> = async (ctx) => {
  allowed(ctx, 'start');
  return { change: change(ctx, 'in_progress') };
};

/**
 * «Выполнена» (ТЗ «Выполнение»; прототип `taskDoneDlg`): только исполнитель. «Требуется файл» — без
 * загруженного файла задачи не закрыть (файл прикрепляют блоком «Файлы» по правам Файлового
 * менеджера; без «Файлов в карточках» требования нет — docs/deviations.md п. Б-1). Файл попадает в
 * «Историю статусов».
 */
const done: Act<z.infer<typeof TaskDoneRequest>> = async (ctx, body) => {
  allowed(ctx, 'done');
  // ОТКЛОНЕНИЕ: docs/deviations.md#Б-1
  const required = ctx.lock.needFile && ctx.filesOn;
  if (required && !body.fileId) {
    apiFail(400, 'task_file_required', 'Прикрепите файл', { field: 'fileId' });
  }
  if (body.fileId) {
    const ready = await taskReadyFiles(ctx.tx, ctx.lock.id);
    if (!ready.some((f) => f.id === body.fileId)) {
      apiFail(400, 'task_file_not_found', 'Файл не прикреплён к этой задаче', { field: 'fileId' });
    }
  }
  return {
    change: change(ctx, taskDoneStatus(ctx.lock.confirm), { fileId: body.fileId }),
    patch: { doneAt: ctx.now, reworkReason: '' },
  };
};

/** «Не выполнена»: только исполнитель, причина обязательна (прототип `taskFailDlg`). */
const fail: Act<z.infer<typeof TaskFailRequest>> = async (ctx, body) => {
  allowed(ctx, 'fail');
  return {
    change: change(ctx, 'failed', { reason: body.reason }),
    patch: { failReason: body.reason },
  };
};

/**
 * «Подтвердить» (ТЗ «Кто подтверждает»; прототип `taskConfDlg`): постановщик или сотрудник с правом
 * «Подтверждать задачи», не исполнитель. Подтвердил не постановщик — в «Истории статусов» «вместо
 * постановщика <имя>» (ТЗ: «это будет видно в истории»).
 */
const confirm: Act<z.infer<typeof TaskConfirmRequest>> = async (ctx, body) => {
  allowed(ctx, 'confirm');
  const instead =
    ctx.lock.authorEmployeeId !== ctx.subject.employeeId
      ? ctx.t('task.hist.instead', { name: ctx.task.author.shortName })
      : '';
  const reason = [instead, body.comment].filter(Boolean).join(', ').slice(0, ROLLBACK_REASON_MAX);
  return {
    change: change(ctx, 'confirmed', { reason: reason || null }),
    patch: {
      confirmedByEmployeeId: ctx.subject.employeeId,
      confirmedAt: ctx.now,
      confirmNote: body.comment,
    },
  };
};

/** «На доработку»: кто подтверждает, причина обязательна; исполнитель видит её в карточке. */
const rework: Act<z.infer<typeof TaskReworkRequest>> = async (ctx, body) => {
  allowed(ctx, 'rework');
  return {
    change: change(ctx, 'rework', { reason: body.reason }),
    patch: { reworkReason: body.reason, reworkByEmployeeId: ctx.subject.employeeId },
  };
};

/** «Отменить задачу»: постановщик или владелец, у открытой задачи (ТЗ «Выполнение»). */
const cancel: Act<null> = async (ctx) => {
  allowed(ctx, 'cancel');
  return { change: change(ctx, 'cancelled') };
};

/**
 * Откат на шаг (ТЗ «Откат «Подтверждена» → «На подтверждении» и «На подтверждении» → «В работе» — по
 * общим правилам отката»; прототип `rollbackDlg`): право «Откат статусов» и причина. Уходя из
 * «Выполнена» и «На подтверждении», задача теряет дату выполнения, из «Подтверждена» — подтверждение;
 * приложенный файл остаётся.
 */
const rollback: Act<z.infer<typeof StatusRollback>> = async (ctx, body) => {
  const back = taskRollbackTarget(ctx.lock.status);
  const refusal = rollbackRefusal({
    canRollback: actorOf(ctx.subject).canRollback,
    back,
    to: body.to,
    reason: body.reason,
  });
  if (refusal === 'no_right') apiFail(403, 'task_rollback_right', 'Нужно право «Откат статусов»');
  if (refusal === 'not_back_step') {
    apiFail(409, 'task_not_back_step', 'Откатить можно только на один шаг назад');
  }
  if (refusal) apiFail(400, 'validation_failed', 'Укажите причину', { field: 'reason' });
  const to = back as TaskStatus;
  const clears = taskRollbackClears(ctx.lock.status, to);
  return {
    change: change(ctx, to, { reason: body.reason, rollback: true }),
    patch: {
      ...(clears.done ? { doneAt: null } : {}),
      ...(clears.confirmation
        ? { confirmedByEmployeeId: null, confirmedAt: null, confirmNote: '' }
        : {}),
    },
  };
};

/** Комментарий (прототип `openTask`): пишет любой, кто видит задачу, от своего имени. */
const comment: Act<z.infer<typeof TaskCommentRequest>> = async (ctx, body) => {
  await addTaskComment(ctx.tx, ctx.lock.id, body.text);
  return null;
};

export const startTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/start',
  tags: ['tasks'],
  summary: 'Взять задачу в работу',
  middleware: [requireEmployee] as const,
  request: { params: idParam },
  responses: { 200: taskOk('Задача «В работе»'), ...actionErrors },
});

export function startTaskHandler(deps: ApiDeps): RouteHandler<typeof startTaskRoute, AppEnv> {
  return async (c) => c.json(await runAction(deps, c, c.req.valid('param').id, null, start), 200);
}

export const doneTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/done',
  tags: ['tasks'],
  summary: 'Отметить задачу выполненной',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(TaskDoneRequest) },
  responses: {
    200: taskOk('С подтверждением — «На подтверждении», без — «Выполнена»'),
    ...actionErrors,
  },
});

export function doneTaskHandler(deps: ApiDeps): RouteHandler<typeof doneTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), done), 200);
}

export const failTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/fail',
  tags: ['tasks'],
  summary: 'Отметить задачу невыполненной',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(TaskFailRequest) },
  responses: { 200: taskOk('Задача «Не выполнена» с причиной'), ...actionErrors },
});

export function failTaskHandler(deps: ApiDeps): RouteHandler<typeof failTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), fail), 200);
}

export const confirmTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/confirm',
  tags: ['tasks'],
  summary: 'Подтвердить выполнение задачи',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(TaskConfirmRequest) },
  responses: { 200: taskOk('Задача «Подтверждена»'), ...actionErrors },
});

export function confirmTaskHandler(deps: ApiDeps): RouteHandler<typeof confirmTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), confirm), 200);
}

export const reworkTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/rework',
  tags: ['tasks'],
  summary: 'Вернуть задачу на доработку',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(TaskReworkRequest) },
  responses: { 200: taskOk('Задача «На доработке» с причиной'), ...actionErrors },
});

export function reworkTaskHandler(deps: ApiDeps): RouteHandler<typeof reworkTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), rework), 200);
}

export const cancelTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/cancel',
  tags: ['tasks'],
  summary: 'Отменить задачу',
  middleware: [requireEmployee] as const,
  request: { params: idParam },
  responses: { 200: taskOk('Задача «Отменена»'), ...actionErrors },
});

export function cancelTaskHandler(deps: ApiDeps): RouteHandler<typeof cancelTaskRoute, AppEnv> {
  return async (c) => c.json(await runAction(deps, c, c.req.valid('param').id, null, cancel), 200);
}

export const rollbackTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/rollback',
  tags: ['tasks'],
  summary: 'Откатить статус задачи на шаг назад',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(StatusRollback) },
  responses: {
    200: taskOk('Статус откачен; в «Истории статусов» — с пометкой «Откат» и причиной'),
    ...actionErrors,
  },
});

export function rollbackTaskHandler(deps: ApiDeps): RouteHandler<typeof rollbackTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), rollback), 200);
}

export const commentTaskRoute = createRoute({
  method: 'post',
  path: '/tasks/{id}/comments',
  tags: ['tasks'],
  summary: 'Написать комментарий к задаче',
  middleware: [requireEmployee] as const,
  request: { params: idParam, body: jsonBody(TaskCommentRequest) },
  responses: { 201: taskOk('Комментарий добавлен'), ...actionErrors },
});

export function commentTaskHandler(deps: ApiDeps): RouteHandler<typeof commentTaskRoute, AppEnv> {
  return async (c) =>
    c.json(await runAction(deps, c, c.req.valid('param').id, c.req.valid('json'), comment), 201);
}
