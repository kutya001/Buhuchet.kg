import type { TaskRecord, Tx } from '@buhuchet/db';
import { formatDateRu, formatText } from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { taskBell, type TelegramEvent } from '../telegram/events';
import { taskView } from '../telegram/staff-view';

/**
 * Название задачи и «Новая задача от {автор} · срок {срок}» исполнителю (ТЗ: «сообщение о новой
 * задаче … приходит сразу»; прототип v97 `tgTaskMsg`: название — заголовком, под сообщением — кнопки
 * исполнителя); у задачи на месяц срок —
 * «до 31.10.2026».
 */
export async function newTaskEvent(
  deps: ApiDeps,
  tx: Tx,
  task: TaskRecord,
  by: string | null,
  t: (key: string) => string,
): Promise<TelegramEvent> {
  const date = formatDateRu(task.dueDate);
  return {
    kind: 'task_new',
    to: task.executor.id,
    by,
    template: 'tgTask',
    heading: task.title,
    values: {
      автор: task.author.shortName,
      задача: task.title,
      срок: task.term === 'month' ? formatText(t('task.date.month'), { date }) : date,
    },
    link: 'tasks',
    bell: taskBell(task),
    // Кнопки под сообщением: «Взять в работу», «Выполнена», «Открыть задачу» (поток Т, задача Т2).
    ...(await taskView(deps, { id: task.id, title: task.title, todo: task.status === 'todo' }, tx)),
  };
}
