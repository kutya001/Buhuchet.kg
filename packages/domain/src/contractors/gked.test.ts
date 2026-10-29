import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import type { GkedRule, ReportKind } from '../platform-dicts/catalog';
import fixture from './__fixtures__/gked.json';
import {
  defaultSingleTaxRates,
  gkedAncestors,
  gkedCheck,
  gkedCheckTexts,
  gkedHit,
  gkedRates,
  gkedSignature,
  placeVariant,
  type GkedConfirmation,
  type GkedDicts,
  type GkedList,
  type GkedSubject,
} from './gked';

// Эталон — прототип (scripts/oracle-gked.mjs): пункты приёмки ТЗ 17, 18, 56, 57, 58, режимы с
// перечнями, ставки ЕН, льготы и все демо-контрагенты с их видами отчётов.
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

const dicts: GkedDicts = {
  index: new Map(fixture.catalog.gked.map((x) => [x.code, x])),
  regimes: fixture.catalog.regimes.map((r) => ({ ...r, gked: r.gked as GkedRule | null })),
  benefits: fixture.catalog.benefits.map((b) => ({ ...b, gked: b.gked as GkedRule | null })),
  rates: fixture.catalog.rates.map((x) => ({ ...x, gked: x.gked as GkedRule | null })),
  types: fixture.catalog.types.map((x) => ({
    ...x,
    kind: x.kind as ReportKind,
    gked: x.gked as GkedRule | null,
  })),
  groups: fixture.catalog.groups,
};

/** Перечень по форме собственности в тексте прототипа → код продукта. */
const LIST: Record<string, GkedList | null> = {
  '': null,
  'для организаций': 'org',
  'для ИП': 'ip',
  'для физлиц на ИТД': 'itd',
};

const subjectOf = (s: (typeof fixture.cases)[number]['subject']) => s as unknown as GkedSubject;

describe('Сверка контрагента с ГКЭД — как в прототипе', () => {
  it.each(fixture.cases)('$title', ({ subject, types, confirmed, expected }) => {
    const s = subjectOf(subject);
    const ok: GkedConfirmation | null = confirmed && {
      sig: gkedSignature(subjectOf(confirmed.base), dicts.regimes),
      by: confirmed.by,
      at: confirmed.at,
      ask: confirmed.ask,
    };
    const check = gkedCheck(s, dicts, ok, types);
    const texts = gkedCheckTexts(check, t);
    expect(texts.block).toEqual(expected.block);
    expect(texts.regime).toEqual(expected.regime);
    expect(texts.benefits).toEqual(expected.benefits);
    expect(texts.rate).toEqual(expected.rate);
    expect(texts.types).toEqual(expected.types);
    expect(texts.off).toEqual(expected.off);
    expect(
      check.confirm.map((c) => ({
        regime: c.regime,
        code: c.code,
        list: c.list,
        group: c.group?.id ?? null,
        ask: c.ask,
        art: c.article,
      })),
    ).toEqual(expected.confirm.map((c) => ({ ...c, list: LIST[c.list] })));
  });

  it('эталон покрывает пункты приёмки 17, 18, 56, 57 и 58', () => {
    for (const n of [17, 18, 56, 57, 58]) {
      expect(fixture.cases.some((c) => c.title.startsWith(`п. ${n}`))).toBe(true);
    }
  });
});

describe('Подтверждение привязано к набору данных', () => {
  const base: GkedSubject = {
    gked: '61.10.0',
    gkedExtra: [],
    form: { code: 'ФС-01', declarationFor: 'org' },
    regimes: ['РЕЖ-03'],
    benefits: [],
  };
  const sig = gkedSignature(base, dicts.regimes);
  const confirmed = { sig, by: 'Айгерим С.', at: '2026-10-23', ask: 'Оказывает услуги интернета?' };

  it('тот же основной ГКЭД и режимы — вопрос закрыт', () => {
    const issue = gkedCheck(base, dicts, confirmed).regime[0];
    expect(issue?.kind === 'confirm' && issue.confirmed).toEqual(confirmed);
  });

  it('смена основного ГКЭД — вопрос задаётся заново', () => {
    const s = { ...base, gked: '61.90.0' };
    expect(gkedSignature(s, dicts.regimes)).not.toBe(sig);
  });

  it('у режима без перечней по форме дополнительные ГКЭД и форма подтверждение не сбрасывают', () => {
    const s: GkedSubject = {
      ...base,
      gkedExtra: ['62.01.0'],
      form: { code: 'ФС-02', declarationFor: 'org' },
    };
    expect(gkedSignature(s, dicts.regimes)).toBe(sig);
  });

  it('у патента смена формы собственности сбрасывает подтверждение', () => {
    const ip: GkedSubject = {
      gked: '62.01.0',
      gkedExtra: [],
      form: { code: 'ФС-21', declarationFor: 'ip' },
      regimes: ['РЕЖ-02'],
      benefits: [],
    };
    const itd = { ...ip, form: { code: 'ФС-22', declarationFor: 'ip' as const } };
    expect(gkedSignature(ip, dicts.regimes)).not.toBe(gkedSignature(itd, dicts.regimes));
  });
});

