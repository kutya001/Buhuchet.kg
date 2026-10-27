import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import fixture from './__fixtures__/tax-pick.json';
import { mainTaxPicks, taxPickGroupCodes, taxPickGroups, type TaxPickType } from './tax-pick';

// Эталон — прототип (scripts/oracle-tax-pick.mjs): каталог refDB.json.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const types = fixture.catalog.types as TaxPickType[];
const catalog = {
  types,
  bases: fixture.catalog.bases,
  benefitAdds: new Set(fixture.catalog.benefitAdds),
  regimeFullName: (name: string) =>
    (fixture.catalog.regimeFullNames as Record<string, string>)[name],
};

describe('«Выбор налогов» — как в прототипе', () => {
  it('группы по режимам, «Для всех», «По основаниям», «По статусам», «Статистика»', () => {
    expect(taxPickGroups(catalog, t)).toEqual(fixture.expected.groups);
  });

  it('«Отметить основные»: режимные ОНР и единого налога, ЕНД и STI-161', () => {
    expect(mainTaxPicks(types)).toEqual(fixture.expected.main);
  });

  it('отчёт из нескольких подгрупп считается в группе один раз', () => {
    const group = {
      id: 'basis',
      title: '',
      who: '',
      subs: [
        { title: 'А', codes: ['a', 'b'] },
        { title: 'Б', codes: ['b', 'c'] },
      ],
    };
    expect(taxPickGroupCodes(group)).toEqual(['a', 'b', 'c']);
  });

  it('без видов отчётов групп нет', () => {
    expect(taxPickGroups({ ...catalog, types: [] }, t)).toEqual([]);
  });
});
