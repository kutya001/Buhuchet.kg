import { UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { gridLabels } from './grid-labels';

describe('подписи списка', () => {
  const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
  const labels = gridLabels(makeTranslate(texts), 'grid.count');

  it('«Показано 1 – 5 000 из 8 200» — с разрядами, как суммы (прототип ui/grid.js)', () => {
    expect(labels.shown(1, 5000, 8200)).toBe('Показано 1 – 5 000 из 8 200');
    expect(labels.shown(26, 50, 250)).toBe('Показано 26 – 50 из 250');
  });
});
