import { defaultUiTexts } from '@buhuchet/domain';
import type { BellItem } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { bellGoOf, bellRowView } from './bell-model';

// Колокольчик (доработки 16.11.2026, блок 3; прототип v123 `bellRow`, `bellGo`): строка панели и куда
// ведёт нажатие — по видам, договорённым с потоком Т.

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ctx = { employeeId: ID, reportsAll: true, tasks: true, contractors: true };
const item = (over: Partial<BellItem> = {}): BellItem => ({
  id: ID,
  kind: 'files',
  event: 'cp_file',
  contractor: { id: ID, name: 'ОсОО «Ромашка» <b>' },
  text: 'Новый файл от контрагента',
  at: '2026-11-16T09:00:00.000Z',
  read: false,
  open: { kind: 'cp_sent', id: ID },
  ...over,
});

describe('строка панели', () => {
  const t = makeTranslate(defaultUiTexts());
  const now = new Date('2026-11-16T09:30:00Z');

  it('значок по событию или по фильтру, время и группа — по Бишкеку, текст как есть', () => {
    expect(bellRowView(t, item(), now)).toEqual({
      id: ID,
      icon: 'folder',
      contractor: 'ОсОО «Ромашка» <b>',
      text: 'Новый файл от контрагента',
      at: '30 мин назад',
      group: 'Сегодня',
      read: false,
    });
    const day = bellRowView(
      t,
      item({ kind: 'reports', event: 'day_dues', contractor: null, at: '2026-11-15T04:00:00Z' }),
      now,
    );
    expect([day.icon, day.contractor, day.at, day.group]).toEqual([
      'calendar',
      null,
      'вчера 10:00',
      'Вчера',
    ]);
    expect(bellRowView(t, item({ kind: 'other', event: 'x' }), now).icon).toBe('info');
  });
});

describe('куда ведёт строка — как bellGo прототипа', () => {
  it('запись — списком с карточкой, как ссылка из бота; контрагент — его карточкой', () => {
    expect(bellGoOf({ kind: 'report', id: ID }, ctx)).toEqual({
      kind: 'href',
      href: `/app/reports/all?report=${ID}`,
    });
    expect(bellGoOf({ kind: 'task', id: ID }, ctx)).toEqual({
      kind: 'href',
      href: `/app/tasks/mine?task=${ID}`,
    });
    expect(bellGoOf({ kind: 'cp_sent', id: ID }, ctx)).toEqual({
      kind: 'contractor',
      id: ID,
      tab: 'files',
      sent: true,
    });
    expect(bellGoOf({ kind: 'cp_money', id: ID }, ctx)).toMatchObject({ tab: 'money' });
    expect(bellGoOf({ kind: 'cp_fee', id: ID }, ctx)).toMatchObject({ tab: 'fee' });
    expect(bellGoOf({ kind: 'contractor', id: ID }, ctx)).toMatchObject({ tab: 'main' });
    expect(bellGoOf({ kind: 'employee', id: ID }, ctx)).toEqual({
      kind: 'href',
      href: `/app/staff/list?employee=${ID}`,
    });
    expect(bellGoOf({ kind: 'lead', id: ID }, ctx)).toEqual({
      kind: 'href',
      href: `/app/orgs/leads?lead=${ID}`,
    });
    expect(bellGoOf({ kind: 'news', id: 'v123' }, ctx)).toEqual({
      kind: 'href',
      href: '/app/kb/news?news=v123',
    });
  });

  it('«Сроки на сегодня» — «На неделе» со своими отчётами, когда видно отчёты всех', () => {
    const all = bellGoOf({ kind: 'reports_day', id: '2026-11-16' }, ctx);
    expect(all).toEqual({
      kind: 'href',
      href: `/app/reports/week?preset=${encodeURIComponent(
        JSON.stringify({ responsible: { type: 'enum', vals: [ID] } }),
      )}`,
    });
    expect(
      bellGoOf({ kind: 'reports_day', id: '2026-11-16' }, { ...ctx, reportsAll: false }),
    ).toEqual({ kind: 'href', href: '/app/reports/week' });
    expect(bellGoOf({ kind: 'reports_tab', id: 'wait' }, ctx)).toEqual({
      kind: 'href',
      href: '/app/reports/waiting',
    });
    expect(bellGoOf({ kind: 'reports_tab', id: 'overdue' }, ctx)).toEqual({
      kind: 'href',
      href: '/app/reports/overdue',
    });
    // «Сроки на сегодня» руководителя с отчётами других сотрудников (п. Т-21) — «На неделе» без отбора по ответственному.
    expect(bellGoOf({ kind: 'reports_tab', id: 'week' }, ctx)).toEqual({
      kind: 'href',
      href: '/app/reports/week',
    });
    expect(bellGoOf({ kind: 'tasks_tab', id: 'mine' }, ctx)).toEqual({
      kind: 'href',
      href: '/app/tasks/mine',
    });
  });

  it('нет функции или права — «Запись удалена или больше вам не доступна»; незнакомое — только прочитана', () => {
    expect(bellGoOf({ kind: 'tasks_tab', id: 'mine' }, { ...ctx, tasks: false })).toEqual({
      kind: 'gone',
    });
    expect(bellGoOf({ kind: 'cp_sent', id: ID }, { ...ctx, contractors: false })).toEqual({
      kind: 'gone',
    });
    expect(bellGoOf({ kind: 'report', id: '../admin' }, ctx)).toBeNull();
    expect(bellGoOf({ kind: 'reports_tab', id: 'all' }, ctx)).toBeNull();
    expect(bellGoOf({ kind: 'something_new', id: ID }, ctx)).toBeNull();
    expect(bellGoOf(null, ctx)).toBeNull();
  });
});
