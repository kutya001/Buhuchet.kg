import { describe, expect, it } from 'vitest';
import type { ReportAct } from '../platform-dicts/catalog';
import { calendarKindOf, productionCalendar } from '../platform-dicts/calendar';
import fixture from './__fixtures__/tax.json';
import {
  contractorMoney,
  fundsBalance,
  leftToPay,
  monthReconciliation,
  noFreeBalanceReason,
  paymentDefaults,
  paymentOverdue,
  paymentProblem,
  paymentProblemText,
  paymentSchedule,
  paymentStatus,
  payOnlyReportStatus,
  scheduleDues,
  schedulePayDue,
  submitNeedsPayment,
  submitPaymentReason,
  type MoneyOpKind,
  type TaxReport,
} from './tax';

// Эталон — прототип (scripts/oracle-money.mjs): derive, schedule, subNeedPay, subPayWhy, payDlg на
// отчётах и операциях demoDB.json и на том же наборе с правками. Строки эталона — поля через «|».
const calendar = productionCalendar([
  ...Object.entries(fixture.holidays).map(([day, name]) => ({
    day,
    name,
    kind: calendarKindOf(name, false),
  })),
  ...fixture.workingSaturdays.map((day) => ({ day, name: '', kind: calendarKindOf('', true) })),
]);
const installments = fixture.installments as unknown as Record<string, [number, number][]>;
const cell = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : v);
const row = (...a: (number | string | boolean | null | undefined)[]) =>
  a.map((v) => (v === true ? 1 : v === false ? 0 : cell(v))).join('|');
const num = (s: string) => (s === '' ? null : Number(s));

interface Report extends TaxReport {
  contractorId: string;
  type: string;
  year: number;
  due: string;
}

type Dataset = (typeof fixture.datasets)[number];

function load(d: Dataset) {
  const reports: Report[] = d.reports.map((line) => {
    const [id, cp, type, year, act, status, sum, paid, self, received, superseded, due] =
      line.split('|') as string[];
    return {
      id: id!,
      contractorId: cp!,
      type: type!,
      year: Number(year),
      act: act as ReportAct,
      status: status!,
      sum: num(sum!),
      paid: Number(paid),
      selfPaid: Number(self),
      received: Number(received),
      superseded: superseded === '1',
      due: due!,
      payDue: due!,
    };
  });
  const ruleDues = d.expected.ruleDues as Record<string, string>;
  const parts = new Map(
    reports.map((r) => {
      if (r.act === 'sub') return [r.id, []];
      const dues = scheduleDues(installments[r.type] ?? null, r.year, ruleDues[r.id]!, calendar);
      return [r.id, paymentSchedule(r.sum, r.paid, dues)];
    }),
  );
  for (const r of reports) if (r.act !== 'sub') r.payDue = schedulePayDue(parts.get(r.id)!, r.due);
  const ops = d.ops.map((line) => {
    const [cp, kind, amount, self] = line.split('|') as string[];
    return { cp: cp!, kind: kind as MoneyOpKind, amount: Number(amount), self: self === '1' };
  });
  const contractors = d.expected.contractors.map((line) => {
    const [id, , , status] = line.split('|') as string[];
    return { id: id!, paused: status === 'Приостановлен' };
  });
  const money = new Map(
    contractors.map((c) => {
      const available = fundsBalance(ops.filter((o) => o.cp === c.id));
      return [
        c.id,
        contractorMoney(
          available,
          reports.filter((r) => r.contractorId === c.id),
        ),
      ];
    }),
  );
  const paused = new Map(contractors.map((c) => [c.id, c.paused]));
  return { reports, parts, contractors, money, paused };
}

