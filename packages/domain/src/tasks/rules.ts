/**
 * Задачи (ТЗ «Задачи»: «Срок задачи», «Ручные задачи», «Выполнение», «Подтверждение выполнения»;
 * прототип modules/tasks.js: `taskOpen`, `taskPend`, `taskConfWhy`, `taskOver`, `taskActions`,
 * `taskDlg`, `taskDoneDlg`, `taskConfDlg`, `taskReworkDlg`, `taskFailDlg`). Здесь — ручные задачи:
 * кто что может с задачей, куда она переходит и когда она просрочена. Регулярные задачи по отчётам —
 * задача 2.24: своего статуса у них нет. Одни и те же правила у кнопок экрана и у сервера.
 */
import type { IsoDate } from '../common/dates';
import { ROLLBACK_REASON_MAX, scaleBack } from '../common/status';

/**
 * Статусы ручной задачи — шкала `task` (`STATUS_SCALE_DEFS`, тот же порядок — проверяет тест): шаги,
 * «На доработке» и конечные.
 */
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'rework',
  'on_confirm',
  'confirmed',
  'done',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Вид срока: «На день» — дата, «На месяц» — до последнего дня месяца (ТЗ «Срок задачи»). */
export const TASK_TERMS = ['day', 'month'] as const;
export type TaskTerm = (typeof TASK_TERMS)[number];

/** Вид задачи: «Общая» — без контрагента, «По контрагенту» (ТЗ «Ручные задачи»). */
export const TASK_SCOPES = ['general', 'contractor'] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

/** Пределы полей: в прототипе их нет, а без них одна задача займёт мегабайт истории. */
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 2000;
export const TASK_COMMENT_MAX = 2000;
/** Причина «Не выполнена», «На доработку» и комментарий подтверждения — в «Истории статусов». */
export const TASK_REASON_MAX = ROLLBACK_REASON_MAX;
/**
 * Комментарий «Подтвердить»: в «Истории статусов» перед ним стоит «вместо постановщика <имя>, », а вся
 * запись — не длиннее `ROLLBACK_REASON_MAX`.
 */
export const TASK_CONFIRM_NOTE_MAX = 400;

/** Открытая задача — её ещё делают (прототип `taskOpen`: «К выполнению», «В работе», «На доработке»). */
const OPEN: readonly TaskStatus[] = ['todo', 'in_progress', 'rework'];

export function taskOpen(status: TaskStatus): boolean {
  return OPEN.includes(status);
}

/** Задача ждёт подтверждения (прототип `taskPend`). */
export function taskPending(status: TaskStatus): boolean {
  return status === 'on_confirm';
}

/**
 * Просрочена: срок прошёл, а задача открыта (прототип `taskOver`). «Выполнена» до срока и ждущая
 * подтверждения — не просрочена; возвращённая на доработку после срока — просрочена (ТЗ «Срок»).
 */
export function taskOverdue(
  task: { status: TaskStatus; dueDate: IsoDate },
  today: IsoDate,
): boolean {
  return taskOpen(task.status) && task.dueDate < today;
}

