import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { projectHistoryItems, projectHistoryText } from './project-history';

// Строки истории проекта — как в прототипе (modules/projects.js, `log('p', …)`).

const t = makeTranslate(defaultUiTexts());
const EXEC = '00000000-0000-4000-8000-000000000201';
const names = { [EXEC]: 'Мээрим К.' };

const entry = (
  action: string,
  changes: { field: string; from?: unknown; to?: unknown }[],
  reason: string | null = null,
) => ({ action, changes, reason });

describe('история проекта', () => {
  it('создание, «Сделано», «Снова в работе», изменение', () => {
    expect(
      projectHistoryText(t, entry('create', [{ field: 'name', to: 'Переход на ЕН' }]), names),
    ).toBe('Проект «Переход на ЕН» создан');
    expect(
      projectHistoryText(t, entry('work_done', [{ field: 'work', to: 'Сверка' }]), names),
    ).toBe('Сделано: Сверка');
    expect(
      projectHistoryText(t, entry('work_undone', [{ field: 'work', to: 'Сверка' }]), names),
    ).toBe('Снова в работе: Сверка');
    expect(projectHistoryText(t, entry('update', [{ field: 'name' }]), names)).toBe(
      'Проект изменён',
    );
  });

  it('добавлена работа — исполнитель по имени, срок — если есть', () => {
    expect(
      projectHistoryText(
        t,
        entry('work_add', [
          { field: 'work', to: 'Акт сверки' },
          { field: 'executor', to: EXEC },
          { field: 'due', to: '2026-11-20' },
        ]),
        names,
      ),
    ).toBe('Добавлена работа: Акт сверки (Мээрим К., до 20.11.2026)');
    expect(
      projectHistoryText(
        t,
        entry('work_add', [
          { field: 'work', to: 'Акт сверки' },
          { field: 'executor', to: EXEC },
        ]),
        names,
      ),
    ).toBe('Добавлена работа: Акт сверки (Мээрим К.)');
  });

  it('лента: дата и время по Бишкеку, кто; без автора — система', () => {
    const [item] = projectHistoryItems(
      t,
      [{ id: 7, at: '2026-11-01T18:30:00Z', actor: null, ...entry('update', []) }],
      names,
    );
    expect(item).toMatchObject({ id: '7', date: '02.11.2026', time: '00:30' });
    expect(item!.who).toBe(t('status.system'));
  });
});
