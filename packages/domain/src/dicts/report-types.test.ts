import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/report-rules.json';
import { dueRuleText, payRuleText, paysText, type PayRule } from './report-types';

// Эталон — прототип (scripts/oracle-report-rules.mjs): все виды отчётов refDB.json и придуманные правила.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.types as {
  code: string;
  rule: PayRule;
  authority: string;
  payments: { name: string; authority: string }[];
  expected: { due: string; pay: string; pays: string };
}[];

describe('Сроки вида отчёта словами — как в прототипе', () => {
  it.each(types.map((x) => [x.code, x] as const))('%s', (_code, x) => {
    expect(dueRuleText(x.rule, t)).toBe(x.expected.due);
    expect(payRuleText(x.rule, t)).toBe(x.expected.pay);
    expect(paysText(x.payments, x.authority)).toBe(x.expected.pays);
  });

  it('эталон проходит все виды отчётов каталога и все ветки правила', () => {
    expect(types.filter((x) => !x.code.startsWith('case-'))).toHaveLength(145);
    expect(new Set(types.map((x) => x.expected.due)).size).toBeGreaterThan(60);
  });
});

describe('«Что уплачивается»', () => {
  it('орган в скобках — когда платежей несколько или получатель другой', () => {
    expect(paysText([{ name: 'НДС', authority: 'ГНС' }], 'ГНС')).toBe('НДС');
    expect(paysText([{ name: 'Взносы', authority: 'Соцфонд' }], 'ГНС')).toBe('Взносы (Соцфонд)');
    expect(
      paysText(
        [
          { name: 'Налог', authority: 'ГНС' },
          { name: 'Взносы', authority: 'Соцфонд' },
        ],
        'ГНС',
      ),
    ).toBe('Налог (ГНС); Взносы (Соцфонд)');
    expect(paysText([], 'ГНС')).toBe('');
  });
});
