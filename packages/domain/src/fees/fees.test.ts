import { describe, expect, it } from 'vitest';
import { formatDateRu } from '../common/dates';
import { formatSomWithUnit, parseSom } from '../common/money';
import { monthLabelGen } from '../common/months';
import type { FirstMonthMode, TariffPeriod } from '../contractors/rules';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/fees.json';
import { FEE_WHATSAPP_TEMPLATE, feeWhatsAppText } from './reminder';
import {
  canAcceptFeePayment,
  contractorFees,
  feeCharge,
  feeDue,
  feeMonths,
  feeReminder,
  type FeeContractor,
  type FeePayment,
} from './charges';
import {
  allocationBalance,
  allocationRowState,
  allocationText,
  autoAllocate,
  feePaymentErrorCode,
  feePaymentForm,
  feePaymentProblem,
  savedAllocation,
  type Allocation,
} from './payment';
import {
  currentTariff,
  tariffDefaults,
  tariffErrorCode,
  tariffProblem,
  type Tariff,
} from './tariffs';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
/** Неразрывные пробелы в суммах — обычными, как в тексте прототипа. */
const plain = (s: string) => s.replace(/\u00a0/g, ' ');
const tariffErr = (p: Parameters<typeof tariffErrorCode>[0]) => t(`err.${tariffErrorCode(p)}`);
/** Запись истории новой ставки (прототип `tariffDlg`: «Новая ставка … с …»). */
const tariffLog = (x: Tariff) =>
  t('fee.hist.tariff', {
    amount: formatSomWithUnit(x.amount),
    per: t(x.period === 'Y' ? 'fee.tariffs.per_year' : 'fee.tariffs.per_month'),
    month: monthLabelGen(x.from),
  });

// Эталон — прототип (scripts/oracle-fees.mjs): плата за обслуживание на контрагентах и оплатах
// demoDB.json и на том же наборе с правками, на две даты. Строки эталона — поля через «|».

interface Payment extends FeePayment {
  id: string;
  contractorId: string;
  date: string;
  to: string;
}

type Dataset = (typeof fixture.datasets)[number];

const cell = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : v);
const row = (...a: (number | string | boolean | null | undefined)[]) =>
  a.map((v) => (v === true ? 1 : v === false ? 0 : cell(v))).join('|');
const allocText = (a: Allocation) => a.map((x) => `${x.month}:${x.amount}`).join(',');
const som = (s: string | number) => parseSom(String(s))!;

function load(d: Dataset) {
  const contractors = new Map<string, FeeContractor & { archived: boolean }>();
  for (const line of d.contractors) {
    const [id, oneOff, start, createdOn, feeDay, first, archived] = line.split('|') as string[];
    contractors.set(id!, {
      oneOff: oneOff === '1',
      start: start!,
      createdOn: createdOn!,
      feeDay: Number(feeDay),
      firstMonth: first as FirstMonthMode,
      periods: [],
      tariffs: [],
      archived: archived === '1',
    });
  }
  for (const line of d.periods) {
    const [id, from, to] = line.split('|') as string[];
    (contractors.get(id!)!.periods as { from: string; to: string | null }[]).push({
      from: from!,
      to: to || null,
    });
  }
  for (const line of d.tariffs) {
    const [id, amount, period, from] = line.split('|') as string[];
    (contractors.get(id!)!.tariffs as Tariff[]).push({
      amount: Number(amount),
      period: period as TariffPeriod,
      from: from!,
    });
  }
  const payments: Payment[] = d.payments
    .map((line) => line.split('|') as string[])
    .filter((p) => p[6] !== '1')
    .map(([id, cp, amount, alloc, date, to]) => ({
      id: id!,
      contractorId: cp!,
      amount: Number(amount),
      allocation: alloc
        ? alloc.split(',').map((x) => {
            const [month, a] = x.split(':') as [string, string];
            return { month, amount: Number(a) };
          })
        : [],
      date: date!,
      to: to!,
    }));
  const paymentsOf = (id: string) => payments.filter((p) => p.contractorId === id);
  return { contractors, payments, paymentsOf };
}

