import type { SeriesRuleBody, Task, TaskFormOptions } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import {
  confirmHint,
  defaultExecutor,
  initialTaskForm,
  repeatChanged,
  repeatForTerm,
  repeatStart,
  taskEditBody,
  taskFormBody,
  taskFormLists,
  taskFormMoreFilled,
  taskFormMoreOpen,
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
    { id: CP, name: 'ОсОО «Ала-Тоо»', inn: '01203199810045', responsibleEmployeeId: RESP },
    {
      id: CP_BLOCKED_RESP,
      name: 'ИП Садыков',
      inn: '22807198500321',
      responsibleEmployeeId: BLOCKED,
    },
  ],
  confirmDefault: true,
  filesOn: true,
  projectsOn: true,
};
const PROJECT = '00000000-0000-4000-8000-0000000000a1';

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

  it('«Задача по проекту» — контрагент, проект и главный ответственный исполнителем', () => {
    expect(
      initialTaskForm({
        task: null,
        preset: { contractorId: CP, projectId: PROJECT, executorEmployeeId: ME },
        options,
        employeeId: RESP,
        today: '2026-10-18',
      }),
    ).toMatchObject({
      scope: 'contractor',
      contractorId: CP,
      projectId: PROJECT,
      executorEmployeeId: ME,
    });
    // Заблокированный главный — исполнитель по умолчанию (ответственный контрагента).
    expect(
      initialTaskForm({
        task: null,
        preset: { contractorId: CP, projectId: PROJECT, executorEmployeeId: BLOCKED },
        options,
        employeeId: ME,
        today: '2026-10-18',
      }).executorEmployeeId,
    ).toBe(RESP);
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

  it('(прототип v136) проект необязателен: «Без проекта» — не ошибка; проект — только у «По контрагенту»', () => {
    const cp = { ...base, title: 'X', scope: 'contractor' as const, contractorId: CP };
    expect(taskFormProblems({ ...cp, projectId: '' })).toEqual({});
    expect(taskFormProblems({ ...cp, projectId: PROJECT })).toEqual({});
    expect(taskFormBody({ ...cp, projectId: PROJECT }).projectId).toBe(PROJECT);
    expect(taskFormBody({ ...cp, projectId: '' }).projectId).toBeNull();
    expect(taskFormBody({ ...cp, scope: 'general', projectId: PROJECT }).projectId).toBeNull();
  });

  it('«Общая» — без контрагента; «На месяц» — первый день месяца', () => {
    expect(
      taskFormBody({ ...base, title: ' Сверка ', contractorId: CP, scope: 'general' }),
    ).toMatchObject({ title: 'Сверка', contractorId: null, dueDate: '2026-10-19' });
    expect(
      taskFormBody({ ...base, title: 'X', scope: 'contractor', contractorId: CP, term: 'month' }),
    ).toMatchObject({ contractorId: CP, term: 'month', dueDate: '2026-10-01' });
  });

  it('подсказка «нужно подтверждение»: у ждущей — «станет «Выполнена»», у закрытой — не меняется, иначе её нет', () => {
    expect(confirmHint(null)).toEqual({ key: null, locked: false });
    expect(confirmHint({ status: 'in_progress' })).toEqual({ key: null, locked: false });
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

describe('«Дополнительно» (прототип v136, `st.more` и `nMore`)', () => {
  const base = initialTaskForm({ task: null, options, employeeId: ME, today: '2026-10-18' });
  const plain = {
    description: '',
    project: null,
    term: 'day',
    needFile: false,
  } as unknown as Task;

  it('у новой задачи свёрнуто; у изменяемой раскрыто, когда есть описание, проект, срок на месяц или «нужен файл»', () => {
    expect(taskFormMoreOpen(null)).toBe(false);
    expect(taskFormMoreOpen(plain)).toBe(false);
    expect(taskFormMoreOpen({ ...plain, description: 'Акт' })).toBe(true);
    expect(taskFormMoreOpen({ ...plain, project: { id: PROJECT } } as unknown as Task)).toBe(true);
    expect(taskFormMoreOpen({ ...plain, term: 'month' })).toBe(true);
    expect(taskFormMoreOpen({ ...plain, needFile: true })).toBe(true);
  });

  it('«заполнено N»: описание, проект, срок на месяц, файл, категория не первая, подтверждение не как в политике', () => {
    expect(taskFormMoreFilled(base, options, true)).toBe(0);
    expect(taskFormMoreFilled({ ...base, description: ' Акт ' }, options, true)).toBe(1);
    expect(
      taskFormMoreFilled(
        {
          ...base,
          description: 'Акт',
          scope: 'contractor',
          contractorId: CP,
          projectId: PROJECT,
          term: 'month',
          needFile: true,
          categoryCode: 'КАТ-002',
          confirm: false,
        },
        options,
        true,
      ),
    ).toBe(6);
    // Проект общей задачи не отправляется — и не считается.
    expect(taskFormMoreFilled({ ...base, projectId: PROJECT }, options, true)).toBe(0);
    // У изменяемой задачи «нужно подтверждение» — её собственное, с политикой не сравнивается.
    expect(taskFormMoreFilled({ ...base, confirm: false }, options, false)).toBe(0);
  });
});

describe('«Повтор» в форме (доработки 28.11.2026; прототип `taskDlg`: `st.rep`, `repStart`, `ruleCh`)', () => {
  const base = initialTaskForm({ task: null, options, employeeId: ME, today: '2026-10-18' });
  const weekly: SeriesRuleBody = { every: 1, unit: 'week', weekDays: [0], end: { kind: 'never' } };
  const daily: SeriesRuleBody = { every: 2, unit: 'day', end: { kind: 'never' } };
  const seriesTask = (rule: SeriesRuleBody) =>
    ({
      title: 'Сверка',
      description: '',
      category: { code: 'КАТ-001', name: 'Сбор документов' },
      contractor: null,
      executor: { id: ME, shortName: 'Владелец В.' },
      term: 'day',
      dueDate: '2026-10-20',
      needFile: false,
      confirm: false,
      status: 'todo',
      series: { rule, state: 'active' },
    }) as unknown as Task;

  it('новая — «Не повторять»; у задачи серии — правило серии', () => {
    expect(base.repeat).toBeNull();
    const v = initialTaskForm({
      task: seriesTask(weekly),
      options,
      employeeId: ME,
      today: '2026-10-18',
    });
    expect(v.repeat).toEqual(weekly);
  });

  it('«Начало» — срок формы; у «На месяц» — последний день месяца; без даты — завтра', () => {
    expect(repeatStart({ term: 'day', date: '2026-10-25', month: '' }, '2026-10-18')).toBe(
      '2026-10-25',
    );
    expect(repeatStart({ term: 'day', date: '', month: '' }, '2026-10-18')).toBe('2026-10-19');
    expect(repeatStart({ term: 'month', date: '', month: '2026-02' }, '2026-10-18')).toBe(
      '2026-02-28',
    );
  });

  it('«На месяц»: повтор по дням и неделям становится «каждый месяц», остальное — как было', () => {
    expect(repeatForTerm(weekly, 'month')).toEqual({
      every: 1,
      unit: 'month',
      end: { kind: 'never' },
    });
    expect(repeatForTerm(daily, 'day')).toBe(daily);
    expect(repeatForTerm(null, 'month')).toBeNull();
  });

  it('тело правки: у серии правило — только «Эту и следующие» и только изменённое; у разовой — добавленный повтор', () => {
    const task = seriesTask(weekly);
    const v = initialTaskForm({ task, options, employeeId: ME, today: '2026-10-18' });
    expect(repeatChanged(v, task)).toBe(false);
    expect(taskEditBody(v, task, 'next')).not.toHaveProperty('repeat');
    const changed = { ...v, repeat: daily };
    expect(repeatChanged(changed, task)).toBe(true);
    expect(taskEditBody(changed, task, 'next')).toMatchObject({ scope: 'next', repeat: daily });
    expect(taskEditBody(changed, task, 'one')).not.toHaveProperty('repeat');
    const one = { ...task, series: null } as Task;
    expect(taskEditBody({ ...v, repeat: null }, one, 'next')).toMatchObject({ scope: 'one' });
    expect(taskEditBody({ ...v, repeat: null }, one, 'next')).not.toHaveProperty('repeat');
    expect(taskEditBody({ ...v, repeat: daily }, one, 'one')).toMatchObject({ repeat: daily });
  });
});
