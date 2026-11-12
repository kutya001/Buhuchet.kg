import { describe, expect, it } from 'vitest';
import refDB from '../../../../spec/data/refDB.json';
import type { ReportAct, ReportPeriod } from '../platform-dicts/catalog';
import oracle from './__fixtures__/kpi-tax.json';
import {
  reportTaxMonths,
  reportTaxRoles,
  revenuePct,
  revenueTax,
  socfundTax,
  taxBase,
  taxBaseTotal,
  taxResult,
} from './tax';

// Эталон — прототип v80 (scripts/oracle-kpi-tax.mjs): суммы в тыйынах, численность — в сотых.
const tariffs = refDB.taxes.find((x) => x.code === 'ПЛТ-01')!.guide!.tariffs!;
const rateText = refDB.taxes.find((x) => x.code === 'НАЛ-01')!.guide!.rates![0]!.rate;
const tariffOf = (id: string) => {
  const x = tariffs.find((y) => y.id === id)!;
  return {
    id: x.id as 'spino' | 'general' | 'pvtpki',
    total: x.total,
    parts: x.parts,
    cap: x.cap ?? null,
    short: x.short ?? x.name,
  };
};

describe('какие показатели нужны отчёту (прототип kTaxNeed)', () => {
  it('«Соцфонд» — ФОТ и численность; единый налог, налог с продаж, ПВТ и НДС — выручка; вид без суммы и остальные — ничего', () => {
    for (const c of oracle.need) {
      expect(reportTaxRoles(c.type, c.act as ReportAct), `${c.type} ${c.act}`).toEqual(c.expected);
    }
    expect(reportTaxRoles('soc', 'both')).toEqual(['fot', 'emp']);
    expect(reportTaxRoles('enq', 'sub')).toBeNull();
  });
});

describe('месяцы периода отчёта (прототип kRepMs)', () => {
  it('месяц, квартал, полугодие и год — с первого месяца периода; период не с первого числа — месяцев нет', () => {
    for (const c of oracle.months) {
      expect(
        reportTaxMonths(c.period as ReportPeriod, c.periodStart),
        `${c.type} ${c.periodStart}`,
      ).toEqual(c.expected);
    }
    expect(reportTaxMonths('Q', '2026-07-01')).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(reportTaxMonths('M', '2026-11-15')).toEqual([]);
  });
});

describe('база налога из показателя (прототип kTaxBase)', () => {
  const months = ['2026-07', '2026-08', '2026-09'];
  it('сумма — по заполненным месяцам, пустой месяц — в списке недостающих; ноль — значение', () => {
    const base = taxBase(months, (m) => (m === '2026-08' ? null : m === '2026-07' ? 0 : 150_000));
    expect(base).toEqual({ values: [0, null, 150_000], sum: 150_000, missing: ['2026-08'] });
  });

  it('«Итого»: у выручки и ФОТ — сумма, у численности — среднее по заполненным до человека; пусто — нет', () => {
    const emp = taxBase(months, (m) => (m === '2026-08' ? null : m === '2026-07' ? 500 : 600));
    expect(taxBaseTotal('emp', emp)).toBe(600);
    expect(taxBaseTotal('fot', emp)).toBe(1100);
    expect(
      taxBaseTotal(
        'rev',
        taxBase(months, () => null),
      ),
    ).toBeNull();
  });
});

describe('подоходный налог и взносы по ФОТ (прототип kTaxSoc)', () => {
  it('тариф от ФОТ месяца, предел базы на работника при внесённой численности, налог — от ФОТ за вычетом взносов работника', () => {
    const cases = oracle.soc.filter((c) => c.tariff !== null);
    expect(cases.length).toBeGreaterThan(20);
    for (const c of cases) {
      expect(
        socfundTax({ tariff: tariffOf(c.tariff!), rateText, fot: c.fot, emp: c.emp }),
        `${c.tariff} ${JSON.stringify(c.fot)} ${JSON.stringify(c.emp)}`,
      ).toEqual(c.expected);
    }
  });

  it('ставка подоходного налога: из «Налогов и ставок», пусто — 10 %, у тарифа ПВТ / ПКИ — 5 %', () => {
    const fot = [10_000_000];
    expect(socfundTax({ tariff: tariffOf('spino'), rateText: '', fot, emp: null }).incomeRate).toBe(
      10,
    );
    expect(
      socfundTax({ tariff: tariffOf('spino'), rateText: '8 %', fot, emp: null }).incomeRate,
    ).toBe(8);
    expect(
      socfundTax({ tariff: tariffOf('pvtpki'), rateText: '10 %', fot, emp: null }).incomeRate,
    ).toBe(5);
  });
});

