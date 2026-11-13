import { describe, expect, it } from 'vitest';
import {
  bonusBalance,
  bonusOutProblems,
  serviceBonusEditBlock,
  serviceBonusOn,
  serviceBonusProblem,
  serviceBonusTotal,
} from './bonus';

// Прототип v84 и v87 (modules/services.js: svcBonusOn, bonusSum, serviceDlg, bonusOutDlg).
describe('бонусы сотрудников', () => {
  const pay = (amount: number, date: string, deleted = false) => ({ amount, date, deleted });

  it('бонус за услугу начисляется датой последней оплаты, когда услуга оплачена полностью', () => {
    expect(serviceBonusOn(300_000, [])).toBeNull();
    expect(serviceBonusOn(300_000, [pay(100_000, '2026-10-01')])).toBeNull();
    expect(serviceBonusOn(300_000, [pay(100_000, '2026-10-20'), pay(200_000, '2026-10-06')])).toBe(
      '2026-10-20',
    );
    // Удалённая оплата не в счёт: услуга снова ждёт оплаты.
    expect(
      serviceBonusOn(300_000, [pay(100_000, '2026-10-01'), pay(200_000, '2026-10-06', true)]),
    ).toBeNull();
    expect(serviceBonusOn(0, [pay(100, '2026-10-01')])).toBeNull();
  });

  it('строки бонусов: сотрудник и сумма в каждой, без повторов, в сумме не больше стоимости', () => {
    const line = (employeeId: string | null, amount: number | null) => ({ employeeId, amount });
    expect(serviceBonusProblem([], 100)).toBeNull();
    expect(serviceBonusProblem([line(null, 100)], 1000)).toEqual({
      problem: 'bonus_employee_required',
    });
    expect(serviceBonusProblem([line('a', null)], 1000)).toEqual({
      problem: 'bonus_amount_required',
    });
    expect(serviceBonusProblem([line('a', 0)], 1000)).toEqual({ problem: 'bonus_amount_required' });
    expect(serviceBonusProblem([line('a', 1.5)], 1000)).toEqual({
      problem: 'bonus_amount_required',
    });
    expect(serviceBonusProblem([line('a', 100), line('a', 200)], 1000)).toEqual({
      problem: 'bonus_employee_twice',
    });
    expect(serviceBonusProblem([line('a', 600), line('b', 500)], 1000)).toEqual({
      problem: 'bonus_over_cost',
      amount: 1100,
    });
    expect(serviceBonusProblem([line('a', 600), line('b', 400)], 1000)).toBeNull();
    // Стоимость не введена — её отказ покажет своё поле.
    expect(serviceBonusProblem([line('a', 600)], null)).toBeNull();
    expect(serviceBonusTotal([{ amount: 600 }, { amount: 400 }])).toBe(1000);
  });

  it('остаток бонусов: из остатков контрагентов и за услуги минус списано; ожидающее не входит', () => {
    expect(bonusBalance({ cp: 500, svc: 300, wait: 900, out: 200 })).toEqual({
      cp: 500,
      svc: 300,
      wait: 900,
      out: 200,
      bal: 600,
    });
  });

  it('правка услуги не уводит уже списанный бонус в минус', () => {
    const prev = [
      { employeeId: 'a', amount: 1000 },
      { employeeId: 'b', amount: 500 },
    ];
    const bal: Record<string, number> = { a: 400, b: 500 };
    const balanceOf = (id: string) => bal[id] ?? 0;
    // Бонус не был начислен — менять можно как угодно.
    expect(
      serviceBonusEditBlock({ was: false, will: false, prev, next: [], balanceOf }),
    ).toBeNull();
    // Уменьшили на 400 — остатка хватает; на 500 — нет.
    expect(
      serviceBonusEditBlock({
        was: true,
        will: true,
        prev,
        next: [{ employeeId: 'a', amount: 600 }, prev[1]!],
        balanceOf,
      }),
    ).toBeNull();
    expect(
      serviceBonusEditBlock({
        was: true,
        will: true,
        prev,
        next: [{ employeeId: 'a', amount: 500 }, prev[1]!],
        balanceOf,
      }),
    ).toEqual({ employeeId: 'a', balance: 400, variant: 'less' });
    // Строку убрали совсем.
    expect(
      serviceBonusEditBlock({ was: true, will: true, prev, next: [prev[0]!], balanceOf }),
    ).toBeNull();
    bal.b = 100;
    expect(
      serviceBonusEditBlock({ was: true, will: true, prev, next: [prev[0]!], balanceOf }),
    ).toEqual({ employeeId: 'b', balance: 100, variant: 'less' });
    // Стоимость подняли: услуга перестанет быть оплаченной, бонус уйдёт в ожидание.
    expect(serviceBonusEditBlock({ was: true, will: false, prev, next: prev, balanceOf })).toEqual({
      employeeId: 'a',
      balance: 400,
      variant: 'wait',
    });
    // Бонус только начнёт начисляться — остаток растёт.
    expect(serviceBonusEditBlock({ was: false, will: true, prev, next: [], balanceOf })).toBeNull();
  });

  it('«Списать бонус»: сумма не больше остатка, дата не позже сегодняшней, основание обязательно', () => {
    const ctx = { balance: 1000, today: '2026-11-13' };
    expect(bonusOutProblems({ amount: 1000, date: '2026-11-13', note: 'Выдано' }, ctx)).toEqual([]);
    expect(bonusOutProblems({ amount: null, date: '', note: '  ' }, ctx)).toEqual([
      { field: 'amount', problem: 'bonus_out_amount_required' },
      { field: 'date', problem: 'bonus_out_date_required' },
      { field: 'note', problem: 'bonus_out_note_required' },
    ]);
    expect(bonusOutProblems({ amount: 1001, date: '2026-11-14', note: 'x' }, ctx)).toEqual([
      { field: 'amount', problem: 'bonus_out_over', amount: 1000 },
      { field: 'date', problem: 'bonus_out_date_future' },
    ]);
  });
});