describe.each(fixture.datasets)('$name — как в прототипе', (d) => {
  const { contractors, paymentsOf } = load(d);
  const today = d.today;
  const fees = new Map(
    [...contractors].map(([id, c]) => [id, contractorFees(c, paymentsOf(id), today)]),
  );

  it('долг, аванс, «Принять оплату за обслуживание», текущая ставка', () => {
    expect(
      [...contractors].map(([id, c]) => {
        const f = fees.get(id)!;
        return row(
          id,
          f.debt,
          f.advance,
          canAcceptFeePayment(c, c.archived, f),
          currentTariff(c.tariffs, today)?.amount,
        );
      }),
    ).toEqual(d.expected.contractors);
  });

  it('начисления по месяцам: начислено, оплачено, из аванса, срок оплаты, статус, просрочено', () => {
    const got = [...contractors].flatMap(([id]) =>
      fees
        .get(id)!
        .months.map((m) =>
          row(id, m.month, m.charge, m.paid, m.fromAdvance, m.due, m.status, m.overdue),
        ),
    );
    expect(got).toEqual(d.expected.months);
  });

  it('напоминание о долге в WhatsApp: месяцы долга, сумма, «оплатить до»', () => {
    const got = [...contractors]
      .filter(([id]) => fees.get(id)!.debt > 0)
      .map(([id, c]) => {
        const r = feeReminder(fees.get(id)!, c.feeDay, today);
        return row(id, r.months.join(','), r.amount, formatDateRu(r.payBy));
      });
    expect(got).toEqual(d.expected.reminders);
  });

  it('окно «Новая ставка»: что подставлено, запись истории, ошибки суммы и месяца', () => {
    const got = [...contractors].map(([id, c]) => {
      const def = tariffDefaults(c.tariffs, today, t);
      const sumErr = (n: number | null) => {
        const p = tariffProblem(c.tariffs, n, def.from, today);
        return p === 'amount_required' ? tariffErr(p) : '';
      };
      const months = [
        addMonth(today, -1),
        today.slice(0, 7),
        def.from,
        ...c.tariffs.map((t) => t.from),
        '',
      ];
      return [
        row(
          id,
          def.amount,
          def.period,
          def.note,
          tariffLog({ amount: 4000000, period: 'M', from: def.from }),
          sumErr(null),
          sumErr(-100),
          sumErr(0),
        ),
        ...months.map((m) => {
          const p = tariffProblem(c.tariffs, 0, m || null, today);
          return row(m, p ? tariffErr(p) : '');
        }),
      ];
    });
    expect(got).toEqual(d.expected.tariffs);
  });

  it.each(d.expected.dialogs)('окно «Принять оплату»: контрагент $id', (dlg) => {
    const id = String(dlg.id);
    const c = contractors.get(id)!;
    const form = feePaymentForm(c, paymentsOf(id), fees.get(id)!.debt, today);
    expect(row(form.unpaid, form.amount, allocText(form.allocation))).toBe(dlg.head);
    expect(form.months.map((m) => row(m.month, m.charge, m.got, m.left, m.overdue))).toEqual(
      dlg.months,
    );
    const order = form.order.map((m) => form.months.find((r) => r.month === m)!);
    const totals = [form.amount, som(1000), (form.amount ?? 0) + som(5000)];
    expect(
      totals.map((amount) => {
        const total = amount ?? 0;
        const a = autoAllocate(order, total);
        const amountOf = (m: string) => a.find((x) => x.month === m)?.amount ?? 0;
        return row(
          amount,
          allocText(a),
          allocationBalance(total, a)?.state,
          ...form.months.map((m) => allocationRowState(m, amountOf(m.month))),
        );
      }),
    ).toEqual(dlg.auto);
    const first = form.months[0];
    const err = (amount: string, allocation: Allocation, date: string) => {
      const p = feePaymentProblem(form.months, som(amount), allocation, date || null, today);
      const text = p
        ? t(`err.${feePaymentErrorCode(p.problem)}`, { amount: formatSomWithUnit(p.over ?? 0) })
        : '';
      return row(p?.field === 'amount' ? text : '', p?.field === 'date' ? text : '');
    };
    expect([
      err('0', [], today),
      err('100', first ? [{ month: first.month, amount: first.left + som(10) }] : [], today),
      err(
        '100',
        first ? [{ month: first.month, amount: Math.min(first.left, som(150)) }] : [],
        today,
      ),
      err('100', [], ''),
      err('100', [], addDay(today, 1)),
    ]).toEqual(dlg.errors);
    const total = form.amount ?? 0;
    const what = allocationText(t, total, savedAllocation(form.allocation));
    expect(t('fee.hist.payment', { amount: formatSomWithUnit(total), what })).toBe(dlg.log);
  });

  it.each(d.expected.edits)('окно «Изменить оплату»: оплата $payment', (e) => {
    const id = String(e.id);
    const c = contractors.get(id)!;
    const payments = paymentsOf(id);
    const edit = payments.find((p) => p.id === e.payment)!;
    const form = feePaymentForm(c, payments, fees.get(id)!.debt, today, edit);
    expect(row(form.unpaid, form.amount, allocText(form.allocation), form.order.join(','))).toBe(
      e.head,
    );
    expect(form.months.map((m) => row(m.month, m.charge, m.got, m.left))).toEqual(e.months);
    // Тексты изменений («сумма … → …», причина) — у окна оплаты в «Финансовых операциях» (задача 2.22).
  });
});