describe('налог от выручки (прототип kRevPct, kTaxHtml)', () => {
  it('ставка: у НДС нет, из назначения — с числом, у отчислений ПВТ без ставки — 1 %', () => {
    for (const c of oracle.pct) {
      expect(revenuePct(c.type, c.rate), `${c.type} ${c.rate}`).toBe(c.expected);
    }
  });

  it('сумма — выручка × ставка, до сома', () => {
    for (const c of oracle.byPct) {
      expect(revenueTax(c.revenue, c.pct), `${c.revenue} × ${c.pct}`).toBe(c.expected);
    }
  });
});

describe('итог блока «Расчёт по показателям» (прототип kTaxHtml)', () => {
  const months = ['2026-07', '2026-08', '2026-09'];
  const full = taxBase(months, () => 10_000_000);
  const input = { rateLines: [], assignmentRate: null } as const;

  it('нет показателя с отметкой — подсказка; нет значения за месяц — какие месяцы внести', () => {
    expect(taxResult({ ...input, typeCode: 'enq', main: null })).toEqual({ kind: 'no_indicator' });
    const base = taxBase(months, (m) => (m === '2026-09' ? null : 1));
    expect(taxResult({ ...input, typeCode: 'enq', main: { name: 'Выручка', base } })).toEqual({
      kind: 'missing',
      indicator: 'Выручка',
      months: ['2026-09'],
    });
  });

  it('«Соцфонд»: тариф не определён — подсказка; определён — налог и взносы с названием и ставкой тарифа', () => {
    const main = { name: 'ФОТ', base: full };
    expect(
      taxResult({
        ...input,
        typeCode: 'soc',
        main,
        socfund: { tariff: null, rateText, emp: null },
      }),
    ).toEqual({ kind: 'no_tariff' });
    const tariff = tariffOf('spino');
    expect(
      taxResult({ ...input, typeCode: 'soc', main, socfund: { tariff, rateText, emp: null } }),
    ).toEqual({
      kind: 'socfund',
      tariff: 'СПиНО',
      total: '12,25 %',
      ...socfundTax({ tariff, rateText, fot: full.values, emp: null }),
    });
  });

  it('одна строка по ставке — выручка и налог строки; несколько — выручка и строки на выбор', () => {
    const main = { name: 'Выручка', base: full };
    const line = { key: 'ЕНС-04:r', label: 'Выручка, 4 %', pct: '4 %' };
    expect(taxResult({ ...input, typeCode: 'enq', main, rateLines: [line] })).toEqual({
      kind: 'line',
      key: 'ЕНС-04:r',
      label: 'Выручка, 4 %',
      revenue: 30_000_000,
      tax: 1_200_000,
    });
    const cash = { key: 'ЕНС-04:ca', label: 'Наличная выручка, 6 %', pct: '6 %' };
    expect(taxResult({ ...input, typeCode: 'enq', main, rateLines: [line, cash] })).toEqual({
      kind: 'lines',
      revenue: 30_000_000,
      lines: [
        { key: 'ЕНС-04:r', label: 'Выручка, 4 %' },
        { key: 'ЕНС-04:ca', label: 'Наличная выручка, 6 %' },
      ],
    });
  });

  it('без строк: ставка назначения — сумма; ставки нет или НДС — сумму вписывают сами', () => {
    const main = { name: 'Выручка', base: full };
    expect(taxResult({ ...input, typeCode: 'nspq', main, assignmentRate: '2 %' })).toEqual({
      kind: 'rate',
      pct: '2 %',
      revenue: 30_000_000,
      amount: 600_000,
    });
    expect(taxResult({ ...input, typeCode: 'pvt', main })).toMatchObject({
      kind: 'rate',
      pct: '1 %',
      amount: 300_000,
    });
    expect(taxResult({ ...input, typeCode: 'nspq', main })).toEqual({
      kind: 'no_rate',
      revenue: 30_000_000,
      vat: false,
    });
    expect(taxResult({ ...input, typeCode: 'nds', main, assignmentRate: '12 %' })).toEqual({
      kind: 'no_rate',
      revenue: 30_000_000,
      vat: true,
    });
  });
});