describe.each(fixture.datasets)('$name — как в прототипе', (d) => {
  const { reports, parts, contractors, money, paused } = load(d);
  const today = d.expected.today;
  const moneyOf = (r: Report) => money.get(r.contractorId)!.reports.get(r.id)!;

  it('деньги контрагента на счетах и свободный остаток', () => {
    expect(
      contractors.map((c) => {
        const m = money.get(c.id)!;
        return row(c.id, m.available, m.free);
      }),
    ).toEqual(d.expected.contractors.map((line) => line.split('|').slice(0, 3).join('|')));
  });

  it('график оплаты у видов с оплатой долями', () => {
    const got = Object.fromEntries(
      reports
        .filter((r) => parts.get(r.id)!.length > 1)
        .map((r) => [r.id, parts.get(r.id)!.map((x) => row(x.due, x.amount, x.paid))]),
    );
    expect(got).toEqual(d.expected.schedules);
  });

  it('по отчёту: статус, оплата, срок оплаты, получено, отложено, сверка, просрочка', () => {
    const got = reports.map((r) => {
      const m = moneyOf(r);
      const f = m.funds;
      return row(
        r.id,
        r.act === 'pay' ? payOnlyReportStatus(r) : r.status,
        paymentStatus(r),
        r.act === 'sub' ? null : r.payDue,
        m.received,
        m.reserved,
        f?.state,
        f && f.state !== 'paid' ? f.need : null,
        f?.state === 'short' ? f.short : null,
        paymentOverdue(r, today, paused.get(r.contractorId)!),
      );
    });
    expect(got).toEqual(d.expected.reports);
  });

  it.each(d.expected.later)(
    'просрочка оплаты на $today',
    ({ today: date, paused: off, overdue }) => {
      const got = reports
        .filter((r) => paymentOverdue(r, date, off.includes(r.contractorId)))
        .map((r) => r.id);
      expect(got).toEqual(overdue);
    },
  );

  it('«Сдан» только после оплаты: при сумме отчёта, 4 000 сом и 0', () => {
    const got = reports
      .filter((r) => r.act !== 'sub')
      .map((r) =>
        row(
          r.id,
          ...[r.sum, 400000, 0].map((s) => submitNeedsPayment(r, true, s)),
          submitPaymentReason(r, true),
        ),
      );
    expect(got).toEqual(d.expected.submit);
  });

  it('окно «Отметить оплаченным»: сумма по умолчанию, «Оплатил сам», ошибки суммы', () => {
    const open = reports.filter(
      (r) => r.act !== 'sub' && (r.sum ?? 0) > 0 && r.paid < r.sum! && r.status !== 'not_required',
    );
    const got = open.map((r) => {
      const m = moneyOf(r);
      const available = money.get(r.contractorId)!.available;
      const def = paymentDefaults(r, parts.get(r.id)!, m.funds);
      const err = (n: number, self: boolean) => {
        const p = paymentProblem(n, self, m.funds, available);
        return p ? paymentProblemText(p, m.funds, available) : '';
      };
      return [
        row(r.id, def.amount, def.self),
        ...[0, 100, available + 100].map((n) => row(n, err(n, false), err(n, true))),
      ];
    });
    expect(got).toEqual(d.expected.pay);
  });

  it('вкладка «Деньги»: сверка по сроку оплаты до конца месяца и причина «Свободного остатка нет»', () => {
    const got = d.expected.reconciliation.map((line) => {
      const [id, monthEnd] = line.split('|') as [string, string];
      const m = money.get(id)!;
      const x = monthReconciliation(
        m,
        reports.filter((r) => r.contractorId === id),
        monthEnd,
      );
      const v = x.verdict;
      const diff = v.state === 'short' ? -v.amount : v.state === 'enough' ? 0 : v.amount;
      return row(
        id,
        monthEnd,
        x.due.join(','),
        x.dueSum,
        x.later.join(','),
        x.laterSum,
        diff,
        noFreeBalanceReason(m),
      );
    });
    expect(got).toEqual(d.expected.reconciliation);
  });
});

