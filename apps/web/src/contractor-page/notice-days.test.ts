import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { cpDaysText } from './notice-days';

// Дни строк «К оплате» и «Оплата за обслуживание» словами (доработки 14.11.2026, блок 3, этап 2;
// прототип v115 modules/cp-telegram.js: pgDaysTxt — «за 5, 3 дня», форма слова — по последнему числу).

const t = makeTranslate(defaultUiTexts());

describe('cpDaysText', () => {
  it('дни — от большего к меньшему, форма слова — по последнему', () => {
    expect(cpDaysText(t, [5])).toBe('за 5 дней');
    expect(cpDaysText(t, [2])).toBe('за 2 дня');
    expect(cpDaysText(t, [1])).toBe('за 1 день');
    expect(cpDaysText(t, [1, 5, 3])).toBe('за 5, 3, 1 день');
    expect(cpDaysText(t, [4, 2])).toBe('за 4, 2 дня');
  });

  it('чужие числа не показываются', () => {
    expect(cpDaysText(t, [7, 3])).toBe('за 3 дня');
  });
});
