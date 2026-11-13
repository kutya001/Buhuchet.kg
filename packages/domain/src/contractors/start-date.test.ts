import { describe, expect, it } from 'vitest';
import { shiftedPeriodStart, startDateProblem, type StartDateFacts } from './start-date';

const facts = (patch: Partial<StartDateFacts> = {}): StartDateFacts => ({
  today: '2026-11-12',
  firstPeriodTo: null,
  paidMonth: null,
  report: null,
  ...patch,
});

describe('дата начала обслуживания: что мешает новой дате (прототип cpStartWhy)', () => {
  it('раньше и в пределах сегодняшнего дня — можно', () => {
    expect(startDateProblem('2024-07-16', facts())).toBeNull();
    expect(startDateProblem('2026-11-12', facts())).toBeNull();
  });

  it('позже сегодняшней и раньше 2000 года — нельзя', () => {
    expect(startDateProblem('2026-11-13', facts())).toEqual({ code: 'future' });
    expect(startDateProblem('1999-12-31', facts())).toEqual({ code: 'year' });
    expect(startDateProblem('2000-01-01', facts())).toBeNull();
  });

  it('не позже месяца, в котором закончился первый период обслуживания', () => {
    const f = facts({ firstPeriodTo: '2026-03' });
    expect(startDateProblem('2026-03-31', f)).toBeNull();
    expect(startDateProblem('2026-04-01', f)).toEqual({ code: 'period', month: '2026-03' });
  });

  it('не позже месяца первой оплаты обслуживания', () => {
    const f = facts({ paidMonth: '2026-05' });
    expect(startDateProblem('2026-05-31', f)).toBeNull();
    expect(startDateProblem('2026-06-01', f)).toEqual({ code: 'paid', month: '2026-05' });
  });

  it('не позже первого сданного отчёта; сданный в день начала не мешает', () => {
    const f = facts({ report: { name: 'НДС 05.2026', submittedOn: '2026-06-10' } });
    expect(startDateProblem('2026-06-10', f)).toBeNull();
    expect(startDateProblem('2026-06-11', f)).toEqual({
      code: 'report',
      name: 'НДС 05.2026',
      date: '2026-06-10',
    });
  });

  it('порядок проверок — как в прототипе: будущее, год, период, оплата, отчёт', () => {
    const f = facts({
      firstPeriodTo: '2026-03',
      paidMonth: '2026-02',
      report: { name: 'НДС 01.2026', submittedOn: '2026-02-10' },
    });
    expect(startDateProblem('2026-12-01', f)?.code).toBe('future');
    expect(startDateProblem('2026-04-01', f)?.code).toBe('period');
    expect(startDateProblem('2026-03-15', f)?.code).toBe('paid');
    expect(startDateProblem('2026-02-15', f)?.code).toBe('report');
    expect(startDateProblem('2026-02-10', f)).toBeNull();
  });
});

describe('начало первого периода после смены даты (прототип cpSetStart)', () => {
  it('сдвигается, если период начинался в месяце прежней даты', () => {
    expect(shiftedPeriodStart('2024-07', '2024-07-16', '2024-05-02')).toBe('2024-05');
    expect(shiftedPeriodStart('2024-07', '2024-07-16', '2024-09-01')).toBe('2024-09');
  });

  it('не меняется: тот же месяц, период начинался в другом месяце, периодов нет', () => {
    expect(shiftedPeriodStart('2024-07', '2024-07-16', '2024-07-01')).toBeNull();
    expect(shiftedPeriodStart('2024-08', '2024-07-16', '2024-05-02')).toBeNull();
    expect(shiftedPeriodStart(null, '2024-07-16', '2024-05-02')).toBeNull();
  });
});
