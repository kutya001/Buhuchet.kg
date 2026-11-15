import { CP_NOTICE_DAYS, pluralForm } from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';

/** «за 5, 3 дня» (прототип `pgDaysTxt`): форма слова — по последнему числу. */
export function cpDaysText(t: Translate, days: readonly number[]): string {
  const list = CP_NOTICE_DAYS.filter((d) => days.includes(d));
  const last = list.at(-1) ?? 5;
  return t('tgn.cp.days_list', {
    list: list.join(', '),
    word: t(`tgn.remind.day.${pluralForm(last)}`),
  });
}
