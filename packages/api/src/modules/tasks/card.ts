import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorTasks,
  getTask,
  listTaskCategories,
  listTaskComments,
  readStatusHistory,
  taskContractorOf,
  taskFormOptions,
  taskHistory,
  withOrgContext,
  type TaskRecord,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  hasPermission,
  type AccessSubject,
  type IsoDate,
} from '@buhuchet/domain';
import {
  ContractorTasks,
  Task,
  TaskFormOptions,
  Uuid,
  type Task as TaskBody,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import {
  cpScopeOf,
  error,
  requireTasks,
  rowBody,
  subjectOf,
  taskAccessOf,
  taskNotFound,
  todayOf,
} from './common';

const off = 'Задачи выключены в учётной политике';

/**
 * Видит ли сотрудник файлы задачи (как модуль файлов, `canView`): «Файлы в карточках», право
 * «Просматривать файлы» и область группы «Файловый менеджер» по контрагенту задачи.
 */
function taskFilesVisible(subject: AccessSubject, r: TaskRecord, filesOn: boolean): boolean {
  if (!filesOn || !hasPermission(subject, 'filesView')) return false;
  return !r.contractor || canSeeContractor(subject, 'files', r.contractor);
}

/**
 * Карточка для ответа API: строка, описание, причины, комментарии, «История статусов» и история.
 * Имя файла результата в «Истории статусов» — только тому, кто видит файлы задачи.
 */
export async function taskOut(
  tx: Tx,
  r: TaskRecord,
  options: { today: IsoDate; filesOn: boolean; subject: AccessSubject },
): Promise<TaskBody> {
  const [comments, statuses, history] = await Promise.all([
    listTaskComments(tx, r.id),
    readStatusHistory(tx, 'task', r.id),
    taskHistory(tx, r.id),
  ]);
  const filesVisible = taskFilesVisible(options.subject, r, options.filesOn);
  return {
    ...rowBody(r, options.today),
    description: r.description,
    executorFullName: r.executorFullName,
    executorActive: r.executorActive,
    categoryActive: r.categoryActive,
    failReason: r.failReason,
    reworkReason: r.reworkReason,
    reworkBy: r.reworkBy,
    confirmedByFullName: r.confirmedByFullName,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    confirmNote: r.confirmNote,
    filesOn: options.filesOn,
    comments: comments.map((x) => ({ ...x, at: x.at.toISOString() })),
    statusHistory: statuses.map((h) => ({
      ...h,
      at: h.at.toISOString(),
      file: filesVisible ? h.file : null,
    })),
    history: history.map((h) => ({ ...h, at: h.at.toISOString() })),
  };
}

export const getTaskRoute = createRoute({
  method: 'get',
  path: '/tasks/{id}',
  tags: ['tasks'],
  summary: 'Карточка задачи',
  middleware: [requireEmployee] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Задача с комментариями, «Историей статусов» и историей изменений',
      content: { 'application/json': { schema: Task } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: off, content: error },
    404: {
      description:
        'Нет такой задачи или сотрудник её не видит (не своя, нет права «Видеть задачи всех» и контрагент вне области)',
      content: error,
    },
  },
});

/**
 * Карточка задачи (прототип `openTask`): своя, видимая по правам или по видимому контрагенту
 * (вкладка «Задачи» карточки контрагента); иначе — «не найдена», как чужой организации.
 */
export function getTaskHandler(deps: ApiDeps): RouteHandler<typeof getTaskRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const r = await getTask(tx, id, taskAccessOf(subject));
      if (!r) taskNotFound();
      return taskOut(tx, r, { today, filesOn: settings.files, subject });
    });
    return c.json(body, 200);
  };
}

export const taskFormOptionsRoute = createRoute({
  method: 'get',
  path: '/tasks/form-options',
  tags: ['tasks'],
  summary: 'Значения для формы задачи',
  middleware: [requirePermission('tasksCreate')] as const,
  responses: {
    200: {
      description:
        'Действующие категории и исполнители, контрагенты в области без архивных, «Требуется подтверждение» по учётной политике',
      content: { 'application/json': { schema: TaskFormOptions } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: `Нет права «Ставить задачи» или ${off.toLowerCase()}`, content: error },
  },
});

/** Значения полей формы «Новая задача» и «Изменить задачу» (прототип `taskDlg`). */
export function taskFormOptionsHandler(
  deps: ApiDeps,
): RouteHandler<typeof taskFormOptionsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await requireTasks(tx, orgContextOf(c).orgId);
      const [categories, options] = await Promise.all([
        listTaskCategories(tx),
        taskFormOptions(tx, cpScopeOf(subject)),
      ]);
      return {
        categories: categories.map(({ code, name }) => ({ code, name })),
        ...options,
        confirmDefault: settings.confirmDefault,
        filesOn: settings.files,
      };
    });
    return c.json(body, 200);
  };
}

export const contractorTasksRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/tasks',
  tags: ['tasks'],
  summary: 'Вкладка «Задачи» карточки контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: '«Задач: N · открытых M» и последние 40 задач контрагента',
      content: { 'application/json': { schema: ContractorTasks } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: `Нет права «Просматривать контрагентов» или ${off.toLowerCase()}`,
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Вкладка «Задачи» карточки контрагента (ТЗ «Карточка контрагента»; прототип contractor-card.js): все
 * задачи контрагента тому, кто видит контрагента. Экран подключает задача 2.11.
 */
export function contractorTasksHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorTasksRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await requireTasks(tx, orgContextOf(c).orgId);
      if (!(await taskContractorOf(tx, id, cpScopeOf(subject)))) {
        apiFail(404, 'contractor_not_found', 'Контрагент не найден');
      }
      const tab = await contractorTasks(tx, id);
      return { ...tab, items: tab.items.map((r) => rowBody(r, today)) };
    });
    return c.json(body, 200);
  };
}
