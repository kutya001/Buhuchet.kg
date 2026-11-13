import { describe, expect, it } from 'vitest';
import {
  firstMonthEditable,
  isFirstTariff,
  tariffDeletable,
  tariffEditChanges,
  tariffEditProblems,
  type TariffEdit,
  type TariffEntry,
} from './tariffs';

/*
 * «Изменить ставку обслуживания» (прототип v86 modules/contractor-card.js `tariffEditDlg`): что можно
 * править, что мешает сохранить и когда ставку можно удалить.
 */

const first: TariffEntry = { id: 'a', amount: 1_400_000, period: 'M', from: '2026-09' };
const second: TariffEntry = { id: 'b', amount: 1_600_000, period: 'M', from: '2026-12' };
const journal = [second, first];
const START = '2026-09-22';
const TODAY = '2026-11-13';

const edit = (over: Partial<TariffEdit> = {}): TariffEdit => ({
  amount: 1_400_000,
  period: 'M',
  from: '2026-09',
  reason: 'ставку внесли с ошибкой',
  ...over,
});

describe('первая ставка и поле «Первый неполный месяц»', () => {
  it('первая — самая ранняя по «действует с», в каком бы порядке ни пришёл журнал', () => {
    expect(isFirstTariff(journal, 'a')).toBe(true);
    expect(isFirstTariff(journal, 'b')).toBe(false);
    expect(isFirstTariff([], 'a')).toBe(false);
  });

  it('поле есть у первой ставки «в месяц» с месяца начала, начатого не с 1-го числа', () => {
    expect(firstMonthEditable(journal, first, START)).toBe(true);
    // Не первая ставка.
    expect(firstMonthEditable(journal, second, START)).toBe(false);
    // Обслуживание начато с 1-го числа: неполного месяца нет.
    expect(firstMonthEditable(journal, first, '2026-09-01')).toBe(false);
    // Ставка действует не с месяца начала.
    expect(firstMonthEditable(journal, first, '2026-08-22')).toBe(false);
    // Годовая ставка.
    expect(firstMonthEditable([{ ...first, period: 'Y' }], { ...first, period: 'Y' }, START)).toBe(
      false,
    );
  });
});

describe('проверка окна', () => {
  it('без замечаний — пусто', () => {
    expect(tariffEditProblems(journal, first, edit({ amount: 0 }), START)).toEqual({});
  });

  it('сумма, месяц и причина обязательны — у каждого поля своя ошибка', () => {
    expect(
      tariffEditProblems(journal, first, edit({ amount: null, from: null, reason: '  ' }), START),
    ).toEqual({
      amount: 'amount_required',
      from: 'month_required',
      reason: 'edit_reason_required',
    });
    expect(tariffEditProblems(journal, first, edit({ amount: -1 }), START).amount).toBe(
      'amount_required',
    );
  });

  it('месяц другой ставки занят, свой прежний — нет', () => {
    expect(tariffEditProblems(journal, first, edit({ from: '2026-12' }), START).from).toBe(
      'edit_month_taken',
    );
    expect(tariffEditProblems(journal, second, edit({ from: '2026-12' }), START).from).toBe(
      undefined,
    );
  });

  it('первая ставка — не раньше месяца начала обслуживания; у остальных такого предела нет', () => {
    expect(tariffEditProblems(journal, first, edit({ from: '2026-08' }), START).from).toBe(
      'edit_before_start',
    );
    expect(tariffEditProblems(journal, first, edit({ from: '2026-10' }), START).from).toBe(
      undefined,
    );
    expect(tariffEditProblems(journal, second, edit({ from: '2026-08' }), START).from).toBe(
      undefined,
    );
  });
});

describe('что изменилось', () => {
  it('ничего — пустой список («Изменений нет»)', () => {
    expect(tariffEditChanges(first, edit(), 'full')).toEqual([]);
    expect(tariffEditChanges(first, edit({ firstMonth: 'full' }), 'full')).toEqual([]);
  });

  it('сумма, периодичность, месяц и правило первого месяца — по порядку окна', () => {
    expect(
      tariffEditChanges(
        first,
        edit({ amount: 1_500_000, period: 'Y', from: '2026-10', firstMonth: 'prorate' }),
        'full',
      ),
    ).toEqual(['amount', 'period', 'from', 'firstMonth']);
  });

  it('правило первого месяца не считается, когда поля в окне нет', () => {
    expect(tariffEditChanges(first, edit({ amount: 1 }), 'prorate')).toEqual(['amount']);
  });
});

describe('удаление ставки', () => {
  it('можно, пока ставка не начала действовать и в журнале есть другая', () => {
    expect(tariffDeletable(journal, second, TODAY)).toBe(true);
  });

  it('нельзя: ставка действует с текущего или прошлого месяца', () => {
    expect(tariffDeletable(journal, first, TODAY)).toBe(false);
    expect(tariffDeletable(journal, { ...second, from: '2026-11' }, TODAY)).toBe(false);
  });

  it('нельзя: ставка в журнале одна', () => {
    expect(tariffDeletable([second], second, TODAY)).toBe(false);
  });
});
