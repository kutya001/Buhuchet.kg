import { describe, expect, it } from 'vitest';
import {
  ADMIN_DICT_META,
  ADMIN_VALUE_DICTS,
  dictRequestAnswerProblem,
  dictValueProblems,
  isAdminValueDict,
  nextDictCode,
  organSiteUrl,
  UGNS_CODE_PATTERN,
} from './admin';

describe('nextDictCode', () => {
  const random = () => 'k3x9';

  it('следующий номер после самого большого, с нулями как у справочника', () => {
    expect(nextDictCode('forms', ['ФС-01', 'ФС-24', 'ФС-03'], random)).toBe('ФС-25');
    expect(nextDictCode('reasons', ['ПРЧ-001', 'ПРЧ-005'], random)).toBe('ПРЧ-006');
    expect(nextDictCode('organs', [], random)).toBe('ОРГ-01');
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

  it('isAdminValueDict знает только справочники механизма', () => {
    expect(isAdminValueDict('forms')).toBe(true);
    expect(isAdminValueDict('types')).toBe(false);
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
