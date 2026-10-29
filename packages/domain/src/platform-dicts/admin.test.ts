import { describe, expect, it } from 'vitest';
import type { DueRule } from '../dicts/report-types';
import type { BenefitDueOverride } from '../dicts/value-guide';
import { isGridKey } from '../common/list';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  ADMIN_DICT_META,
  ADMIN_VALUE_DICTS,
  adminDictDefaultSort,
  badBaseTypes,
  badBenefitOffices,
  badBenefitTypes,
  benefitDueRulesProblem,
  benefitDueRuleText,
  type BenefitTypeOption,
  dictRequestAnswerProblem,
  dictValueProblems,
  isAdminValueDict,
  nextDictCode,
  organSiteUrl,
  PHONE_DIAL_CODE_PATTERN,
  PHONE_MASK_PATTERN,
  phoneCodeExample,
  UGNS_CODE_PATTERN,
} from './admin';

describe('nextDictCode', () => {
  const random = () => 'k3x9';

  it('следующий номер после самого большого, с нулями как у справочника', () => {
    expect(nextDictCode('forms', ['ФС-01', 'ФС-24', 'ФС-03'], random)).toBe('ФС-25');
    expect(nextDictCode('reasons', ['ПРЧ-001', 'ПРЧ-005'], random)).toBe('ПРЧ-006');
    expect(nextDictCode('organs', [], random)).toBe('ОРГ-01');
    expect(nextDictCode('regimes', ['РЕЖ-01', 'РЕЖ-12'], random)).toBe('РЕЖ-13');
    expect(nextDictCode('benefits', ['ЛЬГ-01', 'ЛЬГ-31'], random)).toBe('ЛЬГ-32');
  });

  it('после удаления номер не повторяется: дыры в номерах не заполняются', () => {
    expect(nextDictCode('organs', ['ОРГ-01', 'ОРГ-13'], random)).toBe('ОРГ-14');
  });

  it('чужие коды и коды без номера не мешают', () => {
    expect(nextDictCode('forms', ['ОРГ-40', 'ФС-x', 'ФС-02'], random)).toBe('ФС-03');
  });

  it('у УГНС — постоянный ключ, код ГНС может быть пуст', () => {
    expect(nextDictCode('ugns', ['ugns-large'], random)).toBe('ugns-k3x9');
  });

  it('у банковских провайдеров префикс по типу: банк — БНК, электронный кошелёк — КШЛ', () => {
    const codes = ['БНК-01', 'БНК-32', 'КШЛ-05'];
    expect(nextDictCode('banks', codes, random, 'bank')).toBe('БНК-33');
    expect(nextDictCode('banks', codes, random, 'wallet')).toBe('КШЛ-06');
    expect(nextDictCode('banks', codes, random)).toBe('БНК-33');
  });

  it('у страны, добавленной администратором, — X-01, X-02…; коды стран из наполнения не мешают', () => {
    expect(nextDictCode('phones', ['KG', 'KZ', 'RU'], random)).toBe('X-01');
    expect(nextDictCode('phones', ['KG', 'X-01', 'X-07'], random)).toBe('X-08');
  });
});

describe('dictValueProblems', () => {
  const others = [
    { code: 'ФС-01', name: 'ОсОО' },
    { code: 'ФС-02', name: 'ИП' },
  ];

  it('то же название у другого значения — «Такое значение уже есть»', () => {
    expect(dictValueProblems({ code: 'ФС-09', name: ' ИП ' }, others)).toEqual([
      { field: 'name', code: 'taken' },
    ]);
  });

  it('своё же название при правке — не повтор', () => {
    expect(dictValueProblems({ code: 'ФС-02', name: 'ИП' }, others)).toEqual([]);
  });

  it('код ГНС другого управления — «Такой код уже есть»; пустой код не сверяется', () => {
    const ugns = [
      { code: 'ugns-large', name: 'Крупные', gnsCode: null },
      { code: 'ugns-lenin', name: 'Ленинский', gnsCode: '002' },
    ];
    expect(dictValueProblems({ code: 'ugns-new', name: 'Новое', gnsCode: '002' }, ugns)).toEqual([
      { field: 'gnsCode', code: 'taken' },
    ]);
    expect(dictValueProblems({ code: 'ugns-new', name: 'Новое', gnsCode: '' }, ugns)).toEqual([]);
    expect(
      dictValueProblems({ code: 'ugns-lenin', name: 'Ленинский', gnsCode: '002' }, ugns),
    ).toEqual([]);
  });
});

