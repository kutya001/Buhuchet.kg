import { describe, expect, it } from 'vitest';
import type { RateAddition } from '../platform-dicts/catalog';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/rates.json';
import { assignmentRateText, defaultTypeRate, isSingleTaxType } from './rates';

// Эталон — прототип (scripts/oracle-rates.mjs): aRateTxt на строках ЕН, налоге с продаж и обычной ставке.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.types as unknown as Record<string, { rateAdditions: RateAddition[] }>;

describe('Ставка назначения словами', () => {
  it.each(fixture.cases.map((c, i) => ({ ...c, i })))(
    '#$i $assignment.reportTypeCode на $date, коротко: $short — как в прототипе',
    ({ assignment, date, short, expected }) => {
      expect(
        assignmentRateText(
          assignment,
          types[assignment.reportTypeCode]!,
          fixture.rates,
          { date, short },
          t,
        ),
      ).toBe(expected);
    },
  );

  it('единый налог — квартальный и ежемесячный', () => {
    expect([isSingleTaxType('enq'), isSingleTaxType('enm'), isSingleTaxType('nds')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe('ставка вида по умолчанию', () => {
  it('как в форме прототипа (defRate): налог с продаж — 2 %, остальные — первая ставка каталога', () => {
    expect(defaultTypeRate({ code: 'nspm', rates: ['1 %', '2 %', '3 %', '5 %'] })).toBe('2 %');
    expect(defaultTypeRate({ code: 'nds', rates: ['12 %', '0 %'] })).toBe('12 %');
    expect(defaultTypeRate({ code: 'soc', rates: ['10 %', '5 %', '2 %', '1 %'] })).toBe('10 %');
    // Ставку по умолчанию убрали из каталога — первая; ставок нет — null.
    expect(defaultTypeRate({ code: 'nspq', rates: ['1 %', '3 %'] })).toBe('1 %');
    expect(defaultTypeRate({ code: 'fin', rates: [] })).toBeNull();
  });
});
