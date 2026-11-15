import { defaultUiTexts } from '@buhuchet/domain';
import type { FeePaymentForm } from '@buhuchet/shared';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { feePayAmountHint, feePresetAllocation, feePresetSum } from './fee-pay-preset';

// «Принять оплату за обслуживание» по чеку из Telegram (доработки 14.11.2026, блок 4, пункт 4, этап 2;
// прототип v115 modules/contractor-card.js: feePayDlg с `pre`).

const t = makeTranslate(defaultUiTexts());

const form = (): FeePaymentForm => ({
  contractor: { id: '00000000-0000-4000-8000-000000000001', name: 'ОсОО «Ала-Тоо»' },
  debt: 1_200_000,
  advance: 0,
  unpaid: 1_800_000,
  amount: 1_200_000,
  // Порядок «От старых к новым» задаёт сервер — не порядок строк.
  months: [
    { month: '2026-10', charge: 600_000, got: 0, left: 600_000, overdue: false },
    { month: '2026-08', charge: 600_000, got: 0, left: 600_000, overdue: true },
    { month: '2026-09', charge: 600_000, got: 200_000, left: 400_000, overdue: true },
  ],
  order: ['2026-08', '2026-09', '2026-10'],
  allocation: [],
  to: [{ key: 'org', label: 'Организация', main: true }],
});

describe('«Принять оплату за обслуживание» по чеку', () => {
  it('сумма чека — только у новой оплаты и больше нуля', () => {
    expect(feePresetSum({ amount: 900_000, note: 'По чеку' }, false)).toBe(900_000);
    expect(feePresetSum({ amount: 900_000, note: 'По чеку' }, true)).toBeNull();
    expect(feePresetSum({ amount: null, note: 'По чеку' }, false)).toBeNull();
    expect(feePresetSum({ amount: 0, note: 'По чеку' }, false)).toBeNull();
    expect(feePresetSum(null, false)).toBeNull();
  });

  it('сумма чека разнесена от старых к новым, сколько осталось по месяцу', () => {
    expect(feePresetAllocation(form(), 900_000)).toEqual([
      { month: '2026-08', amount: 600_000 },
      { month: '2026-09', amount: 300_000 },
    ]);
    // Больше неоплаченного — остаток не разносится (аванс).
    expect(feePresetAllocation(form(), 2_000_000)).toEqual([
      { month: '2026-08', amount: 600_000 },
      { month: '2026-09', amount: 400_000 },
      { month: '2026-10', amount: 600_000 },
    ]);
  });

  it('подсказка у суммы: по чеку — из сообщения в Telegram, иначе — долг', () => {
    expect(feePayAmountHint(t, 900_000, 1_200_000)).toMatch(
      /^Подставлена сумма из сообщения в Telegram: 9\s000\sсом$/,
    );
    expect(feePayAmountHint(t, null, 1_200_000)).toMatch(
      /^Подставлен долг за обслуживание: 12\s000\sсом$/,
    );
    expect(feePayAmountHint(t, null, 0)).toBeUndefined();
  });
});
