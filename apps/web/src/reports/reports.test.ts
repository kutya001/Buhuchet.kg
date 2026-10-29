import { defaultUiTexts } from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import type { ActionEntry, ActionItem } from '@buhuchet/ui';
import { describe, expect, it, vi } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import {
  amountText,
  dueMovedTitle,
  reportColumns,
  reportDefaultVisible,
  reportMark,
  reportMarkText,
  reportTone,
} from './report-columns';
import { reportMenuEntries, type ReportMenuAccess } from './report-menu';
import { isPlateFilter, monthEnd, plateFilters } from './report-plates';
import { reportTabCounts } from './reports-data';

// Список «Отчетов для сдачи» (задача 2.13; прототип modules/reports.js — reportCols, reportActions,
// repMark, renderReports): меню строки, отметки подтверждения, суммы, переносы срока, плашки.

const t = makeTranslate(defaultUiTexts());

const report = (over: Partial<ReportRow> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000100',
    contractor: { id: '00000000-0000-4000-8000-000000000001', name: 'ОсОО «Ала-Тоо Трейд»' },
    type: { code: 'nds', name: 'НДС', shortName: 'НДС' },
    act: 'both',
    periodLabel: '09.2026',
    periodFull: 'сентябрь 2026',
    revision: 0,
    dueDate: '2026-10-26',
    dueBase: '2026-10-25',
    dueManual: false,
    dueHoliday: '',
    status: 'todo',
    overdue: false,
    amount: null,
    amountAuto: false,
    waitDays: null,
    confirmedAt: null,
    confirmedBy: null,
    version: 1,
    ...over,
  }) as ReportRow;

const all: ReportMenuAccess = { repDue: true, changeStatus: true };

const menu = (r: ReportRow, access: ReportMenuAccess = all) => {
  const run = { due: vi.fn(), revision: vi.fn() };
  return { run, entries: reportMenuEntries({ t, access, run })(r) };
};
const items = (list: readonly ActionEntry[]) =>
  list.filter((x): x is ActionItem => !('separator' in x));
const labels = (list: readonly ActionEntry[]) => items(list).map((x) => x.label);

describe('reportMenuEntries', () => {
  it('у несданного отчёта со сдачей — «Изменить срок»; пункт открывает окно этого отчёта', () => {
    const r = report();
    const { run, entries } = menu(r);
    expect(labels(entries)).toEqual(['Изменить срок']);
    items(entries)[0]!.run();
    expect(run.due).toHaveBeenCalledWith(r);
  });

  it('без права «Изменять срок отчёта» пункт бледный с причиной', () => {
    const [due] = items(menu(report(), { repDue: false, changeStatus: true }).entries);
    expect(due).toMatchObject({ disabled: true, reason: 'Нужно право «Изменять срок отчёта»' });
  });

  it('у сданного — «Создать уточнённый», без права менять статус — бледный с причиной', () => {
    const r = report({ status: 'submitted' });
    const { run, entries } = menu(r);
    expect(labels(entries)).toEqual(['Создать уточнённый']);
    items(entries)[0]!.run();
    expect(run.revision).toHaveBeenCalledWith(r);
    const [locked] = items(menu(r, { repDue: true, changeStatus: false }).entries);
    expect(locked).toMatchObject({ disabled: true, reason: 'Нет права менять статус' });
  });

  it('у вида «Уплата» и у «Не требуется» пунктов сдачи нет', () => {
    expect(menu(report({ act: 'pay' })).entries).toEqual([]);
    expect(menu(report({ act: 'pay', status: 'submitted' })).entries).toEqual([]);
    expect(menu(report({ status: 'not_required' })).entries).toEqual([]);
  });
});

describe('отметка подтверждения сдачи', () => {
  it('только у сданного отчёта со сдачей и при подтверждении в учётной политике', () => {
    expect(reportMark(report({ status: 'submitted' }), false)).toBeNull();
    expect(reportMark(report({ status: 'in_progress' }), true)).toBeNull();
    expect(reportMark(report({ act: 'pay', status: 'submitted' }), true)).toBeNull();
    expect(reportMark(report({ status: 'submitted' }), true)).toBe('waiting');
    expect(reportMark(report({ status: 'submitted', confirmedAt: new Date() }), true)).toBe(
      'confirmed',
    );
  });

  it('«Ждёт подтверждения · N дн.» и «Подтвердил …»', () => {
    expect(reportMarkText(t, report({ status: 'submitted', waitDays: 4 }), true)).toBe(
      'Ждёт подтверждения · 4 дн.',
    );
    expect(
      reportMarkText(
        t,
        report({
          status: 'submitted',
          confirmedAt: new Date(),
          confirmedBy: { id: '00000000-0000-4000-8000-00000000000a', shortName: 'Мээрим К.' },
        }),
        true,
      ),
    ).toBe('Подтвердил Мээрим К.');
    expect(reportMarkText(t, report({ status: 'submitted' }), false)).toBe('');
  });
});

