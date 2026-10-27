import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  pluralForm,
  type AdminValueDict,
} from '@buhuchet/domain';
import type { AdminDictHistory } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

type Item = AdminDictHistory['items'][number];

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Код страны словами прототипа (phoneCodeDlg): «Кыргызстан +996 XXX XXX XXX». Из полей — только
 * изменённые (кроме названия): прежних значений остальных полей в записи истории нет.
 */
function phoneText(item: Item, side: 'from' | 'to'): string | null {
  const change = (field: string) => item.changes.find((c) => c.field === field);
  const name = change('name');
  const dial = change('dialCode');
  const mask = change('mask');
  if (!name && !dial && !mask) return null;
  return [
    name ? shown(name[side]) : item.label,
    dial ? `+${shown(dial[side])}` : null,
    mask ? shown(mask[side]) : null,
  ]
    .filter((x) => x !== null)
    .join(' ');
}

/**
 * Что изменено, словами — как пишет прототип (admin/platform-dicts*.js, pdLog): «Формы: добавлено
 * «ОсОО»», «Органы: «ГНС» → «ГНС при МФ»», «отключено (было: активно)», «перемещено с № 3 на № 2»; у
 * УГНС — «изменено. Было: … Стало: …» по изменённым полям; у режима — «изменено: 2 поля», у
 * основания — «изменено», у кода страны — «было → стало» и «добавлено «…» +код».
 */
export function dictHistoryText(dict: AdminValueDict, item: Item, t: Translate): string {
  const title = t(`pdicts.title.${dict}`);
  const name = item.label;
  const change = (field: string) => item.changes.find((c) => c.field === field);
  if (item.action === 'create' && dict === 'phones') {
    return t('pdicts.hist.phone_create', {
      dict: title,
      name,
      code: shown(change('dialCode')?.to),
    });
  }
  if (item.action === 'create') return t('pdicts.hist.create', { dict: title, name });
  if (item.action === 'delete') return t('pdicts.hist.delete', { dict: title, name });
  const active = change('active');
  if (active) return t(active.to ? 'pdicts.hist.on' : 'pdicts.hist.off', { dict: title, name });
  const moved = change('n');
  if (moved) {
    return t('pdicts.hist.move', {
      dict: title,
      name,
      from: shown(moved.from),
      to: shown(moved.to),
    });
  }
  if (dict === 'ugns') {
    return t('pdicts.hist.ugns_update', {
      dict: title,
      name,
      from: item.changes.map((c) => shown(c.from)).join(' · '),
      to: item.changes.map((c) => shown(c.to)).join(' · '),
    });
  }
  if (dict === 'regimes') {
    const n = item.changes.length;
    return t(`pdicts.hist.fields_n.${pluralForm(n)}`, { dict: title, name, n });
  }
  if (dict === 'bases') return t('pdicts.hist.changed', { dict: title, name });
  const phone = dict === 'phones' ? phoneText(item, 'from') : null;
  if (phone) {
    return t('pdicts.hist.phone_update', { dict: title, from: phone, to: phoneText(item, 'to')! });
  }
  const renamed = change('name');
  if (renamed) {
    return t('pdicts.hist.rename', {
      dict: title,
      from: shown(renamed.from),
      to: shown(renamed.to),
    });
  }
  return t('pdicts.hist.fields', { dict: title, name });
}

// ОТКЛОНЕНИЕ: docs/deviations.md#Д-6
/**
 * Запись «Истории изменений» календаря: «Календарь: добавлено «04.01.2027 Перенос: Новый год»» и
 * «… удалено»; у рабочей субботы названия нет — «Рабочая суббота».
 */
export function calendarHistoryText(item: Item, t: Translate): string {
  const day = item.code;
  const date = /^\d{2}-\d{2}$/.test(day) ? `${day.slice(3)}.${day.slice(0, 2)}` : formatDateRu(day);
  const kind = item.changes.find((c) => c.field === 'kind');
  const name =
    item.label ||
    (kind && (kind.to ?? kind.from) === 'workday' ? t('dicts.platform.calendar.workday') : '');
  return t(item.action === 'delete' ? 'pdicts.cal.hist.delete' : 'pdicts.cal.hist.create', {
    date,
    name,
  });
}

/** Запись «Истории изменений» для ленты: дата и время по Бишкеку, что изменено, кто. */
export function dictHistoryItem(
  dict: AdminValueDict | 'calendar',
  item: Item,
  t: Translate,
): TimelineItem {
  const at = new Date(item.at);
  return {
    id: item.id,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: dict === 'calendar' ? calendarHistoryText(item, t) : dictHistoryText(dict, item, t),
    who: item.actor ?? t('org.history.system'),
  };
}