describe('badBaseTypes', () => {
  const catalog = [
    { code: 'soc', kind: 'cross', active: true },
    { code: 'imn', kind: 'cross', active: false },
    { code: 'nds', kind: 'regime', active: true },
  ] as const;

  it('основание включает только сквозные действующие виды из каталога', () => {
    expect(badBaseTypes(['soc'], catalog, [])).toEqual([]);
    expect(badBaseTypes(['soc', 'imn', 'nds', 'nope'], catalog, [])).toEqual([
      'imn',
      'nds',
      'nope',
    ]);
  });

  it('уже привязанный вид остаётся, даже если отключён; неизвестный — нет', () => {
    expect(badBaseTypes(['imn', 'nds', 'nope'], catalog, ['imn', 'nds', 'nope'])).toEqual(['nope']);
  });
});

describe('Льготы и статусы', () => {
  const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
  const type = (code: string, x: Partial<BenefitTypeOption> = {}): BenefitTypeOption => ({
    code,
    kind: 'cross',
    active: true,
    oneOff: false,
    periodPerAssignment: false,
    ...x,
  });
  const catalog = [
    type('nds', { kind: 'regime' }),
    type('stat', { kind: 'cross' }),
    type('old', { active: false }),
    type('own', { kind: 'internal' }),
    type('event', { oneOff: true }),
    type('assign', { periodPerAssignment: true }),
  ];
  const rule = (reportType: string, x: Partial<BenefitDueOverride> = {}): BenefitDueOverride => ({
    reportType,
    dueDay: 31,
    dueAfter: 1,
    dueMonth: null,
    payDay: null,
    payAfter: null,
    ...x,
  });

  it('список — по коду, без «№»; новый статус — ЛЬГ-NN', () => {
    expect(adminDictDefaultSort('benefits')).toEqual({ key: 'code', dir: 'asc' });
    expect(ADMIN_DICT_META.benefits.ordered).toBe(false);
    expect(ADMIN_DICT_META.benefits.required).toEqual(['gives']);
  });

  it('«Делает ненужными» и «Добавляет» — действующие виды, кроме внутренних; выбранный остаётся', () => {
    expect(badBenefitTypes(['nds', 'stat', 'old', 'own', 'nope'], catalog, [])).toEqual([
      'old',
      'own',
      'nope',
    ]);
    expect(badBenefitTypes(['old', 'own'], catalog, ['old', 'own'])).toEqual([]);
  });

  it('«Ставится по УГНС» — действующие управления; выбранное остаётся', () => {
    const offices = [
      { code: 'ugns-large', active: true },
      { code: 'ugns-old', active: false },
    ];
    expect(badBenefitOffices(['ugns-large', 'ugns-old', 'nope'], offices, [])).toEqual([
      'ugns-old',
      'nope',
    ]);
    expect(badBenefitOffices(['ugns-old'], offices, ['ugns-old'])).toEqual([]);
  });

  it('«Меняет сроки»: новый срок обязателен, вид — один раз и со сроком из каталога', () => {
    expect(benefitDueRulesProblem([rule('nds')], catalog, [])).toBeNull();
    expect(
      benefitDueRulesProblem([rule('nds', { dueDay: null, dueAfter: null })], catalog, []),
    ).toBe('no_due');
    expect(benefitDueRulesProblem([rule('nds'), rule('nds')], catalog, [])).toBe('bad_type');
    for (const code of ['old', 'own', 'event', 'assign', 'nope']) {
      expect(benefitDueRulesProblem([rule(code)], catalog, [])).toBe('bad_type');
    }
    // Строка, которая уже была у статуса, остаётся, даже если вид потом отключили.
    expect(benefitDueRulesProblem([rule('old')], catalog, [rule('old')])).toBeNull();
  });

  it('строка «Меняет сроки» в окне — как в прототипе (ovRuleTxt)', () => {
    const nds: DueRule = {
      period: 'M',
      dueDay: 20,
      dueAfter: 1,
      dueMonth: null,
      dueFrom: 'end',
      oneOff: false,
      act: 'both',
    };
    expect(benefitDueRuleText(rule('nds', { payDay: 25, payAfter: 1 }), nds, t)).toBe(
      'сдача — до последнего дня месяца после отчётного; уплата — до 25-го числа месяца после отчётного',
    );
    expect(
      benefitDueRuleText(
        rule('nds', { dueDay: null, dueAfter: null, payDay: 15, payAfter: 0 }),
        nds,
        t,
      ),
    ).toBe('уплата — до 15-го числа месяца, за который платится');
  });
});

