import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  createTask,
  employeeActive,
  getTask,
  lockTask,
  taskCategoryActive,
  taskContractorOf,
  updateTask,
  withOrgContext,
  type TaskFields,
  type TaskLock,
  type Tx,
} from '@buhuchet/db';
import {
  monthLastDay,
  taskActionRefusal,
  taskConfirmEditable,
  taskStatusAfterEdit,
  type AccessSubject,
} from '@buhuchet/domain';
import { CreateTaskRequest, Task, UpdateTaskRequest, Uuid } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { taskOut } from './card';
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

type Body = z.infer<typeof CreateTaskRequest>;

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
    executorEmployeeId: body.executorEmployeeId,
    term: body.term,
    dueDate: body.term === 'month' ? monthLastDay(body.dueDate.slice(0, 7)) : body.dueDate,
    // ОТКЛОНЕНИЕ: docs/deviations.md#Б-1
    needFile: filesOn ? body.needFile : (before?.lock.needFile ?? false),
    confirm: confirmLocked ? before.lock.confirm : body.confirm,
  };
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
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const fields = await fieldsOf(tx, subject, body, settings.files, null);
      const id = await createTask(tx, fields, subject.employeeId);
      return taskOut(tx, (await getTask(tx, id, undefined))!, {
        today,
        filesOn: settings.files,
        subject,
      });
    });
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
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const visible = await getTask(tx, id, taskAccessOf(subject));
      const lock = visible && (await lockTask(tx, id));
      if (!visible || !lock) taskNotFound();
      const refusal = taskActionRefusal('edit', factsOf(lock), actorOf(subject));
      if (refusal) refuse(refusal);
      const fields = await fieldsOf(tx, subject, body, settings.files, {
        lock,
        categoryCode: visible.category.code,
      });
      const to = taskStatusAfterEdit(lock.status, lock.confirm, fields.confirm);
      await updateTask(
        tx,
        id,
        version,
        fields,
        to ? { from: lock.status, to, reason: t('task.hist.confirm_off') } : null,
        lock.contractorId,
      );
      return taskOut(tx, (await getTask(tx, id, undefined))!, {
        today,
        filesOn: settings.files,
        subject,
      });
    });
    return c.json(out, 200);
  };
}
