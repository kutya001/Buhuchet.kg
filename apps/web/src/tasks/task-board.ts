import {
  taskActionRefusal,
  taskOpen,
  taskPending,
  type TaskAction,
  type TaskActor,
  type TaskFacts,
  type TaskRefusal,
  type UiTextKey,
} from '@buhuchet/domain';
import type { Task, UpdateTaskRequest } from '@buhuchet/shared';
import type { BoardValue, GridKanban } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/**
 * Доска задач (прототип modules/tasks.js, `taskKanban`): столбцы — статус (по умолчанию), исполнитель,
 * контрагент, категория, проект, постановщик, вид срока (отчётов в «Задачах» нет — решение заказчика
 * 17.11.2026). Перенос карточки в другой
 * столбец делает то же, что действие в меню: те же права и те же окна (файл, причина, подтверждение).
 */
export const TASK_BOARD_BY = ['status', 'exec', 'cp', 'cat', 'proj', 'by', 'term'];

/** Порядок столбцов по статусу (прототип `order.status`). */
export const TASK_BOARD_STATUS_ORDER = [
  'todo',
  'in_progress',
  'rework',
  'on_confirm',
  'done',
  'confirmed',
  'failed',
  'cancelled',
];

/** Столбцы статусов, которые видны и пустыми (прототип `show.status`). */
const TASK_BOARD_STATUS_SHOWN = ['todo', 'in_progress', 'on_confirm', 'done'] as const;

/**
 * Доска списка задач: `executors` — действующие сотрудники, столбцы «Столбцы: Исполнитель», видные и
 * без задач (только тому, кто видит задачи всех); `drop` — перенос карточки, нет — доска для просмотра.
 */
export function taskKanban<Row>(
  t: Translate,
  executors: readonly { id: string; shortName: string }[],
  drop: ((row: Row, key: string, to: BoardValue) => void) | undefined,
): GridKanban<Row> {
  return {
    by: TASK_BOARD_BY,
    def: 'status',
    order: { status: TASK_BOARD_STATUS_ORDER },
    show: {
      status: TASK_BOARD_STATUS_SHOWN.map((s) => ({ key: s, label: t(`status.task.${s}`) })),
      exec: executors.map((e) => ({ key: e.id, label: e.shortName })),
    },
    ...(drop ? { drop } : {}),
  };
}

/** Что делает перенос ручной задачи: действие меню, смена исполнителя или отказ с причиной. */
export type TaskMove =
  | { kind: 'action'; action: Exclude<TaskAction, 'edit'> }
  | { kind: 'executor'; employeeId: string }
  | { kind: 'refusal'; code: TaskRefusal }
  | { kind: 'text'; key: UiTextKey };

/**
 * Перенос ручной задачи в столбец `to` доски по столбцу списка `key` (прототип `taskKanban.drop`).
 * По статусу: «В работе» — взять в работу («К выполнению»); «Выполнена», «На подтверждении» и
 * «Подтверждена» у открытой — «Выполнена»; «Подтверждена» и «На доработке» у ждущей подтверждения —
 * «Подтвердить» и «На доработку»; «Не выполнена» и «Отменена» у открытой — то же действие меню. По
 * исполнителю — смена исполнителя открытой задачи постановщиком или владельцем. Остальное — отказ.
 */
export function manualTaskMove(
  task: TaskFacts,
  actor: TaskActor,
  key: string,
  to: string,
  /** Действующие сотрудники (столбцы вида «по исполнителю»), если список известен. */
  active?: readonly string[],
): TaskMove {
  const open = taskOpen(task.status);
  const pending = taskPending(task.status);
  if (key === 'status') {
    const act = (action: Exclude<TaskAction, 'edit'>): TaskMove => {
      const code = taskActionRefusal(action, task, actor);
      return code ? { kind: 'refusal', code } : { kind: 'action', action };
    };
    if (to === 'in_progress' && task.status === 'todo') return act('start');
    if ((to === 'done' || to === 'on_confirm' || (to === 'confirmed' && !pending)) && open)
      return act('done');
    if (to === 'confirmed' && pending) return act('confirm');
    if (to === 'rework' && pending) return act('rework');
    if (to === 'failed' && open) return act('fail');
    if (to === 'cancelled' && open) return act('cancel');
    return { kind: 'text', key: 'task.board.no_move' };
  }
  if (key === 'exec') {
    // Столбец «(Пусто)» или бывшего сотрудника — не сотрудник (прототип `empByName`).
    if (!to || (active && !active.includes(to)))
      return { kind: 'text', key: 'task.board.pick_employee' };
    // Как в прототипе: сначала «может постановщик или владелец», потом «только у открытой задачи».
    const code = taskActionRefusal('edit', { ...task, status: 'todo' }, actor);
    if (code) return { kind: 'refusal', code };
    if (!open) return { kind: 'text', key: 'task.board.exec_open' };
    return { kind: 'executor', employeeId: to };
  }
  return { kind: 'text', key: 'task.board.only' };
}

/**
 * Тело запроса «Изменить задачу» со сменой только исполнителя: остальные поля — как у задачи («На
 * месяц» — первый день месяца, срок ставит сервер).
 */
export function executorChangeBody(task: Task, executorEmployeeId: string): UpdateTaskRequest {
  return {
    title: task.title,
    description: task.description,
    categoryCode: task.category.code,
    contractorId: task.contractor?.id ?? null,
    executorEmployeeId,
    term: task.term,
    dueDate: task.term === 'month' ? `${task.dueDate.slice(0, 7)}-01` : task.dueDate,
    needFile: task.needFile,
    confirm: task.confirm,
    projectId: task.project?.id ?? null,
    version: task.version,
    // Задача серии: перенос меняет только эту задачу (прототип `taskKanban` — `taskApply` без `tsAsk`).
    scope: 'one',
  };
}
