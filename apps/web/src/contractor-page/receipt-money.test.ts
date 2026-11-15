import { defaultUiTexts, type MonthPlanReport } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { reallocate } from '../money/receipt-preset';
import { feeReceiptNote, taxReceiptPreset, taxReceivedText } from './receipt-money-model';

// «Принять» у чека из Telegram (доработки 14.11.2026, блок 4, пункт 4, этап 2; прототип v115
// modules/cp-telegram.js: pgRcptMoney).

const t = makeTranslate(defaultUiTexts());
const LAST_MONTH = '2026-10';

type Row = MonthPlanReport & { type: { shortName: string }; receivedFor: number };

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  act: 'both',
  status: 'todo',
  period: 'M',
  periodStart: '2026-10-01',
  eventDate: null,
  dueDate: '2026-11-20',
  payDue: '2026-11-20',
  amount: 100_000,
  paid: 0,
  overdue: false,
  payOverdue: false,
  type: { shortName: 'НДС' },
  receivedFor: 0,
  ...over,
});
const sep = { periodStart: '2026-09-01', dueDate: '2026-10-20', payDue: '2026-10-20' } as const;

describe('чек за налоги: «Принять деньги» за месяц сообщения', () => {
  const rows = [
    row('nds-10', { amount: 300_000 }),
    row('sf-09', { ...sep, amount: 87_050, paid: 20_000, type: { shortName: 'Соцфонд' } }),
    row('nds-09', { ...sep, amount: 500_000, receivedFor: 100_000 }),
  ];

  it('только отчёты этого месяца, от раннего срока оплаты; общая сумма — из сообщения', () => {
    const preset = taxReceiptPreset(
      t,
      rows,
      { purpose: 'tax', month: '2026-09', amount: 450_000 },
      LAST_MONTH,
    );
    expect(preset).toEqual({
      list: [
        { reportId: 'nds-09', amount: 400_000 },
        { reportId: 'sf-09', amount: 67_050 },
      ],
      note: 'Деньги за сентябрь 2026 — по чеку из Telegram',
      total: 450_000,
    });
    // Окно разносит сумму сообщения по строкам: чего не хватило — у последней меньше.
    const alloc = reallocate({}, preset && 'list' in preset ? preset.list : [], '4500');
    // Сумма на экране — с неразрывным пробелом между разрядами: в сравнении — обычный.
    expect(Object.entries(alloc).map(([k, v]) => [k, v.replace(/\s/g, ' ')])).toEqual([
      ['nds-09', '4 000'],
      ['sf-09', '500'],
    ]);
  });

  it('суммы в сообщении нет — общая сумма по строкам', () => {
    expect(
      taxReceiptPreset(t, rows, { purpose: 'tax', month: '2026-10', amount: null }, LAST_MONTH),
    ).toEqual({
      list: [{ reportId: 'nds-10', amount: 300_000 }],
      note: 'Деньги за октябрь 2026 — по чеку из Telegram',
    });
  });

  it('деньги месяца уже получены или месяца нет — окна нет, сообщение «уже получены»', () => {
    const got = [row('nds-10', { amount: 300_000, receivedFor: 300_000 })];
    expect(
      taxReceiptPreset(t, got, { purpose: 'tax', month: '2026-10', amount: 1 }, LAST_MONTH),
    ).toBeNull();
    expect(
      taxReceiptPreset(t, rows, { purpose: 'tax', month: '2026-08', amount: 1 }, LAST_MONTH),
    ).toBeNull();
    expect(
      taxReceiptPreset(t, rows, { purpose: 'fee', month: '2026-10', amount: 1 }, LAST_MONTH),
    ).toBeNull();
    expect(taxReceivedText(t, '2026-10')).toBe(
      'Деньги на налоги за октябрь 2026 уже получены от контрагента',
    );
  });
});

describe('чек за обслуживание: примечание оплаты', () => {
  it('с месяцем начисления и без него (ручное напоминание о долге)', () => {
    expect(feeReceiptNote(t, { purpose: 'fee', month: '2026-11', amount: 300_000 })).toBe(
      'По чеку из Telegram за ноябрь 2026',
    );
    expect(feeReceiptNote(t, { purpose: 'fee', month: null, amount: 900_000 })).toBe(
      'По чеку из Telegram',
    );
  });
});