describe('dictRequestAnswerProblem', () => {
  it('при отказе ответ обязателен, при «Добавлено» — нет', () => {
    expect(dictRequestAnswerProblem('rejected', '  ')).toBe('answer_required');
    expect(dictRequestAnswerProblem('rejected', 'Уже есть как «ОсОО»')).toBeNull();
    expect(dictRequestAnswerProblem('added', '')).toBeNull();
  });
});

describe('ADMIN_DICT_META', () => {
  it('у каждого справочника есть название среди полей', () => {
    for (const dict of ADMIN_VALUE_DICTS) expect(ADMIN_DICT_META[dict].fields).toContain('name');
  });

  it('«Тип» нового значения — из типов справочника, обязательные поля — среди полей', () => {
    for (const dict of ADMIN_VALUE_DICTS) {
      const { kind, fields, required = [] } = ADMIN_DICT_META[dict];
      if (kind) expect(kind.values).toContain(kind.default);
      if (kind) expect(fields).toContain('kind');
      for (const f of required) expect(fields).toContain(f);
    }
  });

  it('isAdminValueDict знает только справочники механизма', () => {
    expect(isAdminValueDict('forms')).toBe(true);
    expect(isAdminValueDict('types')).toBe(true);
    expect(isAdminValueDict('calendar')).toBe(false);
    expect(isAdminValueDict('taxes')).toBe(false);
  });

  it('у списка каждого справочника механизма — свои настройки вида (ключ «pdicts.<справочник>»)', () => {
    for (const dict of ADMIN_VALUE_DICTS) expect(isGridKey(`pdicts.${dict}`), dict).toBe(true);
  });

  it('код страны по умолчанию не отключается, коды стран не удаляются', () => {
    expect(ADMIN_DICT_META.phones.fixed).toBe('KG');
    expect(ADMIN_DICT_META.phones.undeletable).toBe(true);
    expect(ADMIN_DICT_META.forms.undeletable).toBeUndefined();
  });

  it('телефонный код — 1–4 цифры, маска — только X и пробелы, хотя бы одна X', () => {
    expect(PHONE_DIAL_CODE_PATTERN.test('996')).toBe(true);
    expect(PHONE_DIAL_CODE_PATTERN.test('7')).toBe(true);
    expect(PHONE_DIAL_CODE_PATTERN.test('12345')).toBe(false);
    expect(PHONE_DIAL_CODE_PATTERN.test('+996')).toBe(false);
    expect(PHONE_MASK_PATTERN.test('XXX XXX XXX')).toBe(true);
    expect(PHONE_MASK_PATTERN.test('XXX-XXX')).toBe(false);
    expect(PHONE_MASK_PATTERN.test('   ')).toBe(false);
  });

  it('«Пример» номера — код и цифры по маске', () => {
    expect(phoneCodeExample('996', 'XXX XXX XXX')).toBe('+996 555 123 456');
    expect(phoneCodeExample('7', 'XXX XXX XX XX')).toBe('+7 555 123 45 67');
  });

  it('код ГНС — ровно три цифры', () => {
    expect(UGNS_CODE_PATTERN.test('002')).toBe(true);
    expect(UGNS_CODE_PATTERN.test('02')).toBe(false);
    expect(UGNS_CODE_PATTERN.test('0021')).toBe(false);
  });
});

describe('organSiteUrl', () => {
  it('без протокола — дописывает https://; с протоколом и пустой — как есть', () => {
    expect(organSiteUrl(' sti.gov.kg ')).toBe('https://sti.gov.kg');
    expect(organSiteUrl('http://sf.gov.kg')).toBe('http://sf.gov.kg');
    expect(organSiteUrl('HTTPS://sf.gov.kg/')).toBe('HTTPS://sf.gov.kg/');
    expect(organSiteUrl('')).toBe('');
  });
});
