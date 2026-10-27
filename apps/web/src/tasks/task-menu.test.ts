import { defaultUiTexts, type TaskActor, type TaskStatus } from '@buhuchet/domain';
import type { TaskRow } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { taskCardButtons, taskMenuEntries, taskScaleSteps, type TaskMenuRun } from './task-menu';

// Пункты меню задачи, кнопки карточки и шаги шкалы (прототип modules/tasks.js, `taskActions`,
// `openTask`, `stepTo`): кому что видно и что недоступно с причиной.

const t = makeTranslate(defaultUiTexts());
const AUTHOR = '00000000-0000-4000-8000-00000000000a';
const EXEC = '00000000-0000-4000-8000-00000000000e';
const OTHER = '00000000-0000-4000-8000-000000000007';

const task = (status: TaskStatus, over: Partial<TaskRow> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000100',
    title: 'Собрать первичку',
    status,
    confirm: true,
    executor: { id: EXEC, shortName: 'Исполнитель И.' },
    author: { id: AUTHOR, shortName: 'Постановщик П.' },
    ...over,
  }) as TaskRow;

const actor = (employeeId: string, over: Partial<TaskActor> = {}): TaskActor => ({
  employeeId,
  isOwner: false,
  canConfirm: false,
  canRollback: false,
  canCreate: true,
  ...over,
});

const run = (): TaskMenuRun => ({
  open: vi.fn(),
  start: vi.fn(),
  done: vi.fn(),
  fail: vi.fn(),
  confirm: vi.fn(),
  rework: vi.fn(),
  edit: vi.fn(),
  cancel: vi.fn(),
});

const items = (list: readonly ActionEntry[]) =>
  list.filter((x): x is ActionItem => !('separator' in x));
const labels = (list: readonly ActionEntry[]) =>
  list.map((x) => ('separator' in x ? '—' : x.label));

describe('taskMenuEntries', () => {
  it('исполнитель открытой задачи: «Взять в работу», «Выполнена», «Не выполнена»; без «Изменить»', () => {
    const menu = taskMenuEntries({ actor: actor(EXEC), t, run: run() })(task('todo'));
    expect(labels(menu)).toEqual(['Открыть', 'Взять в работу', 'Выполнена', 'Не выполнена']);
    expect(items(menu).every((x) => !x.disabled)).toBe(true);
  });

  it('постановщик: «Выполнена» и «Не выполнена» недоступны с причиной; «Изменить», черта, «Отменить задачу» красным', () => {
    const menu = taskMenuEntries({ actor: actor(AUTHOR), t, run: run() })(task('in_progress'));
    expect(labels(menu)).toEqual([
      'Открыть',
      'Выполнена',
      'Не выполнена',
      'Изменить',
      '—',
      'Отменить задачу',
    ]);
    const done = items(menu).find((x) => x.id === 'done')!;
    expect(done).toMatchObject({ disabled: true, reason: 'Отметить может только исполнитель' });
    expect(items(menu).find((x) => x.id === 'cancel')).toMatchObject({ danger: true });
  });

  it('ждущая подтверждения: «Подтвердить» и «На доработку»; свою — нельзя, с причиной', () => {
    const pending = task('on_confirm');
    const author = taskMenuEntries({ actor: actor(AUTHOR), t, run: run() })(pending);
    expect(labels(author)).toEqual(['Открыть', 'Подтвердить', 'На доработку', 'Изменить']);
    expect(items(author).every((x) => !x.disabled)).toBe(true);

    const own = taskMenuEntries({ actor: actor(EXEC, { canConfirm: true }), t, run: run() })(
      pending,
    );
    expect(items(own).find((x) => x.id === 'confirm')).toMatchObject({
      disabled: true,
      reason:
        'Свою задачу подтвердить нельзя: подтверждает постановщик или другой сотрудник с правом',
    });

    const other = taskMenuEntries({ actor: actor(OTHER), t, run: run() })(pending);
    expect(items(other).find((x) => x.id === 'confirm')).toMatchObject({
      disabled: true,
      reason: 'Подтверждает постановщик или сотрудник с правом «Подтверждать задачи»',
    });
  });

  it('закрытая задача — только «Открыть»; в карточке — без «Открыть»', () => {
    for (const status of ['done', 'confirmed', 'failed', 'cancelled'] as const) {
      expect(
        labels(taskMenuEntries({ actor: actor(AUTHOR), t, run: run() })(task(status))),
      ).toEqual(['Открыть']);
    }
    const card = taskMenuEntries({ actor: actor(EXEC), t, run: run(), card: true })(task('todo'));
    expect(labels(card)).not.toContain('Открыть');
  });

  it('пункт вызывает своё действие с задачей', () => {
    const r = run();
    const row = task('todo');
    const menu = items(taskMenuEntries({ actor: actor(EXEC), t, run: r })(row));
    menu.find((x) => x.id === 'start')!.run();
    expect(r.start).toHaveBeenCalledWith(row);
  });
});

describe('taskCardButtons и taskScaleSteps', () => {
  it('исполнителю — «Выполнена»; подтверждающему — «На доработку» и «Подтвердить»', () => {
    expect(taskCardButtons(task('in_progress'), actor(EXEC))).toEqual(['done']);
    expect(taskCardButtons(task('in_progress'), actor(AUTHOR))).toEqual([]);
    expect(taskCardButtons(task('on_confirm'), actor(AUTHOR))).toEqual(['rework', 'confirm']);
    expect(taskCardButtons(task('on_confirm'), actor(OTHER, { canConfirm: true }))).toEqual([
      'rework',
      'confirm',
    ]);
    expect(taskCardButtons(task('on_confirm'), actor(EXEC, { canConfirm: true }))).toEqual([]);
  });

  it('шаги шкалы по правам: «В работе» — исполнителю и постановщику, «На подтверждении» — исполнителю', () => {
    expect(taskScaleSteps(task('todo'), actor(AUTHOR))).toEqual({ in_progress: 'start' });
    expect(taskScaleSteps(task('todo'), actor(OTHER))).toEqual({});
    expect(taskScaleSteps(task('in_progress'), actor(EXEC))).toEqual({ on_confirm: 'done' });
    expect(taskScaleSteps(task('rework', { confirm: true }), actor(EXEC))).toEqual({
      on_confirm: 'done',
    });
    expect(taskScaleSteps(task('in_progress', { confirm: false }), actor(EXEC))).toEqual({
      done: 'done',
    });
    expect(taskScaleSteps(task('on_confirm'), actor(AUTHOR))).toEqual({ confirmed: 'confirm' });
    expect(taskScaleSteps(task('on_confirm'), actor(EXEC))).toEqual({});
  });
});
