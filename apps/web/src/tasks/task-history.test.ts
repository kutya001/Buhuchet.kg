import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { taskHistoryItem, taskHistoryText } from './task-history';

// «История» карточки задачи (ТЗ «История изменений»: было → стало; прототип modules/tasks.js,
// `log('t', …)`).

const t = makeTranslate(defaultUiTexts());
const at = '2026-10-18T03:00:00.000Z';

describe('taskHistoryText', () => {
  it('создание, файлы', () => {
    expect(taskHistoryText(t, { at, actor: 'Т', action: 'create', changes: [] })).toBe(
      'Задача поставлена',
    );
    expect(
      taskHistoryText(t, {
        at,
        actor: 'Т',
        action: 'file_attach',
        changes: [{ field: 'file', to: 'акт.pdf' }],
      }),
    ).toBe('Прикреплён файл: акт.pdf');
    expect(
      taskHistoryText(t, {
        at,
        actor: 'Т',
        action: 'file_delete',
        changes: [{ field: 'file', from: 'акт.pdf' }],
      }),
    ).toBe('Удалён файл: акт.pdf');
  });

  it('смена вида задачи, подтверждения и полей — словами, было → стало', () => {
    expect(
      taskHistoryText(t, {
        at,
        actor: 'Т',
        action: 'update',
        changes: [
          { field: 'contractorId', from: 'ОсОО «Ала-Тоо»', to: null },
          { field: 'confirm', from: true, to: false },
          { field: 'status', from: 'on_confirm', to: 'done' },
          { field: 'dueDate', from: '2026-10-25', to: '2026-10-31' },
          { field: 'needFile', from: false, to: true },
          { field: 'term', from: 'day', to: 'month' },
          { field: 'executorEmployeeId', from: 'Бухгалтер Б.', to: 'Главный Г.' },
          { field: 'description', from: '', to: 'Акт сверки' },
        ],
      }),
    ).toBe(
      [
        'Вид задачи изменён: «По контрагенту» → «Общая»',
        'Подтверждение: не требуется',
        'Статус: На подтверждении → Выполнена',
        'Срок: 25.10.2026 → 31.10.2026',
        'Требуется файл: Нет → Да',
        'Вид срока: На день → На месяц',
        'Исполнитель: Бухгалтер Б. → Главный Г.',
        'Описание: — → Акт сверки',
      ].join('; '),
    );
    expect(
      taskHistoryText(t, {
        at,
        actor: 'Т',
        action: 'update',
        changes: [{ field: 'contractorId', from: 'А', to: 'Б' }],
      }),
    ).toBe('Контрагент: А → Б');
  });

  it('запись ленты: дата и время по Бишкеку, автор; без автора — «Система»', () => {
    expect(taskHistoryItem(t, { at, actor: null, action: 'create', changes: [] }, 0)).toMatchObject(
      { date: '18.10.2026', time: '09:00', who: 'Система' },
    );
  });
});
