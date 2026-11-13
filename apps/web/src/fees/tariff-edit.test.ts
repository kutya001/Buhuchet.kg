import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { tariffGone, tariffSavedText } from './tariff-edit';

// Сообщение после правки ставки (прототип v86 modules/contractor-card.js, `tariffEditDlg`): долг вырос,
// уменьшился или не изменился; docs/deviations.md п. О-78.

const t = makeTranslate(defaultUiTexts());

describe('сообщение после «Изменить ставку обслуживания»', () => {
  it('долг вырос — «вырос на …», уменьшился — «уменьшился на …»', () => {
    expect(tariffSavedText(t, { changed: true, debtDelta: 983_900 })).toMatch(
      /^Ставка изменена: долг за обслуживание вырос на 9\s839/,
    );
    expect(tariffSavedText(t, { changed: true, debtDelta: -500_000 })).toMatch(
      /^Ставка изменена: долг за обслуживание уменьшился на 5\s000/,
    );
  });

  it('долг не изменился — «Ставка изменена»; правок нет — «Изменений нет»', () => {
    expect(tariffSavedText(t, { changed: true, debtDelta: 0 })).toBe('Ставка изменена');
    expect(tariffSavedText(t, null)).toBe('Ставка изменена');
    expect(tariffSavedText(t, { changed: false, debtDelta: 0 })).toBe('Изменений нет');
  });

  it('ставку изменил или удалил другой пользователь — окно закрывается', () => {
    expect(tariffGone('record_changed')).toBe(true);
    expect(tariffGone('tariff_not_found')).toBe(true);
    expect(tariffGone('tariff_edit_month_taken')).toBe(false);
  });
});
