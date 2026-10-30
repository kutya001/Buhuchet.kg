import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  gkedEditProblems,
  gkedGroupActText,
  gkedGroupApply,
  gkedGroupSignature,
  gkedRuleCodes,
  gkedRuleKeep,
  gkedRuleText,
  gkedRuleToVerify,
  gkedSectionOf,
  packGkedGroupActs,
  parseGkedCodes,
  parseGkedGroupActs,
  parseGkedRule,
  splitGkedCodes,
} from './gked-admin';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

/** Кусок классификатора: секция A, раздел 01, группа 01.1, класс 01.11, подкласс 01.11.1. */
const INDEX = new Map([
  ['A', { level: 'section', parentCode: null }],
  ['01', { level: 'division', parentCode: 'A' }],
  ['01.1', { level: 'group', parentCode: '01' }],
  ['01.11', { level: 'class', parentCode: '01.1' }],
  ['01.11.1', { level: 'subclass', parentCode: '01.11' }],
]);
const KNOWN = new Set(INDEX.keys());

describe('ГКЭД в Админке (задача 2.38)', () => {
  it('новый код: формат классификатора, не занят; «Входит в» — выше по уровню, у секции пусто', () => {
    const check = (code: string, level: string, parentCode: string | null, isNew = true) =>
      gkedEditProblems({ code, level, parentCode, isNew }, INDEX).map((p) => p.code);
    expect(check('01.11.2', 'subclass', '01.11')).toEqual([]);
    expect(check('B', 'section', null)).toEqual([]);
    expect(check('', 'subclass', '01.11')).toEqual(['gked_code_required']);
    expect(check('1.1', 'subclass', '01.11')).toEqual(['gked_code_format']);
    expect(check('01.111', 'subclass', '01.11')).toEqual(['gked_code_format']);
    expect(check('01.11.1', 'subclass', '01.11')).toEqual(['gked_code_taken']);
    expect(check('B', 'section', 'A')).toEqual(['gked_parent_section']);
    expect(check('01.12', 'class', null)).toEqual(['gked_parent_required']);
    expect(check('01.12', 'class', '99')).toEqual(['gked_parent_unknown']);
    expect(check('01.11', 'class', '01.11', false)).toEqual(['gked_parent_self']);
    // Подкласс не входит в подкласс, класс — не в класс.
    expect(check('01.12', 'class', '01.11')).toEqual(['gked_parent_level']);
    // У созданного кода сам код не проверяется: он не меняется.
    expect(check('01.11.1', 'subclass', '01.11', false)).toEqual([]);
  });

  it('секция кода — по цепочке «Входит в»', () => {
    expect(gkedSectionOf('01.11.1', INDEX)).toBe('A');
    expect(gkedSectionOf('A', INDEX)).toBe('A');
    expect(gkedSectionOf('99', INDEX)).toBe('99');
  });

  it('перечень текстом и обратно: «47, 56.10; кроме 47.26», «все; кроме …», пусто — без ограничения', () => {
    expect(gkedRuleText({ in: ['01', '01.1'], ex: ['01.11'] }, t)).toBe('01, 01.1; кроме 01.11');
    expect(gkedRuleText({ in: [], ex: ['01.11'] }, t)).toBe('все; кроме 01.11');
    expect(gkedRuleText({ in: [], ex: [] }, t)).toBe('');
    expect(gkedRuleText(null, t)).toBe('');
    expect(parseGkedRule('01, 01.1; кроме 01.11', KNOWN, t)).toEqual({
      in: ['01', '01.1'],
      ex: ['01.11'],
    });
    expect(parseGkedRule('Все; кроме 01.11', KNOWN, t)).toEqual({ in: [], ex: ['01.11'] });
    expect(parseGkedRule('', KNOWN, t)).toEqual({ in: [], ex: [] });
    expect(parseGkedRule('01, 77; кроме 88', KNOWN, t)).toEqual({ unknown: ['77', '88'] });
  });

  it('коды через запятую: заглавными, без повторов; неизвестные — списком', () => {
    expect(splitGkedCodes(' a, 01.1;01.1  g ')).toEqual(['A', '01.1', 'G']);
    expect(parseGkedCodes('a, 01', KNOWN)).toEqual({ codes: ['A', '01'] });
    expect(parseGkedCodes('a, 02', KNOWN)).toEqual({ unknown: ['02'] });
  });

  it('новые перечни поверх прежних: признаки сохраняются, пустой необязательный убирается', () => {
    const old = { in: ['01'], ex: [], warn: ['01.1'], main: true, note: 'Сверить ставку' };
    expect(gkedRuleKeep(old, { in: ['A'], ex: ['01.11'] })).toEqual({
      in: ['A'],
      ex: ['01.11'],
      warn: ['01.1'],
      main: true,
      note: 'Сверить ставку',
    });
    // Поле «Предупреждать при ГКЭД» очищено — перечня нет.
    expect(gkedRuleKeep(old, { in: ['A'], ex: [], warn: [] })).not.toHaveProperty('warn');
    // Ни перечней, ни признаков — правила нет.
    expect(gkedRuleKeep({ in: ['01'], ex: [] }, { in: [], ex: [] })).toBeNull();
    // Признак остаётся — правило с пустыми перечнями.
    expect(gkedRuleKeep({ in: ['01'], ex: [], strict: 'main' }, { in: [], ex: [] })).toEqual({
      in: [],
      ex: [],
      strict: 'main',
    });
    expect(gkedRuleCodes({ in: ['01'], ex: ['02'], warn: ['03'], ip: ['04'] })).toEqual([
      '01',
      '02',
      '03',
      '04',
    ]);
  });

  it('«сверить»: есть «Сверить: …» или слово в примечании', () => {
    expect(gkedRuleToVerify({ in: [], ex: [], verify: 'ст. 419' })).toBe(true);
    expect(gkedRuleToVerify({ in: [], ex: [], note: 'Нужно сверить с НК' })).toBe(true);
    expect(gkedRuleToVerify({ in: [], ex: [], note: 'Банки' })).toBe(false);
    expect(gkedRuleToVerify(null)).toBe(false);
  });

  it('действие группы: одно на группу, по кодам или ничего — текстом и из Excel', () => {
    expect(gkedGroupActText({ en: 'ex', spino: null }, 'en', t)).toBe('Запрет');
    expect(gkedGroupActText({ en: 'ex', spino: null }, 'spino', t)).toBe('—');
    expect(
      gkedGroupActText({ en: { '01': 'warn', '01.11': 'ex' }, spino: null }, 'en', t),
    ).toBe('01 — предупреждение; 01.11 — запрет');
    expect(parseGkedGroupActs('запрет', KNOWN, t)).toEqual({ value: 'ex' });
    expect(parseGkedGroupActs('Предупреждение', KNOWN, t)).toEqual({ value: 'warn' });
    expect(parseGkedGroupActs('—', KNOWN, t)).toEqual({ value: null });
    expect(parseGkedGroupActs('01 — предупреждение; 01.11 — запрет', KNOWN, t)).toEqual({
      value: { '01': 'warn', '01.11': 'ex' },
    });
    expect(parseGkedGroupActs('нельзя', KNOWN, t)).toEqual({ error: 'whole' });
    expect(parseGkedGroupActs('99 — запрет', KNOWN, t)).toEqual({ error: 'codes' });
    expect(packGkedGroupActs(['01', '02'], { '01': 'ex', '02': 'ex' })).toBe('ex');
    expect(packGkedGroupActs(['01', '02'], {})).toBeNull();
    expect(packGkedGroupActs(['01', '02'], { '01': 'ex', '02': '' })).toEqual({ '01': 'ex' });
  });

  it('правка группы меняет «Кроме» и «Предупреждать при ГКЭД»: прежние коды уходят, новые — по действию', () => {
    const rule = { in: [], ex: ['64', '66'], warn: ['61'], strict: 'main' };
    const old = { codes: ['64', '61'], en: { '64': 'ex', '61': 'warn' } as const, spino: null };
    const next = { codes: ['64.91', '62'], en: { '64.91': 'warn', '62': 'ex' } as const, spino: null };
    expect(gkedGroupApply(rule, old, next, 'en')).toEqual({
      in: [],
      ex: ['66', '62'],
      warn: ['64.91'],
      strict: 'main',
    });
    // Группу удалили — её коды уходят из обоих перечней, пустой «Предупреждать» убирается.
    expect(gkedGroupApply({ in: [], ex: ['64'], warn: ['61'] }, old, null, 'en')).toEqual({
      in: [],
      ex: [],
    });
    // СПиНО у группы ничего не делает — перечни статуса меняются только удалением прежних кодов.
    expect(gkedGroupApply(null, null, next, 'spino')).toEqual({ in: [], ex: [] });
    expect(gkedGroupSignature({ in: ['A'], ex: ['1'], warn: ['2'] })).toBe(
      gkedGroupSignature({ in: [], ex: ['1'], warn: ['2'] }),
    );
  });
});
