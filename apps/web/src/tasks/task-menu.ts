import {
  scaleNext,
  taskActionRefusal,
  taskMenu,
  type TaskAction,
  type TaskActor,
  type TaskFacts,
  type UiTextKey,
} from '@buhuchet/domain';
import type { TaskRow } from '@buhuchet/shared';
import type { ActionEntry, IconName } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню задачи: открывают окно или отправляют запрос. */
export type TaskMenuRun = Record<'open' | TaskAction, (task: TaskRow) => void>;

/** Задача глазами правил: статус, подтверждение, исполнитель и постановщик. */
export const taskFacts = (task: TaskRow): TaskFacts => ({
  status: task.status,
  confirm: task.confirm,
  executorId: task.executor.id,
  authorId: task.author.id,
});

const ACTION_VIEW: Record<TaskAction, { label: UiTextKey; icon: IconName }> = {
  start: { label: 'task.action.start', icon: 'clock' },
  done: { label: 'task.action.done', icon: 'ok' },
  fail: { label: 'task.action.fail', icon: 'x' },
  confirm: { label: 'task.action.confirm', icon: 'check' },
  rework: { label: 'task.action.rework', icon: 'refresh' },
  edit: { label: 'task.action.edit', icon: 'edit' },
  cancel: { label: 'task.action.cancel', icon: 'ban' },
};

/**
 * Пункты меню задачи (прототип modules/tasks.js, `taskActions`): «Открыть»; у ждущей подтверждения —
 * «Подтвердить», «На доработку», «Изменить» (постановщику и владельцу); у открытой — «Взять в работу»
 * (у «К выполнению»), «Выполнена», «Не выполнена», «Изменить», черта и «Отменить задачу» красным.
 * Недоступный пункт виден бледным с причиной (тексты отказов — те же, что у сервера). `card` —
 * меню кнопки «Действия» в карточке: без «Открыть».
 */
export function taskMenuEntries({
  actor,
  t,
  run,
  card = false,
}: {
  actor: TaskActor;
  t: Translate;
  run: TaskMenuRun;
  card?: boolean;
}): (task: TaskRow) => ActionEntry[] {
  return (task) => {
    const open: ActionEntry[] = card
      ? []
      : [{ id: 'open', label: t('task.action.open'), icon: 'task', run: () => run.open(task) }];
    const items = taskMenu(taskFacts(task), actor).flatMap(({ action, refusal }): ActionEntry[] => {
      const view = ACTION_VIEW[action];
      const item: ActionEntry = {
        id: action,
        label: t(view.label),
        icon: view.icon,
        run: () => run[action](task),
        ...(action === 'cancel' ? { danger: true } : {}),
        ...(refusal ? { disabled: true, reason: t(`err.${refusal}`) } : {}),
      };
      return action === 'cancel' ? [{ id: 'sep', separator: true }, item] : [item];
    });
    return [...open, ...items];
  };
}

/**
 * Кнопки внизу карточки (прототип `openTask`, `foot`): «Выполнена» — исполнителю открытой задачи;
 * «На доработку» и «Подтвердить» — тому, кто может подтвердить ждущую.
 */
export function taskCardButtons(task: TaskRow, actor: TaskActor): TaskAction[] {
  const can = (a: TaskAction) => taskActionRefusal(a, taskFacts(task), actor) === null;
  return (['done', 'rework', 'confirm'] as const).filter(can);
}

/**
 * Следующие шаги шкалы, которые можно поставить нажатием (`scaleNext` с правом): «В работе» —
 * исполнителю и постановщику, «Выполнена» и «На подтверждении» — исполнителю, «Подтверждена» — тому,
 * кто может подтвердить. Шаг → действие задачи.
 */
export function taskScaleSteps(task: TaskRow, actor: TaskActor): Record<string, TaskAction> {
  const facts = taskFacts(task);
  const steps: Record<string, TaskAction> = {};
  for (const to of scaleNext('task', task.status, { confirm: task.confirm })) {
    const action: TaskAction =
      to === 'in_progress' ? 'start' : to === 'confirmed' ? 'confirm' : 'done';
    if (taskActionRefusal(action, facts, actor) === null) steps[to] = action;
  }
  return steps;
}
