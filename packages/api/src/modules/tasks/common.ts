import {
  contractorScope,
  taskContractorAccess,
  taskOrgSettings,
  taskVisibility,
  type TaskRecord,
  type TaskRow,
  type TaskViewer,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  hasPermission,
  scopeOf,
  TASK_MESSAGES,
  taskOverdue,
  type AccessSubject,
  type IsoDate,
  type TaskActor,
  type TaskFacts,
  type TaskRefusal,
} from '@buhuchet/domain';
import { ApiError, type TaskRow as TaskRowBody } from '@buhuchet/shared';
import { or, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';

export const error = { 'application/json': { schema: ApiError } };

/** Сегодня по Бишкеку — от часов приложения (`clock`): так срок и просрочка проверяются тестом. */
export const todayOf = (deps: ApiDeps): IsoDate => bishkekDate(deps.clock.now());

/** Сотрудник, который действует (общий слой уже проверил, что это сотрудник организации). */
export function subjectOf(c: Context<AppEnv>): AccessSubject {
  return c.get('access')!.subject;
}

/** Кто смотрит список: «Видеть задачи всех» и «Подтверждать задачи». */
export function viewerOf(subject: AccessSubject): TaskViewer {
  return {
    employeeId: subject.employeeId,
    all: hasPermission(subject, 'tasksAll'),
    canConfirm: hasPermission(subject, 'tasksConfirm'),
  };
}

/** Кто действует с задачей — для правил @buhuchet/domain. */
export function actorOf(subject: AccessSubject): TaskActor {
  return {
    employeeId: subject.employeeId,
    isOwner: subject.isOwner,
    canConfirm: hasPermission(subject, 'tasksConfirm'),
    canRollback: hasPermission(subject, 'rollback'),
  };
}

/** Область «Свои контрагенты» группы «Контрагенты»: условие для запросов. */
export function cpScopeOf(subject: AccessSubject): SQL | undefined {
  return contractorScope(scopeOf(subject, 'cps') === 'own' ? subject.employeeId : null);
}

/**
 * Какие задачи сотрудник может открыть: свои и видимые по правам (`taskVisibility`) и — кто видит
 * контрагента — все задачи этого контрагента (вкладка «Задачи» карточки контрагента, прототип:
 * `allTasks().filter(t => t.cp === c.id)`). undefined — все задачи организации.
 */
export function taskAccessOf(subject: AccessSubject): SQL | undefined {
  const visible = taskVisibility(viewerOf(subject));
  if (!visible) return undefined;
  if (!hasPermission(subject, 'cpView')) return visible;
  return or(visible, taskContractorAccess(cpScopeOf(subject)));
}

/**
 * Модуль «Задачи» выключен в учётной политике — 403 `tasks_off`: метод проверяет функцию на сервере,
 * а не только прячет меню. Ответ — настройки задач организации.
 */
export async function requireTasks(tx: Tx, orgId: string) {
  const settings = await taskOrgSettings(tx, orgId);
  if (!settings.tasks) apiFail(403, 'tasks_off', 'Задачи выключены в учётной политике');
  return settings;
}

export function taskNotFound(): never {
  apiFail(404, 'task_not_found', 'Задача не найдена');
}

/** Отказы по состоянию задачи — 409, по тому, кто действует, — 403. */
const STATE_REFUSALS: readonly TaskRefusal[] = ['task_closed', 'task_not_pending'];

/** Действие недоступно по правилам @buhuchet/domain: тот же текст, что у подсказки пункта меню. */
export function refuse(code: TaskRefusal): never {
  apiFail(STATE_REFUSALS.includes(code) ? 409 : 403, code, TASK_MESSAGES[code]);
}

export function factsOf(t: {
  status: TaskFacts['status'];
  confirm: boolean;
  executorEmployeeId: string;
  authorEmployeeId: string;
}): TaskFacts {
  return {
    status: t.status,
    confirm: t.confirm,
    executorId: t.executorEmployeeId,
    authorId: t.authorEmployeeId,
  };
}

/** Строка списка для ответа API: моменты — строкой ISO, просрочка — на сегодня по Бишкеку. */
export function rowBody(r: TaskRow | TaskRecord, today: IsoDate): TaskRowBody {
  return {
    id: r.id,
    title: r.title,
    category: r.category,
    contractor: r.contractor ? { id: r.contractor.id, name: r.contractor.name } : null,
    executor: r.executor,
    author: r.author,
    term: r.term,
    dueDate: r.dueDate,
    needFile: r.needFile,
    confirm: r.confirm,
    status: r.status,
    overdue: taskOverdue(r, today),
    doneAt: r.doneAt?.toISOString() ?? null,
    hasFile: r.hasFile,
    confirmedBy: r.confirmedBy,
    lastStatus: r.lastStatus ? { at: r.lastStatus.at.toISOString(), by: r.lastStatus.by } : null,
    audit: {
      createdAt: r.audit.createdAt.toISOString(),
      createdBy: r.audit.createdBy,
      updatedAt: r.audit.updatedAt.toISOString(),
      updatedBy: r.audit.updatedBy,
    },
    version: r.version,
  };
}