describe('правила ТЗ на коротких примерах', () => {
  const base: TaxReport = {
    id: '1',
    act: 'both',
    status: 'todo',
    sum: 500000,
    paid: 0,
    selfPaid: 0,
    received: 0,
    superseded: false,
    payDue: '2026-10-25',
  };

  it('п. 69: НДС 5 000 сом без оплаты — «Сдан» нельзя; после оплаты 3 000 сом — можно; статистика — сразу', () => {
    expect(submitNeedsPayment(base, true)).toBe(true);
    expect(submitPaymentReason(base, true)).toBe(
      'Сначала оплатите налог: к уплате 5\u00a0000\u00a0сом, оплачено 0\u00a0сом',
    );
    expect(submitNeedsPayment({ ...base, paid: 300000 }, true)).toBe(false);
    expect(paymentStatus({ ...base, paid: 300000 })).toBe('partial');
    expect(submitNeedsPayment({ ...base, act: 'sub', sum: null }, true)).toBe(false);
    expect(submitNeedsPayment(base, false)).toBe(false);
  });

  it('п. 72: суммы ещё нет — окно «Сдан» открывается; введённая сумма без оплаты не даёт «Сдан»', () => {
    const noSum = { ...base, sum: null };
    expect(submitNeedsPayment(noSum, true)).toBe(false);
    expect(submitNeedsPayment(noSum, true, 400000)).toBe(true);
    expect(submitNeedsPayment(noSum, true, 0)).toBe(false);
  });

  it('п. 73: денег контрагента 1 000 из 5 000 — «Оплатил сам» включён; сам — остаток не меняется', () => {
    const m = contractorMoney(100000, [base]);
    const funds = m.reports.get('1')!.funds;
    expect(funds).toEqual({ state: 'short', need: 500000, short: 400000 });
    expect(paymentDefaults(base, paymentSchedule(500000, 0, ['2026-10-25']), funds)).toEqual({
      amount: 500000,
      self: true,
    });
    expect(paymentProblem(500000, true, funds, 100000)).toBeNull();
    expect(paymentProblem(500000, false, funds, 100000)).toBe('not_enough');
    const after = { ...base, paid: 500000, selfPaid: 500000 };
    const ops = [
      { kind: 'in' as const, amount: 100000 },
      { kind: 'pay' as const, amount: 500000, self: true },
    ];
    expect(fundsBalance(ops)).toBe(100000);
    const m2 = contractorMoney(fundsBalance(ops), [after]);
    expect(m2.reports.get('1')).toEqual({ funds: { state: 'paid' }, received: 0, reserved: 0 });
    expect(m2.free).toBe(100000);
    expect(paymentStatus(after)).toBe('paid');
  });

  it('деньги, принятые под отчёт, идут на него; свободный остаток — по сроку оплаты', () => {
    const late = { ...base, id: 'late', payDue: '2026-12-01', received: 200000 };
    const early = { ...base, id: 'early', payDue: '2026-11-01' };
    const m = contractorMoney(300000, [late, early]);
    expect(m.reports.get('late')).toMatchObject({ reserved: 200000, received: 200000 });
    expect(m.reports.get('early')).toMatchObject({ received: 100000 });
    expect(m.reports.get('early')!.funds).toEqual({ state: 'short', need: 500000, short: 400000 });
    expect(m.reports.get('late')!.funds).toEqual({ state: 'short', need: 500000, short: 300000 });
    expect(m.free).toBe(0);
  });

  it('график долями: равные доли, округлённые до 10 сом, остаток — в последнем', () => {
    expect(paymentSchedule(1000000, 300000, ['2026-03-20', '2026-06-22', '2026-09-21'])).toEqual([
      { due: '2026-03-20', amount: 333000, paid: 300000 },
      { due: '2026-06-22', amount: 333000, paid: 0 },
      { due: '2026-09-21', amount: 334000, paid: 0 },
    ]);
    expect(paymentSchedule(null, 0, ['2026-03-20'])).toEqual([
      { due: '2026-03-20', amount: 0, paid: 0 },
    ]);
    expect(schedulePayDue([], '2026-01-01')).toBe('2026-01-01');
  });

  it('«Уплата» сдана, когда оплачена полностью; «Осталось оплатить» не меньше 0', () => {
    expect(payOnlyReportStatus({ status: 'todo', sum: 500000, paid: 500000 })).toBe('submitted');
    expect(payOnlyReportStatus({ status: 'submitted', sum: 500000, paid: 100 })).toBe('todo');
    expect(payOnlyReportStatus({ status: 'not_required', sum: 1, paid: 0 })).toBe('not_required');
    expect(leftToPay({ sum: 500000, paid: 600000 })).toBe(0);
    expect(leftToPay({ sum: null, paid: 0 })).toBe(0);
  });

  it('просрочки оплаты нет у приостановленного контрагента и у заменённой версии', () => {
    expect(paymentOverdue(base, '2026-10-26', false)).toBe(true);
    expect(paymentOverdue(base, '2026-10-25', false)).toBe(false);
    expect(paymentOverdue(base, '2026-10-26', true)).toBe(false);
    expect(paymentOverdue({ ...base, superseded: true }, '2026-10-26', false)).toBe(false);
  });

  it('сверка за месяц: деньги, отложенные под поздний срок, не считаются излишком', () => {
    const now = { ...base, id: 'now', sum: 300000, payDue: '2026-10-25' };
    const late = { ...base, id: 'late', payDue: '2026-12-01', received: 200000 };
    const m = contractorMoney(600000, [late, now]);
    expect(monthReconciliation(m, [late, now], '2026-10-31')).toEqual({
      due: ['now'],
      dueSum: 300000,
      available: 600000,
      later: ['late'],
      laterSum: 200000,
      verdict: { state: 'enough_surplus', amount: 100000 },
    });
    expect(monthReconciliation(m, [late, now], '2026-12-31').verdict).toEqual({
      state: 'short',
      amount: 200000,
    });
    const paidUp = { ...now, paid: 300000 };
    expect(
      monthReconciliation(contractorMoney(200000, [paidUp]), [paidUp], '2026-10-31').verdict,
    ).toEqual({
      state: 'surplus',
      amount: 200000,
    });
    expect(
      monthReconciliation(contractorMoney(300000, [now]), [now], '2026-10-31').verdict,
    ).toEqual({
      state: 'enough',
    });
    expect(noFreeBalanceReason(m)).toBe(
      'Свободного остатка нет: 6 000 сом нужны на неоплаченные налоги',
    );
    expect(noFreeBalanceReason({ available: -100, free: -100 })).toBe(
      'Свободного остатка нет: денег контрагента на счёте нет',
    );
    expect(noFreeBalanceReason({ available: 100, free: 100 })).toBe('');
  });

  it('тексты ошибок оплаты', () => {
    expect(paymentProblem(0, true, null, 0)).toBe('amount_required');
    expect(paymentProblemText('amount_required', null, 0)).toBe('Введите сумму больше нуля');
    expect(paymentProblemText('not_enough', { state: 'enough', need: 1 }, 50000)).toBe(
      'Денег контрагента на этот отчёт не хватает: доступно 500\u00a0сом. Примите деньги или отметьте «Оплатил контрагент сам»',
    );
    expect(paymentProblemText('not_enough', { state: 'paid' }, 0)).toBe(
      'Денег контрагента на этот отчёт не хватает. Примите деньги или отметьте «Оплатил контрагент сам»',
    );
  });
});
