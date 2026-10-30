import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { policyHistoryItem } from './policy-history';

// «История изменений учётной политики» словами, как записи прототипа (modules/org.js,
// log('org', 'policy', …)): что изменено, было → стало, кто, когда.

const t = makeTranslate(defaultUiTexts());
const AT = '2026-10-26T04:05:00.000Z';

const item = (
  changes: { field: string; from?: unknown; to?: unknown }[],
  over: { action?: string; actor?: string | null; reason?: string | null } = {},
) => ({
  at: AT,
  actor: over.actor === undefined ? 'Садыков Э.' : over.actor,
  action: over.action ?? 'update',
  changes,
  reason: over.reason ?? null,
});

const text = (changes: Parameters<typeof item>[0], over?: Parameters<typeof item>[1]) =>
  policyHistoryItem(item(changes, over), 0, t).text;

describe('история учётной политики словами', () => {
  it('дата и время по Бишкеку, кто изменил', () => {
    const row = policyHistoryItem(item([{ field: 'taskConfirm', from: true, to: false }]), 3, t);
    expect(row).toMatchObject({ date: '26.10.2026', time: '10:05', who: 'Садыков Э.' });
    expect(row.id).toBe(`${AT}-3`);
    expect(policyHistoryItem(item([], { actor: null }), 0, t).who).toBe('Система');
  });

  it('функции: какие включены и какие отключены, в порядке списка', () => {
    expect(
      text([
        {
          field: 'features',
          from: { tasks: true, projects: false, taxpay: false },
          to: { tasks: false, projects: true, taxpay: false },
        },
      ]),
    ).toBe('Отключена функция «Задачи»; Включена функция «Проекты контрагентов»');
  });

  it('переключатели, дни и разделы страницы', () => {
    expect(
      text([
        { field: 'taskConfirm', from: true, to: false },
        { field: 'reportConfirm', from: false, to: true },
        { field: 'payBeforeSubmit', from: true, to: false },
      ]),
    ).toBe(
      'Задачи требуют подтверждения: выключено; Сдача отчётов требует подтверждения: включено; ' +
        'Сдача отчёта только после оплаты: выключено',
    );
    // Было → стало, как требует ТЗ (docs/deviations.md, п. 37).
    expect(text([{ field: 'confirmWaitDays', from: 3, to: 5 }])).toBe(
      'Напоминание о неподтверждённой сдаче: через 3 → 5 дн.',
    );
    expect(text([{ field: 'remindDays', from: [7, 3], to: [14, 7, 3] }])).toBe(
      'Дни напоминаний: за 7, 3 → 14, 7, 3 дн.',
    );
    expect(text([{ field: 'remindDays', from: [7], to: [] }])).toBe(
      'Дни напоминаний: за 7 → — дн.',
    );
    expect(
      text([{ field: 'pageSections', from: ['pay', 'reports'], to: ['reports', 'contacts'] }]),
    ).toBe(
      'Страница контрагента: раздел «Как оплатить» не показывается; ' +
        'Страница контрагента: раздел «Контакты» показывается',
    );
  });

  it('создание — «Учётная политика по умолчанию»; причина — в скобках; чужие поля не показываются', () => {
    expect(text([], { action: 'create', actor: null })).toBe('Учётная политика по умолчанию');
    expect(
      text([{ field: 'features', from: {}, to: { tasks: true } }], { reason: 'по опроснику' }),
    ).toBe('Включена функция «Задачи» (по опроснику)');
    expect(text([{ field: 'timezone', from: 'Asia/Bishkek', to: 'Asia/Almaty' }])).toBe('');
  });

  it('опросник — одной строкой «по опроснику»: включены, выключены, подтверждение задач или «без изменений»', () => {
    expect(
      text([
        {
          field: 'features',
          from: { tasks: true, taxpay: false, finops: false, files: true },
          to: { tasks: true, taxpay: true, finops: true, files: false },
        },
        { field: 'taskConfirm', from: true, to: false },
        { field: 'quiz', to: 'first' },
      ]),
    ).toBe(
      'Учётная политика по опроснику: включены «Учёт оплаты налогов», ' +
        '«Финансовые операции по контрагентам»; выключены «Файлы в карточках»; ' +
        '«Задачи требуют подтверждения»: выключено',
    );
    expect(text([{ field: 'quiz', to: 'again' }])).toBe(
      'Учётная политика по опроснику (пройден заново): без изменений',
    );
  });
});
