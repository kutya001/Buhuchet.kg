import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { dueWords } from './status-line';

// Слова о сроке в строке состояния карточки (прототип v134 ui/status-scale.js, `dueBit`): у просроченного —
// «просрочен на N дн.», иначе в ближайшие 14 дней — «сегодня» или «осталось N дн.», дальше — ничего.

const t = makeTranslate(defaultUiTexts());
const TODAY = '2026-11-18';

describe('dueWords — слова о сроке строки состояния', () => {
  it('просроченный: «просрочен на N дн.», «осталось» не показывается', () => {
    expect(dueWords(t, '2026-11-11', true, TODAY)).toEqual({
      late: 'просрочен на 7 дн.',
      left: null,
    });
    expect(dueWords(t, '2026-11-17', true, TODAY)).toEqual({
      late: 'просрочен на 1 дн.',
      left: null,
    });
  });

  it('срок сегодня — «сегодня»; в ближайшие 14 дней — «осталось N дн.»', () => {
    expect(dueWords(t, TODAY, false, TODAY)).toEqual({ late: null, left: 'сегодня' });
    expect(dueWords(t, '2026-11-19', false, TODAY)).toEqual({ late: null, left: 'осталось 1 дн.' });
    expect(dueWords(t, '2026-12-02', false, TODAY)).toEqual({
      late: null,
      left: 'осталось 14 дн.',
    });
  });

  it('дальше 14 дней — только дата, слов нет', () => {
    expect(dueWords(t, '2026-12-03', false, TODAY)).toEqual({ late: null, left: null });
  });

  it('срок прошёл, но запись не просрочена (сдана, закрыта) — слов нет', () => {
    expect(dueWords(t, '2026-11-10', false, TODAY)).toEqual({ late: null, left: null });
  });
});
