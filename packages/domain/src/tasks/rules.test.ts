import { describe, expect, it } from 'vitest';
import { scaleStatuses } from '../common/status';
import fixture from './__fixtures__/tasks.json';
import {
  monthLastDay,
  monthStart,
  TASK_MESSAGES,
  TASK_STATUSES,
  taskActionRefusal,
  taskConfirmEditable,
  taskConfirmMark,
  taskConfirmRefusal,
  taskDoneStatus,
  taskFileMark,
  taskMenu,
  taskOpen,
  taskOverdue,
  taskPending,
  taskRollbackClears,
  taskRollbackTarget,
  taskStatusAfterEdit,
  type TaskActor,
  type TaskFacts,
  type TaskStatus,
} from './rules';

const actorOf = (id: string): TaskActor => {
  const a = fixture.actors.find((x) => x.employeeId === id)!;
  return { ...a, canRollback: false };
};
const factsOf = (id: string, status: string, confirm: boolean): TaskFacts => {
  const t = fixture.tasks.find((x) => x.id === id)!;
  return { status: status as TaskStatus, confirm, executorId: t.executorId, authorId: t.authorId };
};

describe('задачи: сверка с прототипом (modules/tasks.js)', () => {
  it('пункты меню и их доступность — как taskActions на всех задачах и сотрудниках', () => {
    for (const m of fixture.menus) {
      const menu = taskMenu(factsOf(m.task, m.status, m.confirm), actorOf(m.actor));
      const got = menu.map((x) => ({
        action: x.action,
        disabled: x.refusal !== null,
        reason: x.refusal === null ? null : TASK_MESSAGES[x.refusal],
      }));
      // Прототип не объясняет, почему «Взять в работу» недоступно, — у продукта подсказка есть.
      const want = m.items.map((x) =>
        x.action === 'start' && x.disabled
          ? { ...x, reason: TASK_MESSAGES.task_start_forbidden }
          : x,
      );
      expect(got, `${m.actor} ${m.task} ${m.status}`).toEqual(want);
    }
  });

  it('кто подтверждает — как taskConfWhy', () => {
    for (const m of fixture.menus) {
      const why = taskConfirmRefusal(factsOf(m.task, m.status, m.confirm), actorOf(m.actor));
      expect(why === null ? null : TASK_MESSAGES[why], `${m.actor} ${m.task} ${m.status}`).toBe(
        m.confirmWhy,
      );
    }
  });

  it('открыта и просрочена — как taskOpen и taskOver', () => {
    for (const o of fixture.overdue) {
      const t = fixture.tasks.find((x) => x.id === o.task)!;
      const status = o.status as TaskStatus;
      expect(taskOpen(status), `${o.task} ${o.status}`).toBe(o.open);
      expect(taskOverdue({ status, dueDate: t.dueDate }, o.today), `${o.today} ${o.task}`).toBe(
        o.overdue,
      );
    }
  });

  it('отметка «Подтверждение» — как taskConfTxt', () => {
    const text: Record<string, (by: string | null) => string> = {
      not_required: () => 'Не требуется',
      required: () => 'Требуется',
      confirmed: (by) => `Подтвердил ${by === 'e1' ? 'Эркин С.' : by}`,
    };
    for (const m of fixture.marks) {
      const mark = taskConfirmMark({
        confirm: m.confirm,
        status: m.status as TaskStatus,
        confirmedBy: m.confirmedBy,
      });
      expect(text[mark]!(m.confirmedBy), `${m.task} ${m.status}`).toBe(m.text);
    }
  });
});