/** Последний день месяца «2026-10» → «2026-10-31» (прототип `lastDay`). */
export function monthLastDay(month: string): IsoDate {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** Первый день месяца даты: с него начинается список задач (ТЗ «Список задач начинается с текущего месяца»). */
export function monthStart(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

/** Кто действует: сотрудник, владелец ли он, его права «Подтверждать задачи» и «Откат статусов». */
export interface TaskActor {
  employeeId: string;
  isOwner: boolean;
  canConfirm: boolean;
  canRollback: boolean;
  /** Право «Ставить задачи»: ТЗ — «менять и отменять поставленные собой». */
  canCreate: boolean;
}

/** Что нужно знать о задаче для решений. */
export interface TaskFacts {
  status: TaskStatus;
  /** «Требуется подтверждение». */
  confirm: boolean;
  executorId: string;
  /** Постановщик. */
  authorId: string;
}

/**
 * Менять и отменять задачу может тот, кто её поставил, и владелец (ТЗ «Задачу можно изменить или
 * отменить только тому, кто её поставил, и владельцу»; прототип `boss`).
 */
export function taskIsBoss(task: Pick<TaskFacts, 'authorId'>, actor: TaskActor): boolean {
  return task.authorId === actor.employeeId || actor.isOwner;
}

/**
 * «Изменить» и «Отменить»: постановщик или владелец; постановщику нужно право «Ставить задачи» (ТЗ
 * «менять и отменять поставленные собой»; прототип `taskIsBoss` право не проверяет).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Б-4
function bossRefusal(boss: boolean, actor: TaskActor): TaskRefusal | null {
  if (!boss) return 'task_author_only';
  return actor.isOwner || actor.canCreate ? null : 'task_create_right';
}

/** Почему действие с задачей недоступно: ключ текста `TASK_MESSAGES`. */
export type TaskRefusal =
  | 'task_not_pending'
  | 'task_confirm_own'
  | 'task_confirm_right'
  | 'task_executor_only'
  | 'task_start_forbidden'
  | 'task_author_only'
  | 'task_create_right'
  | 'task_closed';

/** Тексты отказов — как подсказки у пунктов меню прототипа (`taskConfWhy`, `reason`). */
export const TASK_MESSAGES: Readonly<Record<TaskRefusal, string>> = {
  task_not_pending: 'Задача не ждёт подтверждения',
  task_confirm_own:
    'Свою задачу подтвердить нельзя: подтверждает постановщик или другой сотрудник с правом',
  task_confirm_right: 'Подтверждает постановщик или сотрудник с правом «Подтверждать задачи»',
  task_executor_only: 'Отметить может только исполнитель',
  task_start_forbidden: 'Менять статус может исполнитель или постановщик',
  task_author_only: 'Изменить и отменить задачу может только постановщик или владелец',
  task_create_right: 'Нужно право «Ставить задачи»',
  task_closed: 'Задача уже закрыта',
};

/**
 * Кто подтверждает (прототип `taskConfWhy`; ТЗ «Кто подтверждает»): постановщик или сотрудник с правом
 * «Подтверждать задачи»; исполнитель свою задачу — никогда, даже если сам её поставил и право есть.
 */
export function taskConfirmRefusal(task: TaskFacts, actor: TaskActor): TaskRefusal | null {
  if (!taskPending(task.status)) return 'task_not_pending';
  if (task.executorId === actor.employeeId) return 'task_confirm_own';
  if (task.authorId !== actor.employeeId && !actor.canConfirm) return 'task_confirm_right';
  return null;
}

/** Действия с ручной задачей (пункты меню и кнопки карточки прототипа `taskActions`, `openTask`). */
export const TASK_ACTIONS = [
  'start',
  'done',
  'fail',
  'confirm',
  'rework',
  'edit',
  'cancel',
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * Можно ли действие (прототип `taskActions`): «Взять в работу» — у «К выполнению», исполнитель или
 * постановщик; «Выполнена» и «Не выполнена» — у открытой, только исполнитель; «Подтвердить» и «На
 * доработку» — `taskConfirmRefusal`; «Изменить» — у открытой и ждущей подтверждения, постановщик или
 * владелец; «Отменить задачу» — у открытой, постановщик или владелец. null — можно.
 */
export function taskActionRefusal(
  action: TaskAction,
  task: TaskFacts,
  actor: TaskActor,
): TaskRefusal | null {
  const mine = task.executorId === actor.employeeId;
  const boss = taskIsBoss(task, actor);
  const open = taskOpen(task.status);
  switch (action) {
    case 'start':
      if (task.status !== 'todo') return 'task_closed';
      return mine || boss ? null : 'task_start_forbidden';
    case 'done':
    case 'fail':
      if (!open) return 'task_closed';
      return mine ? null : 'task_executor_only';
    case 'confirm':
    case 'rework':
      return taskConfirmRefusal(task, actor);
    case 'edit':
      if (!open && !taskPending(task.status)) return 'task_closed';
      return bossRefusal(boss, actor);
    case 'cancel':
      if (!open) return 'task_closed';
      return bossRefusal(boss, actor);
  }
}

/**
 * Пункты меню задачи по порядку прототипа (`taskActions`): какие показать и какие из них недоступны с
 * подсказкой. «Открыть» и «Откатить» экран добавляет сам.
 */
export function taskMenu(
  task: TaskFacts,
  actor: TaskActor,
): { action: TaskAction; refusal: TaskRefusal | null }[] {
  const boss = taskIsBoss(task, actor);
  const item = (action: TaskAction) => ({
    action,
    refusal: taskActionRefusal(action, task, actor),
  });
  if (taskPending(task.status)) {
    return [item('confirm'), item('rework'), ...(boss ? [item('edit')] : [])];
  }
  if (!taskOpen(task.status)) return [];
  return [
    ...(task.status === 'todo' ? [item('start')] : []),
    item('done'),
    item('fail'),
    ...(boss ? [item('edit'), item('cancel')] : []),
  ];
}

/** «Выполнена»: с подтверждением — «На подтверждении», без — сразу «Выполнена» (ТЗ «Подтверждение»). */
export function taskDoneStatus(confirm: boolean): TaskStatus {
  return confirm ? 'on_confirm' : 'done';
}

/**
 * Статус после «Изменить», если поменяли «Требуется подтверждение» (прототип `taskDlg`): снят у ждущей
 * подтверждения — сразу «Выполнена» (ТЗ); снят у возвращённой на доработку — «В работе». Иначе null —
 * статус не меняется.
 */
export function taskStatusAfterEdit(
  status: TaskStatus,
  confirmBefore: boolean,
  confirmAfter: boolean,
): TaskStatus | null {
  if (confirmBefore === confirmAfter || confirmAfter) return null;
  if (status === 'on_confirm') return 'done';
  if (status === 'rework') return 'in_progress';
  return null;
}

/**
 * Можно ли менять «Требуется подтверждение» (прототип `taskDlg`: у закрытой задачи переключатель
 * недоступен).
 */
export function taskConfirmEditable(status: TaskStatus): boolean {
  return taskOpen(status) || taskPending(status);
}

/** Откат на шаг назад (ТЗ «Откат «Подтверждена» → «На подтверждении» … по общим правилам отката»). */
export function taskRollbackTarget(status: TaskStatus): TaskStatus | null {
  return scaleBack('task', status) as TaskStatus | null;
}

/**
 * Что откат снимает (прототип `rollbackDlg`): дату выполнения — если задача уходит из «Выполнена» и
 * «На подтверждении»; подтверждение — если откатывают «Подтверждена». Приложенный файл остаётся.
 */
export function taskRollbackClears(
  from: TaskStatus,
  to: TaskStatus,
): { done: boolean; confirmation: boolean } {
  return { done: to !== 'done' && to !== 'on_confirm', confirmation: from === 'confirmed' };
}

/** Отметка «Подтверждение» в списке (прототип `taskConfTxt`): «Не требуется», «Подтвердил …», «Требуется». */
export type TaskConfirmMark = 'not_required' | 'confirmed' | 'required';

export function taskConfirmMark(task: {
  confirm: boolean;
  status: TaskStatus;
  confirmedBy: string | null;
}): TaskConfirmMark {
  if (!task.confirm) return 'not_required';
  return task.status === 'confirmed' && task.confirmedBy ? 'confirmed' : 'required';
}

/** Файл при выполнении (прототип: столбец «Файл» — «приложен», «нужен» или пусто). */
export type TaskFileMark = 'attached' | 'needed' | 'none';

export function taskFileMark(task: { needFile: boolean; hasFile: boolean }): TaskFileMark {
  if (!task.needFile) return 'none';
  return task.hasFile ? 'attached' : 'needed';
}
