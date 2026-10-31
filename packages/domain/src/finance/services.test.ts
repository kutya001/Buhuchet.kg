import { describe, expect, it } from 'vitest';
import {
  serviceChangesMoney,
  servicePaid,
  servicePaymentProblem,
  serviceProblems,
} from './services';

// Разовые услуги — как в прототипе (modules/services.js `serviceDlg`, `svcStatus`, `svcPay`;
// modules/fin-op.js `opMax` для `sp`).
describe('разовая услуга: получено и статус оплаты', () => {
  it('удалённые оплаты в «получено» не входят', () => {
    expect(
      servicePaid([
        { amount: 300_000, deleted: false },
        { amount: 200_000, deleted: true },
        { amount: 100_000, deleted: false },
      ]),
    ).toBe(400_000);
  });
});

describe('окно «Разовая услуга»', () => {
  it('новая: название, дата и стоимость больше нуля', () => {
    expect(serviceProblems({ name: ' ', date: '', amount: 0 })).toEqual([
      { field: 'name', problem: 'service_name_required' },
      { field: 'date', problem: 'service_date_required' },
      { field: 'amount', problem: 'service_amount_required' },
    ]);
    expect(serviceProblems({ name: 'Проверка учёта', date: '2026-10-01', amount: 1 })).toEqual([]);
  });

  it('изменение: стоимость не меньше уже полученного, причина — если меняются стоимость или дата', () => {
    const edit = { paid: 500_000, amount: 1_000_000, date: '2026-10-01', reason: '' };
    expect(
      serviceProblems({ name: 'Проверка', date: '2026-10-01', amount: 400_000 }, edit),
    ).toEqual([
      { field: 'amount', problem: 'service_amount_less', amount: 500_000 },
      { field: 'reason', problem: 'service_reason_required' },
    ]);
    // Только название и описание — без причины.
    expect(
      serviceProblems({ name: 'Другая', date: '2026-10-01', amount: 1_000_000 }, edit),
    ).toEqual([]);
    expect(
      serviceProblems(
        { name: 'Проверка', date: '2026-10-02', amount: 1_000_000 },
        { ...edit, reason: 'перенесли' },
      ),
    ).toEqual([]);
  });

  it('меняются стоимость или дата', () => {
    const prev = { amount: 100, date: '2026-10-01' };
    expect(serviceChangesMoney(prev, { amount: 100, date: '2026-10-01' })).toBe(false);
    expect(serviceChangesMoney(prev, { amount: 101, date: '2026-10-01' })).toBe(true);
    expect(serviceChangesMoney(prev, { amount: 100, date: '2026-10-02' })).toBe(true);
  });
});

describe('оплата разовой услуги', () => {
  it('больше нуля и не больше остатка', () => {
    expect(servicePaymentProblem(0, 100)).toEqual({ problem: 'op_amount_required' });
    expect(servicePaymentProblem(null, 100)).toEqual({ problem: 'op_amount_required' });
    expect(servicePaymentProblem(101, 100)).toEqual({ problem: 'service_pay_over', amount: 100 });
    expect(servicePaymentProblem(100, 100)).toBeNull();
  });
});
