import { bishkekDate, bishkekTime, formatDateRu, type AdminValueDict } from '@buhuchet/domain';
import type { AdminDictHistory } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

type Item = AdminDictHistory['items'][number];

const shown = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Что изменено, словами — как пишет прототип (admin/platform-dicts*.js, pdLog): «Формы: добавлено
 * «ОсОО»», «Органы: «ГНС» → «ГНС при МФ»», «отключено (было: активно)», «перемещено с № 3 на № 2»; у
 * УГНС — «изменено. Было: … Стало: …» по изменённым полям.
 */
export function dictHistoryText(dict: AdminValueDict, item: Item, t: Translate): string {
  const title = t(`pdicts.title.${dict}`);
  const name = item.label;
  if (item.action === 'create') return t('pdicts.hist.create', { dict: title, name });
  if (item.action === 'delete') return t('pdicts.hist.delete', { dict: title, name });
  const change = (field: string) => item.changes.find((c) => c.field === field);
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

/** Запись «Истории изменений» для ленты: дата и время по Бишкеку, что изменено, кто. */
export function dictHistoryItem(dict: AdminValueDict, item: Item, t: Translate): TimelineItem {
  const at = new Date(item.at);
  return {
    id: item.id,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: dictHistoryText(dict, item, t),
    who: item.actor ?? t('org.history.system'),
  };
}