describe('задачи: правила ТЗ', () => {
  const owner: TaskActor = { employeeId: 'o', isOwner: true, canConfirm: true, canRollback: true };
  const chief: TaskActor = {
    employeeId: 'c',
    isOwner: false,
    canConfirm: true,
    canRollback: false,
  };
  const acc: TaskActor = { employeeId: 'a', isOwner: false, canConfirm: false, canRollback: false };
  const task = (status: TaskStatus, over: Partial<TaskFacts> = {}): TaskFacts => ({
    status,
    confirm: true,
    executorId: 'a',
    authorId: 'c',
    ...over,
  });

  it('статусы шкалы задачи', () => {
    expect(TASK_STATUSES).toEqual(scaleStatuses('task'));
    expect(TASK_STATUSES).toEqual([
      'todo',
      'in_progress',
      'rework',
      'on_confirm',
      'confirmed',
      'done',
      'failed',
      'cancelled',
    ]);
    expect(taskPending('on_confirm')).toBe(true);
    expect(taskPending('done')).toBe(false);
  });

  it('п. 40: подтверждает постановщик или сотрудник с правом, свою — никто', () => {
    expect(taskConfirmRefusal(task('on_confirm'), chief)).toBeNull();
    expect(taskConfirmRefusal(task('on_confirm', { authorId: 'x' }), owner)).toBeNull();
    expect(taskConfirmRefusal(task('on_confirm', { authorId: 'x', executorId: 'y' }), acc)).toBe(
      'task_confirm_right',
    );
    // Поставил сам себе — подтверждает другой сотрудник с правом.
    expect(taskConfirmRefusal(task('on_confirm', { executorId: 'c' }), chief)).toBe(
      'task_confirm_own',
    );
    expect(taskConfirmRefusal(task('in_progress'), chief)).toBe('task_not_pending');
  });

  it('«Выполнена» и «Не выполнена» — только исполнитель открытой задачи', () => {
    expect(taskActionRefusal('done', task('in_progress'), acc)).toBeNull();
    expect(taskActionRefusal('done', task('rework'), acc)).toBeNull();
    expect(taskActionRefusal('done', task('in_progress'), chief)).toBe('task_executor_only');
    expect(taskActionRefusal('fail', task('done'), acc)).toBe('task_closed');
  });

  it('изменить и отменить — постановщик и владелец', () => {
    expect(taskActionRefusal('edit', task('todo'), chief)).toBeNull();
    expect(taskActionRefusal('edit', task('on_confirm'), owner)).toBeNull();
    expect(taskActionRefusal('edit', task('todo'), acc)).toBe('task_author_only');
    expect(taskActionRefusal('edit', task('done'), chief)).toBe('task_closed');
    expect(taskActionRefusal('cancel', task('on_confirm'), chief)).toBe('task_closed');
    expect(taskActionRefusal('cancel', task('todo'), owner)).toBeNull();
    expect(taskActionRefusal('start', task('todo'), acc)).toBeNull();
    expect(taskActionRefusal('start', task('in_progress'), acc)).toBe('task_closed');
  });

  it('п. 42: без подтверждения «Выполнена» сразу закрывает задачу', () => {
    expect(taskDoneStatus(false)).toBe('done');
    expect(taskDoneStatus(true)).toBe('on_confirm');
  });

  it('снять «Требуется подтверждение» у ждущей — сразу «Выполнена»', () => {
    expect(taskStatusAfterEdit('on_confirm', true, false)).toBe('done');
    expect(taskStatusAfterEdit('rework', true, false)).toBe('in_progress');
    expect(taskStatusAfterEdit('in_progress', true, false)).toBeNull();
    expect(taskStatusAfterEdit('on_confirm', true, true)).toBeNull();
    expect(taskStatusAfterEdit('todo', false, true)).toBeNull();
    expect(taskConfirmEditable('on_confirm')).toBe(true);
    expect(taskConfirmEditable('confirmed')).toBe(false);
  });

  it('срок: ждущая подтверждения не просрочена, на доработке после срока — просрочена', () => {
    expect(taskOverdue({ status: 'on_confirm', dueDate: '2026-10-01' }, '2026-10-20')).toBe(false);
    expect(taskOverdue({ status: 'rework', dueDate: '2026-10-01' }, '2026-10-20')).toBe(true);
    expect(taskOverdue({ status: 'todo', dueDate: '2026-10-20' }, '2026-10-20')).toBe(false);
  });

  it('месяц: последний и первый день', () => {
    expect(monthLastDay('2026-02')).toBe('2026-02-28');
    expect(monthLastDay('2028-02')).toBe('2028-02-29');
    expect(monthLastDay('2026-10')).toBe('2026-10-31');
    expect(monthStart('2026-10-27')).toBe('2026-10-01');
  });

  it('откат: на шаг назад, снимает дату выполнения и подтверждение', () => {
    expect(taskRollbackTarget('confirmed')).toBe('on_confirm');
    expect(taskRollbackTarget('on_confirm')).toBe('in_progress');
    expect(taskRollbackTarget('cancelled')).toBe('in_progress');
    expect(taskRollbackTarget('todo')).toBeNull();
    expect(taskRollbackTarget('rework')).toBeNull();
    expect(taskRollbackClears('confirmed', 'on_confirm')).toEqual({
      done: false,
      confirmation: true,
    });
    expect(taskRollbackClears('done', 'in_progress')).toEqual({ done: true, confirmation: false });
  });

  it('отметки «Подтверждение» и «Файл»', () => {
    expect(taskConfirmMark({ confirm: true, status: 'confirmed', confirmedBy: 'x' })).toBe(
      'confirmed',
    );
    expect(taskConfirmMark({ confirm: true, status: 'on_confirm', confirmedBy: null })).toBe(
      'required',
    );
    expect(taskFileMark({ needFile: true, hasFile: true })).toBe('attached');
    expect(taskFileMark({ needFile: true, hasFile: false })).toBe('needed');
    expect(taskFileMark({ needFile: false, hasFile: false })).toBe('none');
  });
});
