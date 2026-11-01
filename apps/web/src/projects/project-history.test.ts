import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  projectHistoryItems,
  projectHistoryText,
  projectPaymentHistoryText,
} from './project-history';

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

describe("история транша (прототип `log('p', …, {sub})`, fin-op.js `opLog`)", () => {
  const pay = (
    action: string,
    changes: { field: string; from?: unknown; to?: unknown }[],
    reason: string | null = null,
  ) => ({ action, paymentId: '00000000-0000-4000-8000-000000000301', changes, reason });
  const nbsp = (s: string) => s.replace(/\s/g, ' ');

  it('«Оплата 5 000 сом (аванс)» — в истории проекта и окне транша', () => {
    const created = pay('create', [
      { field: 'amount', to: 500_000 },
      { field: 'paidOn', to: '2026-10-15' },
      { field: 'note', to: 'аванс' },
    ]);
    expect(nbsp(projectHistoryText(t, created, names))).toBe('Оплата 5 000 сом (аванс)');
    expect(nbsp(projectPaymentHistoryText(t, pay('create', [{ field: 'amount', to: 100 }])))).toBe(
      'Оплата 1 сом',
    );
  });

  it('изменение с причиной и удаление — как у операции', () => {
    expect(
      nbsp(
        projectPaymentHistoryText(
          t,
          pay('update', [{ field: 'amount', from: 5_000_000, to: 4_500_000 }], 'Ошибка в сумме'),
        ),
      ),
    ).toBe('Изменено: сумма 50 000,00 → 45 000,00 сом. Причина: Ошибка в сумме');
    expect(
      nbsp(
        projectPaymentHistoryText(
          t,
          pay(
            'delete',
            [
              { field: 'amount', from: 4_500_000 },
              { field: 'paidOn', from: '2026-10-15' },
            ],
            'Дубль',
          ),
        ),
      ),
    ).toContain('оплата по проекту на 45 000 сом от 15.10.2026');
  });
});
