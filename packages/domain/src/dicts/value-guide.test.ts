import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/value-guide.json';
import {
  benefitDueText,
  singleTaxRateParts,
  type BenefitDueOverride,
  type DueOverrideType,
} from './value-guide';

// Эталон — прототип (scripts/oracle-value-guide.mjs): льготы и ставки ЕН refDB.json и придуманные случаи.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.types as unknown as Record<string, DueOverrideType>;
const typeOf = (code: string) => types[code];

describe('«Меняет сроки» льготы или статуса', () => {
  it.each(fixture.benefits)('$name — как в прототипе', ({ rules, expected }) => {
    expect(benefitDueText(rules as BenefitDueOverride[], typeOf, t)).toBe(expected);
  });

  it('Крупный налогоплательщик: НДС — свой срок сдачи и уплаты', () => {
    const rules: BenefitDueOverride[] = [
      { reportType: 'nds', dueDay: 31, dueAfter: 1, dueMonth: null, payDay: 25, payAfter: 1 },
    ];
    expect(benefitDueText(rules, typeOf, t)).toBe(
      'НДС: сдача — до последнего дня месяца после отчётного; уплата — до 25-го числа месяца после отчётного',
    );
  });
});

describe('Строки суммы в отчёте по ставке единого налога', () => {
  it.each(fixture.rateCases)(
    '$code на $date, вариант $variant — как в прототипе',
    ({ code, date, variant, expected }) => {
      const x = fixture.rates.find((r) => r.code === code);
      expect(singleTaxRateParts(x, fixture.rates, date, t, variant)).toEqual(expected);
    },
  );

  it('ставки, которые ссылаются друг на друга по кругу, не зацикливаются', () => {
    const rates = [
      { code: 'А', rate: 'по ставкам ЕНС-2', rateCashless: '', rateCash: '' },
      { code: 'ЕНС-2', rate: 'по ставкам ЕНС-3', rateCashless: '', rateCash: '' },
      { code: 'ЕНС-3', rate: 'по ставкам ЕНС-2', rateCashless: '', rateCash: '' },
    ];
    expect(singleTaxRateParts(rates[0], rates, '2026-10-27', t)).toEqual([]);
    expect(singleTaxRateParts(undefined, rates, '2026-10-27', t)).toEqual([]);
  });
});
