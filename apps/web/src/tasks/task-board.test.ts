import { defaultUiTexts, type TaskActor, type TaskFacts, type TaskStatus } from '@buhuchet/domain';
import type { Task } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  executorChangeBody,
  manualTaskMove,
  regularTaskMove,
  TASK_BOARD_STATUS_ORDER,
  taskKanban,
} from './task-board';

// Доска задач (прототип modules/tasks.js, `taskKanban`): перенос карточки в другой столбец делает то
// же, что действие в меню, — с теми же правами; остальное — отказ с причиной.

const t = makeTranslate(defaultUiTexts());
const AUTHOR = '00000000-0000-4000-8000-00000000000a';
const EXEC = '00000000-0000-4000-8000-00000000000e';
const OTHER = '00000000-0000-4000-8000-000000000007';

const facts = (status: TaskStatus, over: Partial<TaskFacts> = {}): TaskFacts => ({
  status,
  confirm: true,
  executorId: EXEC,
  authorId: AUTHOR,
  ...over,
});
const actor = (employeeId: string, over: Partial<TaskActor> = {}): TaskActor => ({
  employeeId,
  isOwner: false,
  canConfirm: false,
  canRollback: false,
  canCreate: true,
  ...over,
});

describe('доска задач', () => {
  it('столбцы: статус по умолчанию; статусы «К выполнению», «В работе», «На подтверждении», «Выполнена» видны и пустыми', () => {
    const kanban = taskKanban(t, [{ id: OTHER, shortName: 'Асанов А.' }], () => {});
    expect(kanban.def).toBe('status');
    expect(kanban.by).toEqual(['status', 'exec', 'cp', 'cat', 'proj', 'by', 'term', 'tkind']);
    expect(kanban.show?.status).toEqual([
      { key: 'todo', label: 'К выполнению' },
      { key: 'in_progress', label: 'В работе' },
      { key: 'on_confirm', label: 'На подтверждении' },
      { key: 'done', label: 'Выполнена' },
    ]);
    expect(kanban.show?.exec).toEqual([{ key: OTHER, label: 'Асанов А.' }]);
    // «В работе» отчёта регулярной задачи — в том же столбце, что у ручной.
    expect(kanban.merge?.status).toEqual({ 'rep:in_progress': 'in_progress' });
    expect(kanban.drop).toBeDefined();
    expect(taskKanban(t, [], undefined).drop).toBeUndefined();
    // Порядок прототипа: К выполнению, К сдаче, В работе, На доработке, Требует исправления, …
    expect(TASK_BOARD_STATUS_ORDER.slice(0, 5)).toEqual([
      'todo',
      'rep:todo',
      'in_progress',
      'rework',
      'rep:needs_fix',
    ]);
  });

  it('«В работе»: берёт в работу исполнитель или постановщик задачи «К выполнению»', () => {
    expect(manualTaskMove(facts('todo'), actor(EXEC), 'status', 'in_progress')).toEqual({
      kind: 'action',
      action: 'start',
    });
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'status', 'in_progress')).toEqual({
      kind: 'action',
      action: 'start',
    });
    expect(manualTaskMove(facts('todo'), actor(OTHER), 'status', 'in_progress')).toEqual({
      kind: 'refusal',
      code: 'task_start_forbidden',
    });
    // «На доработке» в «В работе» перетаскиванием не переводится.
    expect(manualTaskMove(facts('rework'), actor(EXEC), 'status', 'in_progress')).toEqual({
      kind: 'text',
      key: 'task.board.no_move',
    });
  });

  it('«Выполнена», «На подтверждении» и «Подтверждена» у открытой — «Выполнена», только исполнителю', () => {
    for (const to of ['done', 'on_confirm', 'confirmed']) {
      expect(manualTaskMove(facts('in_progress'), actor(EXEC), 'status', to)).toEqual({
        kind: 'action',
        action: 'done',
      });
    }
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'status', 'done')).toEqual({
      kind: 'refusal',
      code: 'task_executor_only',
    });
  });

  it('ждущая подтверждения: «Подтверждена» — подтвердить, «На доработке» — вернуть, по правилам подтверждения', () => {
    expect(manualTaskMove(facts('on_confirm'), actor(AUTHOR), 'status', 'confirmed')).toEqual({
      kind: 'action',
      action: 'confirm',
    });
    expect(manualTaskMove(facts('on_confirm'), actor(AUTHOR), 'status', 'rework')).toEqual({
      kind: 'action',
      action: 'rework',
    });
    expect(manualTaskMove(facts('on_confirm'), actor(OTHER), 'status', 'confirmed').kind).toBe(
      'refusal',
    );
    expect(manualTaskMove(facts('on_confirm'), actor(EXEC), 'status', 'done')).toEqual({
      kind: 'text',
      key: 'task.board.no_move',
    });
  });

  it('«Не выполнена» — исполнителю, «Отменена» — постановщику или владельцу; закрытую не переносят', () => {
    expect(manualTaskMove(facts('in_progress'), actor(EXEC), 'status', 'failed')).toEqual({
      kind: 'action',
      action: 'fail',
    });
    expect(manualTaskMove(facts('in_progress'), actor(AUTHOR), 'status', 'cancelled')).toEqual({
      kind: 'action',
      action: 'cancel',
    });
    expect(
      manualTaskMove(facts('todo'), actor(OTHER, { isOwner: true }), 'status', 'cancelled'),
    ).toEqual({ kind: 'action', action: 'cancel' });
    expect(manualTaskMove(facts('todo'), actor(EXEC), 'status', 'cancelled').kind).toBe('refusal');
    for (const to of ['todo', 'in_progress', 'done', 'cancelled', 'rep:submitted', '']) {
      expect(manualTaskMove(facts('done'), actor(AUTHOR, { isOwner: true }), 'status', to)).toEqual(
        { kind: 'text', key: 'task.board.no_move' },
      );
    }
  });

  it('исполнитель: меняет постановщик или владелец у открытой задачи; столбец «(Пусто)» — не сотрудник', () => {
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'exec', OTHER)).toEqual({
      kind: 'executor',
      employeeId: OTHER,
    });
    expect(manualTaskMove(facts('rework'), actor(OTHER, { isOwner: true }), 'exec', OTHER)).toEqual(
      { kind: 'executor', employeeId: OTHER },
    );
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'exec', '')).toEqual({
      kind: 'text',
      key: 'task.board.pick_employee',
    });
    expect(manualTaskMove(facts('todo'), actor(EXEC), 'exec', OTHER).kind).toBe('refusal');
    expect(manualTaskMove(facts('on_confirm'), actor(AUTHOR), 'exec', OTHER)).toEqual({
      kind: 'text',
      key: 'task.board.exec_open',
    });
    expect(manualTaskMove(facts('done'), actor(AUTHOR), 'exec', OTHER)).toEqual({
      kind: 'text',
      key: 'task.board.exec_open',
    });
    // Как в прототипе: не постановщику — сначала «может постановщик или владелец», даже у закрытой.
    expect(manualTaskMove(facts('done'), actor(EXEC), 'exec', OTHER).kind).toBe('refusal');
    // Столбец бывшего сотрудника (его нет среди действующих) — «Выберите столбец сотрудника».
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'exec', OTHER, [EXEC])).toEqual({
      kind: 'text',
      key: 'task.board.pick_employee',
    });
    expect(manualTaskMove(facts('todo'), actor(AUTHOR), 'exec', OTHER, [EXEC, OTHER])).toEqual({
      kind: 'executor',
      employeeId: OTHER,
    });
  });

  it('по контрагенту, категории, проекту и другим столбцам перенос ничего не меняет', () => {
    for (const key of ['cp', 'cat', 'proj', 'by', 'term', 'tkind']) {
      expect(manualTaskMove(facts('todo'), actor(AUTHOR), key, 'x')).toEqual({
        kind: 'text',
        key: 'task.board.only',
      });
      expect(regularTaskMove({ status: 'todo', act: 'sub' }, key, 'x')).toEqual({
        key: 'task.board.only',
      });
    }
  });

  it('регулярная задача: статус — из отчёта; «В работе» берёт в работу, «Сдан» — сдача', () => {
    expect(regularTaskMove({ status: 'todo', act: 'sub' }, 'status', 'in_progress')).toBe('start');
    expect(regularTaskMove({ status: 'in_progress', act: 'both' }, 'status', 'rep:submitted')).toBe(
      'submit',
    );
    expect(regularTaskMove({ status: 'needs_fix', act: 'sub' }, 'status', 'rep:submitted')).toBe(
      'submit',
    );
    const refused = { key: 'task.board.reg_status' };
    // У отчёта «только уплата» сдачи нет; сданный и взятый в работу — не переносятся.
    expect(regularTaskMove({ status: 'todo', act: 'pay' }, 'status', 'rep:submitted')).toEqual(
      refused,
    );
    expect(regularTaskMove({ status: 'submitted', act: 'sub' }, 'status', 'rep:submitted')).toEqual(
      refused,
    );
    expect(regularTaskMove({ status: 'in_progress', act: 'sub' }, 'status', 'in_progress')).toEqual(
      refused,
    );
    expect(regularTaskMove({ status: 'todo', act: 'sub' }, 'status', 'done')).toEqual(refused);
    expect(regularTaskMove({ status: 'todo', act: 'sub' }, 'exec', OTHER)).toEqual({
      key: 'task.board.reg_exec',
    });
  });

  it('смена исполнителя — «Изменить» с прежними полями и версией; «На месяц» — первым днём месяца', () => {
    const task = {
      id: '00000000-0000-4000-8000-000000000100',
      title: 'Собрать первичку',
      description: 'За октябрь',
      category: { code: 'КАТ-001', name: 'Первичка' },
      contractor: { id: '00000000-0000-4000-8000-0000000000c1', name: 'ОсОО «Ала-Тоо»' },
      project: null,
      executor: { id: EXEC, shortName: 'Исполнитель И.' },
      term: 'month',
      dueDate: '2026-10-31',
      needFile: true,
      confirm: false,
      version: 7,
    } as unknown as Task;
    expect(executorChangeBody(task, OTHER)).toEqual({
      title: 'Собрать первичку',
      description: 'За октябрь',
      categoryCode: 'КАТ-001',
      contractorId: '00000000-0000-4000-8000-0000000000c1',
      executorEmployeeId: OTHER,
      term: 'month',
      dueDate: '2026-10-01',
      needFile: true,
      confirm: false,
      projectId: null,
      version: 7,
    });
    const day = { ...task, term: 'day', dueDate: '2026-10-25', contractor: null } as Task;
    expect(executorChangeBody(day, OTHER)).toMatchObject({
      dueDate: '2026-10-25',
      contractorId: null,
    });
  });
});
