import {
  bishkekDate,
  bishkekTime,
  FEATURES,
  formatDateRu,
  PAGE_SECTIONS,
  type Feature,
  type PageSection,
} from '@buhuchet/domain';
import type { OrgPolicyHistory } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

type HistoryItem = OrgPolicyHistory['items'][number];
type HistoryChange = HistoryItem['changes'][number];

const flags = (value: unknown): Partial<Record<Feature, boolean>> =>
  value && typeof value === 'object' ? (value as Partial<Record<Feature, boolean>>) : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Строки одного изменения — словами, как записи прототипа (modules/org.js: log('org', 'policy', …)). */
function changeLines(change: HistoryChange, t: Translate): string[] {
  const state = (v: unknown) => t(v ? 'org.history.on' : 'org.history.off');
  switch (change.field) {
    case 'features': {
      const from = flags(change.from);
      const to = flags(change.to);
      return FEATURES.filter((f) => Boolean(from[f]) !== Boolean(to[f])).map((f) =>
        t(to[f] ? 'org.history.feature_on' : 'org.history.feature_off', {
          name: t(`org.feature.${f}`),
        }),
      );
    }
    case 'taskConfirm':
      return [t('org.history.task_confirm', { state: state(change.to) })];
    case 'reportConfirm':
      return [t('org.history.report_confirm', { state: state(change.to) })];
    case 'payBeforeSubmit':
      return [t('org.history.pay_first', { state: state(change.to) })];
    case 'confirmWaitDays':
      return [t('org.history.wait_days', { n: Number(change.to) })];
    case 'remindDays':
      return [t('org.history.remind_days', { days: list(change.to).join(', ') || '—' })];
    case 'pageSections': {
      const from = new Set(list(change.from));
      const to = new Set(list(change.to));
      return PAGE_SECTIONS.filter((s: PageSection) => from.has(s) !== to.has(s)).map((s) =>
        t(to.has(s) ? 'org.history.page_on' : 'org.history.page_off', {
          name: t(`org.page.section.${s}`),
        }),
      );
    }
    default:
      return [];
  }
}

/**
 * Запись «Истории изменений учётной политики» для ленты: дата и время по Бишкеку, что изменено
 * словами (было → стало сравнивается здесь: включена или отключена функция, новый набор дней), кто
 * изменил; создание политики — «Учётная политика по умолчанию»; причина — в скобках.
 */
export function policyHistoryItem(item: HistoryItem, index: number, t: Translate): TimelineItem {
  const at = new Date(item.at);
  const lines =
    item.action === 'create'
      ? [t('org.history.created')]
      : item.changes.flatMap((c) => changeLines(c, t));
  const text = lines.join('; ');
  return {
    id: `${item.at}-${index}`,
    date: formatDateRu(bishkekDate(at)),
    time: bishkekTime(at),
    text: item.reason ? t('org.history.reason', { text, reason: item.reason }) : text,
    who: item.actor ?? t('org.history.system'),
  };
}
