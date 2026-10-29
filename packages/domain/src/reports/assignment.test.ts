import { describe, expect, it } from 'vitest';
import {
  assignmentProblem,
  dueDayAllowed,
  singleTaxVariantCount,
  type AssignmentFields,
  type AssignmentTypeRule,
} from './assignment';

const RATES = [
  { code: 'ЕНС-04', rate: '4 % безнал + 6 % нал', rateCashless: '4 %', rateCash: '6 %' },
  {
    code: 'ЕНС-12',
    rate: 'Бишкек и Ош — 5 %, остальная территория — 3 %',
    rateCashless: '',
    rateCash: '',
  },
  { code: 'ЕНС-16', rate: '4 %', rateCashless: '', rateCash: '' },
  { code: 'ЕНС-17', rate: 'по ставкам ЕНС-04', rateCashless: '', rateCash: '' },
  { code: 'ЕНС-21', rate: 'по ставкам ЕНС-12', rateCashless: '', rateCash: '' },
];

const type = (patch: Partial<AssignmentTypeRule> = {}): AssignmentTypeRule => ({
  code: 'nds',
  kind: 'cross',
  period: 'M',
  oneOff: false,
  periodPerAssignment: false,
  act: 'both',
  rates: ['12 %', '0 %'],
  rateAdditions: [],
  ...patch,
});

const fields = (patch: Partial<AssignmentFields> = {}): AssignmentFields => ({
  fromMonth: '2026-10-01',
  untilMonth: null,
  rate: null,
  enRates: [],
  rateAdditions: [],
  dueDay: null,
  ownPeriod: null,
  ownDay: null,
  ownMonth: null,
  fixedAmount: null,
  ...patch,
});

const problem = (f: Partial<AssignmentFields>, t: Partial<AssignmentTypeRule> = {}) =>
  assignmentProblem(fields(f), type(t), RATES)?.problem ?? null;

describe('Проверки назначения', () => {
  it('«до какого периода» не раньше «с какого»', () => {
    expect(assignmentProblem(fields({ untilMonth: '2026-09-01' }), type(), RATES)).toEqual({
      problem: 'until_before_from',
      field: 'untilMonth',
    });
    expect(problem({ untilMonth: '2026-10-01' })).toBeNull();
  });

  it('ставка — из ставок вида; у единого налога — только строки ЕНС', () => {
    expect(problem({ rate: '12 %' })).toBeNull();
    expect(problem({ rate: '15 %' })).toBe('rate_invalid');
    expect(problem({ rate: '4 %' }, { code: 'enq', rates: ['4 %'] })).toBe('rate_invalid');
    expect(problem({ enRates: [{ code: 'ЕНС-04', variant: null }] })).toBe('en_rates_invalid');
  });

  it('строки ЕНС: коды из справочника, без повторов, вариант — только у ставки с вариантами', () => {
    const en = (enRates: AssignmentFields['enRates']) => problem({ enRates }, { code: 'enq' });
    expect(
      en([
        { code: 'ЕНС-04', variant: null },
        { code: 'ЕНС-16', variant: null },
      ]),
    ).toBeNull();
    expect(
      en([
        { code: 'ЕНС-04', variant: null },
        { code: 'ЕНС-04', variant: null },
      ]),
    ).toBe('en_rates_invalid');
    expect(en([{ code: 'ЕНС-99', variant: null }])).toBe('en_rates_invalid');
    expect(en([{ code: 'ЕНС-12', variant: 1 }])).toBeNull();
    expect(en([{ code: 'ЕНС-12', variant: 2 }])).toBe('en_rates_invalid');
    expect(en([{ code: 'ЕНС-04', variant: 0 }])).toBe('en_rates_invalid');
  });

  it('варианты строки ЕНС — и у строки «по ставкам ЕНС-NN»', () => {
    expect(singleTaxVariantCount('ЕНС-12', RATES)).toBe(2);
    expect(singleTaxVariantCount('ЕНС-21', RATES)).toBe(2);
    expect(singleTaxVariantCount('ЕНС-17', RATES)).toBe(0);
    expect(singleTaxVariantCount('ЕНС-16', RATES)).toBe(0);
    expect(singleTaxVariantCount('ЕНС-99', RATES)).toBe(0);
  });

  it('добавляемые ставки — из ставок вида, без повторов', () => {
    const nsp = { code: 'nsp', rateAdditions: [{ k: 'tr' }, { k: 'ex' }] };
    expect(problem({ rateAdditions: ['tr'] }, nsp)).toBeNull();
    expect(problem({ rateAdditions: ['tr', 'tr'] }, nsp)).toBe('rate_additions_invalid');
    expect(problem({ rateAdditions: ['zz'] }, nsp)).toBe('rate_additions_invalid');
  });

  it('вариант срока — у видов с периодом по каталогу, кроме годовых и разовых', () => {
    expect(problem({ dueDay: 25 })).toBeNull();
    expect(problem({ dueDay: 25 }, { period: 'Y' })).toBe('due_day_not_allowed');
    expect(problem({ dueDay: 25 }, { oneOff: true })).toBe('due_day_not_allowed');
    expect(problem({ dueDay: 25 }, { kind: 'internal' })).toBe('due_day_not_allowed');
    expect(dueDayAllowed(type({ period: 'Q' }))).toBe(true);
  });

  it('периодичность и срок в назначении — у внутренней отчётности и видов с этой отметкой', () => {
    const own = { ownPeriod: 'Q' as const, ownDay: 20, ownMonth: 1 };
    expect(problem(own)).toBe('own_not_allowed');
    expect(problem(own, { kind: 'internal', period: 'Y' })).toBeNull();
    expect(problem(own, { periodPerAssignment: true })).toBeNull();
    expect(problem({ ownDay: 20 }, { kind: 'internal' })).toBe('own_invalid');
    expect(problem({ ownPeriod: 'Y', ownMonth: 0 }, { kind: 'internal' })).toBe('own_invalid');
    expect(problem({ ownPeriod: 'Y', ownMonth: 4 }, { kind: 'internal' })).toBeNull();
    expect(problem({ ownPeriod: 'M', ownMonth: 0 }, { kind: 'internal' })).toBeNull();
  });

  it('повторяющаяся сумма — только у видов с уплатой', () => {
    expect(problem({ fixedAmount: 250_000 })).toBeNull();
    expect(problem({ fixedAmount: 250_000 }, { act: 'pay' })).toBeNull();
    expect(problem({ fixedAmount: 250_000 }, { act: 'sub' })).toBe('fixed_amount_sub');
  });
});
