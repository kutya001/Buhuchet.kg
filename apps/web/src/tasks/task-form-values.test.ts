import type { Task, TaskFormOptions } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import {
  confirmHint,
  defaultExecutor,
  initialTaskForm,
  taskFormBody,
  taskFormLists,
  taskFormProblems,
} from './task-form-values';

// Форма задачи (прототип modules/tasks.js, `taskDlg`; ТЗ «Ручные задачи»): значения по умолчанию,
// исполнитель по умолчанию, проверка полей, тело запроса.

const ME = '00000000-0000-4000-8000-000000000001';
const RESP = '00000000-0000-4000-8000-000000000002';
const BLOCKED = '00000000-0000-4000-8000-000000000003';
const CP = '00000000-0000-4000-8000-0000000000c1';
const CP_BLOCKED_RESP = '00000000-0000-4000-8000-0000000000c2';

const options: TaskFormOptions = {
  categories: [
    { code: 'КАТ-001', name: 'Сбор документов' },
    { code: 'КАТ-002', name: 'Сверка' },
  ],
  executors: [
    { id: ME, shortName: 'Владелец В.' },
    { id: RESP, shortName: 'Бухгалтер Б.' },
  ],
  contractors: [
    { id: CP, name: 'ОсОО «Ала-Тоо»', responsibleEmployeeId: RESP },
    { id: CP_BLOCKED_RESP, name: 'ИП Садыков', responsibleEmployeeId: BLOCKED },
  ],
  confirmDefault: true,
  filesOn: true,
};

describe('значения формы', () => {
  it('новая: «Общая», первая категория, исполнитель — тот, кто ставит, «На день» на завтра, подтверждение из политики', () => {
    expect(
      initialTaskForm({ task: null, options, employeeId: ME, today: '2026-10-31' }),
    ).toMatchObject({
      scope: 'general',
      categoryCode: 'КАТ-001',
      executorEmployeeId: ME,
      term: 'day',
      date: '2026-11-01',
      month: '2026-10',
      needFile: false,
      confirm: true,
    });
    expect(
      initialTaskForm({
        task: null,
        options: { ...options, confirmDefault: false },
        employeeId: ME,
        today: '2026-10-18',
      }).confirm,
    ).toBe(false);
  });

  it('из карточки контрагента — «По контрагенту», исполнитель — его ответственный', () => {
    expect(
      initialTaskForm({
        task: null,
        preset: { contractorId: CP },
        options,
        employeeId: ME,
        today: '2026-10-18',
      }),
    ).toMatchObject({ scope: 'contractor', contractorId: CP, executorEmployeeId: RESP });
  });

  it('исполнитель по умолчанию: ответственный, если он действующий; иначе тот, кто ставит', () => {
    expect(defaultExecutor(options, CP, ME)).toBe(RESP);
    expect(defaultExecutor(options, CP_BLOCKED_RESP, ME)).toBe(ME);
    expect(defaultExecutor(options, '', ME)).toBe(ME);
  });

  it('у изменяемой задачи — её поля; отключённые категория и исполнитель остаются в списках', () => {
    const task = {
      title: 'Сверка',
      description: 'Акт',
      category: { code: 'КАТ-OLD', name: 'Старая категория' },
      contractor: null,
      executor: { id: BLOCKED, shortName: 'Ушедший У.' },
      term: 'month',
      dueDate: '2026-11-30',
      needFile: true,
      confirm: false,
      status: 'in_progress',
    } as unknown as Task;
    expect(initialTaskForm({ task, options, employeeId: ME, today: '2026-10-18' })).toMatchObject({
      scope: 'general',
      categoryCode: 'КАТ-OLD',
      executorEmployeeId: BLOCKED,
      term: 'month',
      month: '2026-11',
      needFile: true,
      confirm: false,
    });
    const lists = taskFormLists(options, task);
    expect(lists.categories.at(-1)).toEqual({ value: 'КАТ-OLD', label: 'Старая категория' });
    expect(lists.executors.at(-1)).toEqual({ value: BLOCKED, label: 'Ушедший У.' });
    expect(taskFormLists(options, null).categories).toHaveLength(2);
  });
});

describe('проверка и тело запроса', () => {
  const base = initialTaskForm({ task: null, options, employeeId: ME, today: '2026-10-18' });

  it('название обязательно; у «По контрагенту» — контрагент; дата или месяц', () => {
    expect(taskFormProblems({ ...base, title: '  ' })).toEqual({
      title: 'task.form.title_required',
    });
    expect(taskFormProblems({ ...base, title: 'X', scope: 'contractor' })).toEqual({
      contractorId: 'task.form.cp_required',
    });
    expect(taskFormProblems({ ...base, title: 'X', date: '' })).toEqual({
      date: 'task.form.date_required',
    });
    expect(taskFormProblems({ ...base, title: 'X', term: 'month', month: '' })).toEqual({
      month: 'task.form.month_required',
    });
    expect(taskFormProblems({ ...base, title: 'X' })).toEqual({});
  });

  it('«Общая» — без контрагента; «На месяц» — первый день месяца', () => {
    expect(
      taskFormBody({ ...base, title: ' Сверка ', contractorId: CP, scope: 'general' }),
    ).toMatchObject({ title: 'Сверка', contractorId: null, dueDate: '2026-10-19' });
    expect(
      taskFormBody({ ...base, title: 'X', scope: 'contractor', contractorId: CP, term: 'month' }),
    ).toMatchObject({ contractorId: CP, term: 'month', dueDate: '2026-10-01' });
  });

  it('подсказка «Требуется подтверждение»: у ждущей — «станет «Выполнена»», у закрытой — не меняется', () => {
    expect(confirmHint(null)).toEqual({ key: 'task.form.confirm_default', locked: false });
    expect(confirmHint({ status: 'on_confirm' })).toEqual({
      key: 'task.form.confirm_pending',
      locked: false,
    });
    expect(confirmHint({ status: 'done' })).toEqual({
      key: 'task.form.confirm_closed',
      locked: true,
    });
    expect(confirmHint({ status: 'rework' }).locked).toBe(false);
  });
});
