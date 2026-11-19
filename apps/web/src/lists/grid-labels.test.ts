import { UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { gridLabels } from './grid-labels';

describe('подписи списка', () => {
  const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
  const labels = gridLabels(makeTranslate(texts), 'grid.count');

  it('«1–5 000 из 8 200» — с разрядами, как суммы (прототип v139 ui/grid.js)', () => {
    expect(labels.shown(1, 5000, 8200)).toBe('1–5 000 из 8 200');
    expect(labels.shown(26, 50, 250)).toBe('26–50 из 250');
  });
});