describe('Коды ГКЭД', () => {
  it('предки кода до секции', () => {
    expect(gkedAncestors('47.11.0', dicts.index)).toEqual(['47.11', '47.1', '47', 'G']);
    expect(gkedAncestors('нет такого', dicts.index)).toEqual([]);
  });

  it('начало кода: раздел, группа, секция буквой', () => {
    expect(gkedHit('47.11.0', '47', dicts.index)).toBe(true);
    expect(gkedHit('47.11.0', '47.1', dicts.index)).toBe(true);
    expect(gkedHit('47.11.0', 'G', dicts.index)).toBe(true);
    expect(gkedHit('47.11.0', 'C', dicts.index)).toBe(false);
    expect(gkedHit('47.11.0', '47.11.0', dicts.index)).toBe(true);
  });

  it('без совпадения — ставка «Остальные виды деятельности»', () => {
    const [x] = gkedRates('99.00.0', [], dicts.rates, dicts.index);
    expect(x?.code).toBe('ЕНС-04');
    expect(gkedRates('99.00.0', [], [], dicts.index)).toEqual([]);
  });

  it('код не из справочника или отключённый — в «больше не действует»', () => {
    const index = new Map(dicts.index);
    index.set('01.11.1', { ...index.get('01.11.1')!, active: false });
    const s: GkedSubject = {
      gked: '01.11.1',
      gkedExtra: ['00.00.0'],
      form: null,
      regimes: [],
      benefits: [],
    };
    expect(gkedCheck(s, { ...dicts, index }).off).toEqual(['01.11.1', '00.00.0']);
  });

  it('без ГКЭД сверять нечего', () => {
    const s: GkedSubject = {
      gked: null,
      gkedExtra: [],
      form: null,
      regimes: ['РЕЖ-03'],
      benefits: [],
    };
    expect(gkedCheck(s, dicts)).toEqual({
      block: [],
      regime: [],
      confirm: [],
      benefits: [],
      rate: [],
      types: [],
      off: [],
    });
  });
});

describe('Строки ЕНС по умолчанию в назначении (прототип enAuto)', () => {
  const subject = (patch: Partial<Parameters<typeof defaultSingleTaxRates>[0]> = {}) => ({
    gked: null,
    gkedExtra: [],
    benefits: [],
    place: '',
    ...patch,
  });
  const rates = (patch: Partial<Parameters<typeof defaultSingleTaxRates>[0]>) =>
    defaultSingleTaxRates(subject(patch), dicts.rates, dicts.index);

  it('основная — по основному ГКЭД, без ГКЭД — «Остальные виды деятельности»', () => {
    expect(rates({})).toEqual([{ code: 'ЕНС-04', variant: null }]);
    expect(rates({ gked: '46.34.0' })).toEqual([{ code: 'ЕНС-06', variant: null }]);
  });

  it('дополнительные ГКЭД — свои строки; при ставке на всю деятельность — только она', () => {
    expect(rates({ gked: '46.34.0', gkedExtra: ['56.10.0', '46.31.0'], place: 'г. Ош' })).toEqual([
      { code: 'ЕНС-06', variant: null },
      { code: 'ЕНС-12', variant: 0 },
    ]);
    expect(rates({ gked: '47.11.0', gkedExtra: ['56.10.0'] })).toEqual([
      { code: 'ЕНС-01', variant: null },
    ]);
  });

  it('вариант по месту: город УГНС или адрес, иначе «остальная территория»; не по месту — первый', () => {
    const food = 'Бишкек и Ош — 5 %, остальная территория — 3 %';
    expect(placeVariant(food, 'г. Бишкек')).toBe(0);
    expect(placeVariant(food, 'Иссык-Кульская обл., г. Каракол')).toBe(1);
    expect(placeVariant(food, '')).toBe(0);
    // «Ошская область» — не город Ош.
    expect(placeVariant(food, 'Ошская область')).toBe(1);
    expect(placeVariant('с частичной переработкой — 1 %, в неизменном виде — 3 %', 'г. Ош')).toBe(
      0,
    );
    expect(placeVariant('4 % безнал + 6 % нал', 'г. Ош')).toBeNull();
  });
});
