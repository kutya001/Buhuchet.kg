import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { refreshReports } from './reports-data';

// К1 (доработки 13.11.2026): после суммы к уплате или смены статуса вкладка «Отчёты к сдаче» карточки
// контрагента показывала прежние данные, пока не переключишь вкладку, — её список (`cps.reports`) не
// перечитывался.

/** Кэш с данными по ключу; после `refreshReports` — помечен ли ключ устаревшим. */
function staleAfterRefresh(key: readonly unknown[]): boolean {
  const client = new QueryClient();
  client.setQueryData(key, { items: [] });
  refreshReports(client);
  return client.getQueryState(key)?.isInvalidated === true;
}

describe('refreshReports — что перечитывается после действия с отчётом', () => {
  it('«Отчёты к сдаче» карточки контрагента — сумма и статус видны сразу', () => {
    expect(staleAfterRefresh(['list', 'cps.reports', { contractorId: 'c1', page: 1 }])).toBe(true);
  });

  it('число просроченных на вкладке карточки, «Деньги» контрагента и столбцы списка контрагентов', () => {
    expect(staleAfterRefresh(['contractors', 'card', 'c1'])).toBe(true);
    expect(staleAfterRefresh(['money', 'contractor', 'c1', 'current'])).toBe(true);
    for (const tab of ['all', 'mine', 'debtors'])
      expect(staleAfterRefresh(['list', `cps.${tab}`, { page: 1 }])).toBe(true);
    expect(staleAfterRefresh(['contractors', 'tab-counts'])).toBe(true);
    expect(staleAfterRefresh(['contractors', 'summary'])).toBe(true);
  });

  it('число на вкладке «Файлы» и «История» открытой карточки контрагента', () => {
    expect(staleAfterRefresh(['files', 'contractor', 'c1'])).toBe(true);
    expect(staleAfterRefresh(['contractors', 'history', 'c1'])).toBe(true);
  });

  it('списки и карточки модуля «Отчеты для сдачи» — как раньше', () => {
    for (const tab of ['week', 'overdue', 'waiting', 'all', 'calendar', 'months'])
      expect(staleAfterRefresh(['list', `reports.${tab}`, { page: 1 }])).toBe(true);
    expect(staleAfterRefresh(['reports', 'card', 'r1'])).toBe(true);
    expect(staleAfterRefresh(['reports', 'months', '2026-10'])).toBe(true);
    expect(staleAfterRefresh(['list', 'cps.reports', 'months', 'c1'])).toBe(true);
    expect(staleAfterRefresh(['tasks', 'summary'])).toBe(true);
  });

  it('чужие списки не трогает', () => {
    expect(staleAfterRefresh(['list', 'staff.list', { page: 1 }])).toBe(false);
    expect(staleAfterRefresh(['contractors', 'form-options'])).toBe(false);
  });
});
