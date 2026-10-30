import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { templateHint, unknownVarsMessage } from './template-hint';

// Админка → «Справочники платформы» → «Шаблоны»: подсказка под шаблоном и ошибка о подстановке —
// как в прототипе (TPL_NOTES, tplVarError).

const t = makeTranslate(defaultUiTexts());

describe('«Шаблоны»: подстановки под шаблоном', () => {
  it('перечислены подстановки; без подстановок — «Без подстановок»', () => {
    expect(templateHint(t, { note: '', variables: ['логин', 'кто'] })).toBe(
      'Подстановки: {логин}, {кто}',
    );
    expect(templateHint(t, { note: '', variables: [] })).toBe('Без подстановок');
  });

  it('лишняя подстановка: доступные или «В этом шаблоне подстановок нет»', () => {
    expect(unknownVarsMessage(t, '{x}', '{логин}')).toBe(
      'Нет такой подстановки: {x}. Доступны: {логин}',
    );
    expect(unknownVarsMessage(t, '{x}', '')).toBe(
      'Нет такой подстановки: {x}. В этом шаблоне подстановок нет',
    );
  });
});