describe('строка отчёта', () => {
  it('сумма: у «Сдача» и у не указанной — пусто, иначе в сомах', () => {
    expect(amountText(report({ act: 'sub', amount: 500_000 }))).toBe('');
    expect(amountText(report({ amount: null }))).toBe('');
    expect(amountText(report({ amount: 125_050 }))).toMatch(/^1\s250,50$/);
  });

  it('подсказка у «перенос»: праздник, выходной или срок, изменённый вручную', () => {
    expect(
      dueMovedTitle(t, report({ dueHoliday: 'День независимости', dueBase: '2026-08-31' })),
    ).toBe('Перенесён с 31.08.2026: День независимости');
    expect(dueMovedTitle(t, report({ dueHoliday: '' }))).toBe(
      'Перенесён с 25.10.2026: выходной день',
    );
    expect(dueMovedTitle(t, report({ dueManual: true, dueHoliday: null }))).toBe(
      'Срок изменён вручную; по закону — 25.10.2026',
    );
  });

  it('просроченный — красным, «Не требуется» — приглушённо', () => {
    expect(reportTone(report({ overdue: true }))).toBe('overdue');
    expect(reportTone(report({ status: 'not_required' }))).toBe('muted');
    expect(reportTone(report())).toBeUndefined();
  });
});

describe('столбцы', () => {
  const keys = (o: Parameters<typeof reportColumns>[1]) => reportColumns(t, o).map((c) => c.key);
  const base = { waiting: false, confirm: true, waitDays: 3, phone: false };

  it('порядок прототипа: «Что сделать» сразу за видом отчёта; на ПК — отдельным столбцом', () => {
    const list = keys(base);
    expect(list.slice(0, 5)).toEqual(['cp', 'inn', 'taxOffice', 'type', 'act']);
    expect(list).toEqual(expect.arrayContaining(['confirm', 'confirmedOn']));
    expect(reportColumns(t, base).find((c) => c.key === 'act')?.desktopOnly).toBe(true);
  });

  it('«Ждёт, дней» и «Сдал» — только во вкладке «Ожидают подтверждения»; без подтверждения — без его столбцов', () => {
    expect(keys(base)).not.toContain('wait');
    const waiting = keys({ ...base, waiting: true });
    expect(waiting.indexOf('wait')).toBe(waiting.indexOf('status') + 1);
    expect(waiting.indexOf('submittedBy')).toBe(waiting.indexOf('status') + 2);
    expect(keys({ ...base, confirm: false })).not.toContain('confirm');
    expect(reportDefaultVisible(true)).toEqual([
      'cp',
      'type',
      'act',
      'period',
      'due',
      'status',
      'wait',
      'submittedBy',
      'amount',
      'responsible',
    ]);
  });

  it('«К уплате» — строкой сумм на плитке телефона, у вида «Сдача» строки нет', () => {
    const amount = reportColumns(t, { ...base, phone: true }).find((c) => c.key === 'amount')!;
    expect(amount.tileLine).toBeDefined();
    expect(amount.text(report({ act: 'sub' }))).toBe('');
  });
});

describe('плашки и счётчики', () => {
  it('«Сдано в этом месяце» — статус «Сдан» и дата сдачи в месяце; «К уплате» — срок оплаты в месяце', () => {
    expect(plateFilters('submitted', '2026-10-01')).toEqual({
      status: { type: 'enum', vals: ['submitted'] },
      submitted: { type: 'date', from: '2026-10-01', to: '2026-10-31' },
    });
    expect(plateFilters('to_pay', '2026-12-01')).toEqual({
      payDue: { type: 'date', from: '2026-12-01', to: '2026-12-31' },
    });
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(isPlateFilter('to_pay')).toBe(true);
    expect(isPlateFilter('overdue')).toBe(false);
  });

  it('у вкладок — «На неделе», «Просрочено» красным и «Ожидают подтверждения»; нулевых чисел нет', () => {
    expect(reportTabCounts({ week: 4, overdue: 53, waiting: 0 })).toEqual({
      week: { value: 4 },
      overdue: { value: 53, tone: 'red' },
      waiting: undefined,
    });
  });
});
