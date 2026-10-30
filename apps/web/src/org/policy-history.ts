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
    // Сколько ждущих отчётов подтвердило выключение (прототип repConfSet: «…; считаются подтверждёнными: N»).
    case 'confirmedReports':
      return [t('report.confirm_off.history', { n: Number(change.to) })];
    case 'payBeforeSubmit':
      return [t('org.history.pay_first', { state: state(change.to) })];
    // Было → стало (ТЗ «История изменений учётной политики»; прототип пишет только новое значение).
    case 'confirmWaitDays':
      return [
        t('org.history.wait_days', {
          from: change.from === undefined ? '—' : Number(change.from),
          n: Number(change.to),
        }),
      ];
    case 'remindDays':
      return [
        t('org.history.remind_days', {
          from: list(change.from).join(', ') || '—',
          days: list(change.to).join(', ') || '—',
        }),
      ];
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
 * Запись «по опроснику» одной строкой, как в прототипе (modules/onboard.js, obApply): включены и
 * выключены функции, «Задачи требуют подтверждения»; ничего не изменилось — «без изменений».
 * «Пройден заново» — опросник из учётной политики (задача 2.33).
 */
function quizText(changes: readonly HistoryChange[], again: boolean, t: Translate): string {
  const features = changes.find((c) => c.field === 'features');
  const from = flags(features?.from);
  const to = flags(features?.to);
  const names = (list: Feature[]) =>
    list.map((f) => t('onboarding.history.name', { name: t(`org.feature.${f}`) })).join(', ');
  const on = features ? FEATURES.filter((f) => !from[f] && to[f]) : [];
  const off = features ? FEATURES.filter((f) => from[f] && !to[f]) : [];
  const confirm = changes.find((c) => c.field === 'taskConfirm');
  const parts = [
    on.length ? t('onboarding.history.on', { list: names(on) }) : '',
    off.length ? t('onboarding.history.off', { list: names(off) }) : '',
    confirm
      ? t('onboarding.history.task_confirm', {
          state: t(confirm.to ? 'org.history.on' : 'org.history.off'),
        })
      : '',
  ].filter(Boolean);
  return t(again ? 'onboarding.history.again' : 'onboarding.history.first', {
    text: parts.join('; ') || t('onboarding.history.same'),
  });
}

/**
 * Запись «Истории изменений учётной политики» для ленты: дата и время по Бишкеку, что изменено
 * словами (было → стало сравнивается здесь: включена или отключена функция, новый набор дней), кто
 * изменил; создание политики — «Учётная политика по умолчанию», опросник — «по опроснику»; причина — в
 * скобках.
 */
export function policyHistoryItem(item: HistoryItem, index: number, t: Translate): TimelineItem {
  const at = new Date(item.at);
  const quiz = item.changes.find((c) => c.field === 'quiz');
  const lines =
    item.action === 'create'
      ? [t('org.history.created')]
      : quiz
        ? [quizText(item.changes, quiz.to === 'again', t)]
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
