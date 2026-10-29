import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import type { PayerKind, ReportKind } from '../platform-dicts/catalog';
import fixture from './__fixtures__/compatible.json';
import { activeSingleTax, incompatibilityText, typeIncompatibility } from './compatible';

// Эталон — прототип (scripts/oracle-compatible.mjs): compatible на контрагентах demoDB.json и
// придуманных случаях каждой ветки.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.types.map((x) => ({
  ...x,
  payer: x.payer as PayerKind,
  kind: x.kind as ReportKind,
}));

describe('Подходит ли вид отчёта контрагенту', () => {
  it.each(fixture.cases.map((c, i) => ({ ...c, i })))('#$i $name — как в прототипе', (c) => {
    const subject = {
      form: { ...c.subject.form, declarationFor: c.subject.form.declarationFor as 'org' | 'ip' },
      regimes: c.subject.regimes,
      singleTax: activeSingleTax(c.subject.assignments),
    };
    const got = Object.fromEntries(
      types.map((type) => {
        const x = typeIncompatibility(type, subject, fixture.rates, fixture.date, t);
        return [type.code, x ? incompatibilityText(x, t) : ''];
      }),
    );
    expect(got).toEqual(c.expected);
  });

  it('снятое назначение единого налога не в счёт', () => {
    expect(
      activeSingleTax([
        {
          reportTypeCode: 'enq',
          endedOn: '2026-09-30',
          enRates: [{ code: 'ЕНС-15', variant: null }],
        },
        { reportTypeCode: 'nds', endedOn: null, enRates: [] },
      ]),
    ).toEqual([]);
  });
});