function addMonth(date: string, n: number) {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const total = y * 12 + m - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function addDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('правила ТЗ на коротких примерах', () => {
  const base: FeeContractor = {
    oneOff: false,
    start: '2026-10-22',
    createdOn: '2026-10-22',
    feeDay: 10,
    firstMonth: 'prorate',
    periods: [{ from: '2026-10', to: null }],
    tariffs: [{ amount: 3100000, period: 'M', from: '2026-10' }],
  };

  it('первый неполный месяц: 31 000 сом с 22 октября пропорционально — 10 000 сом; полный; со следующего', () => {
    expect(feeCharge(base, '2026-10')).toBe(1000000);
    expect(feeCharge({ ...base, firstMonth: 'full' }, '2026-10')).toBe(3100000);
    expect(feeCharge({ ...base, firstMonth: 'next' }, '2026-10')).toBe(0);
    expect(feeCharge(base, '2026-11')).toBe(3100000);
    expect(feeCharge({ ...base, start: '2026-10-01' }, '2026-10')).toBe(3100000);
  });

  it('смена ставки: прошлые месяцы по старой, с месяца новой — по новой; годовая — раз в год', () => {
    const c = {
      ...base,
      start: '2026-01-01',
      tariffs: [
        { amount: 3000000, period: 'M' as const, from: '2026-01' },
        { amount: 4000000, period: 'M' as const, from: '2026-09' },
      ],
    };
    expect(feeCharge(c, '2026-08')).toBe(3000000);
    expect(feeCharge(c, '2026-09')).toBe(4000000);
    const y = { ...c, tariffs: [{ amount: 9600000, period: 'Y' as const, from: '2026-01' }] };
    expect(feeCharge(y, '2026-01')).toBe(9600000);
    expect(feeCharge(y, '2026-02')).toBe(0);
    expect(feeCharge(y, '2027-01')).toBe(9600000);
    expect(feeCharge({ ...c, tariffs: [] }, '2026-05')).toBe(0);
  });

  it('срок первого месяца не раньше начала обслуживания и дня, когда контрагента завели', () => {
    expect(feeDue(base, '2026-10')).toBe('2026-11-10');
    expect(feeDue(base, '2026-11')).toBe('2026-11-10');
    expect(feeDue({ ...base, start: '2026-10-05', createdOn: '2026-10-05' }, '2026-10')).toBe(
      '2026-10-10',
    );
    expect(feeDue({ ...base, start: '2026-10-05', createdOn: '2026-10-10' }, '2026-10')).toBe(
      '2026-11-10',
    );
  });

  it('начисления — с месяца начала, но не раньше месяца, когда контрагента завели; пауза и разовый — без', () => {
    const old = {
      ...base,
      start: '2024-03-01',
      createdOn: '2026-09-14',
      periods: [{ from: '2024-03', to: null }],
    };
    expect(feeMonths(old, '2026-10-18')).toEqual(['2026-09', '2026-10']);
    const paused = { ...old, periods: [{ from: '2024-03', to: '2026-09' }] };
    expect(feeMonths(paused, '2026-10-18')).toEqual(['2026-09']);
    expect(feeMonths({ ...old, oneOff: true }, '2026-10-18')).toEqual([]);
    // долг прошлого года не пропадает 1 января
    const c = {
      ...base,
      start: '2026-12-01',
      createdOn: '2026-11-20',
      periods: [{ from: '2026-12', to: null }],
    };
    expect(contractorFees(c, [], '2027-01-15').debt).toBe(6200000);
  });

  it('п. 64: долг 60 000 — сумма подставлена, после оплаты начисления «Оплачено», долг 0', () => {
    const c = {
      ...base,
      start: '2026-08-01',
      createdOn: '2026-08-01',
      periods: [{ from: '2026-08', to: null }],
      tariffs: [{ amount: 2000000, period: 'M' as const, from: '2026-08' }],
    };
    const fees = contractorFees(c, [], '2026-10-18');
    expect(fees.debt).toBe(6000000);
    const form = feePaymentForm(c, [], fees.debt, '2026-10-18');
    expect(form.amount).toBe(6000000);
    expect(form.allocation).toEqual([
      { month: '2026-08', amount: 2000000 },
      { month: '2026-09', amount: 2000000 },
      { month: '2026-10', amount: 2000000 },
    ]);
    const after = contractorFees(
      c,
      [{ amount: 6000000, allocation: form.allocation }],
      '2026-10-18',
    );
    expect(after.debt).toBe(0);
    expect(after.months.map((m) => m.status)).toEqual(['paid', 'paid', 'paid']);
  });

  it('излишек — аванс, сам засчитывается в следующие начисления от старых к новым', () => {
    const c = {
      ...base,
      start: '2026-09-01',
      createdOn: '2026-09-01',
      periods: [{ from: '2026-09', to: null }],
      tariffs: [{ amount: 1000000, period: 'M' as const, from: '2026-09' }],
    };
    const pay = { amount: 2500000, allocation: [{ month: '2026-09', amount: 1000000 }] };
    expect(contractorFees(c, [pay], '2026-10-18')).toMatchObject({ debt: 0, advance: 500000 });
    const nov = contractorFees(c, [pay], '2026-11-18');
    expect(nov.months.map((m) => [m.month, m.fromAdvance, m.status])).toEqual([
      ['2026-09', 0, 'paid'],
      ['2026-10', 1000000, 'paid'],
      ['2026-11', 500000, 'partial'],
    ]);
    expect(nov.debt).toBe(500000);
    expect(plain(allocationText(t, pay.amount, pay.allocation))).toBe(
      'сентябрь 2026 — 10 000, аванс — 15 000',
    );
  });

  it('новая ставка: только со следующего месяца, не чаще раза в месяц, первая — с текущего', () => {
    const today = '2026-10-18';
    expect(tariffProblem([], 3000000, '2026-10', today)).toBeNull();
    expect(tariffProblem(base.tariffs, 3000000, '2026-10', today)).toBe('month_taken');
    expect(tariffProblem(base.tariffs, 3000000, '2026-11', today)).toBeNull();
    expect(tariffDefaults(base.tariffs, today, t)).toMatchObject({
      from: '2026-11',
      minFrom: '2026-11',
      note: 'Повышение с ноября',
    });
    expect(tariffDefaults([], today, t)).toMatchObject({
      amount: null,
      period: 'M',
      minFrom: '2026-10',
    });
  });
});

describe('напоминание о долге в WhatsApp (прототип waDlg с fee)', () => {
  const line = (req: string) => t('fee.wa.requisites', { req });
  const values = {
    contractor: 'ОсОО «Ала-Тоо»',
    months: ['2026-08', '2026-09'],
    amount: 6_000_000,
    payBy: '2026-10-15',
    requisite: 'Оптима Банк, счёт 1091',
  };

  it('шаблон без {реквизиты}: месяцы через запятую, сумма, дата и реквизиты в конце', () => {
    expect(plain(feeWhatsAppText(FEE_WHATSAPP_TEMPLATE, values, line))).toBe(
      'Уважаемые ОсОО «Ала-Тоо»! Напоминаем об оплате за обслуживание за август 2026, сентябрь 2026: 60 000 сом. Просим оплатить до 15.10.2026. Реквизиты для оплаты: Оптима Банк, счёт 1091.',
    );
  });

  it('шаблон с {реквизиты}: подстановка на месте, без счёта — «—»', () => {
    const tpl = 'Долг {сумма}, реквизиты: {реквизиты}';
    expect(plain(feeWhatsAppText(tpl, values, line))).toBe(
      'Долг 60 000 сом, реквизиты: Оптима Банк, счёт 1091',
    );
    expect(plain(feeWhatsAppText(tpl, { ...values, requisite: null }, line))).toBe(
      'Долг 60 000 сом, реквизиты: —',
    );
    expect(
      plain(feeWhatsAppText(FEE_WHATSAPP_TEMPLATE, { ...values, requisite: null }, line)),
    ).not.toContain('Реквизиты');
  });
});
