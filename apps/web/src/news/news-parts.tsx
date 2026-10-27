'use client';

import {
  bishkekDate,
  formatDateRu,
  NEWS_TYPE_COLORS,
  type IsoDate,
  type NewsType,
} from '@buhuchet/domain';
import { pillClass } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Цвет метки типа (прототип NEWS_T: синий, зелёный, оранжевый, фиолетовый). */
const TYPE_TONES = {
  blue: 'bg-info-bg text-info-label',
  green: 'bg-ok-bg text-ok',
  orange: 'bg-caution-bg text-caution-label',
  purple: 'bg-violet-bg text-violet',
} as const;

/** Метка типа новости (прототип newsPill). */
export function NewsTypePill({ type, t }: { type: NewsType; t: Translate }) {
  return (
    <span
      data-news-type={type}
      className={`${pillClass('sm')} ${TYPE_TONES[NEWS_TYPE_COLORS[type]]}`}
    >
      {t(`news.type.${type}`)}
    </span>
  );
}

/** «Новое» у непрочитанной новости (прототип `.pill.sm.red`). */
export function NewsFreshPill({ t }: { t: Translate }) {
  return (
    <span data-news-fresh="" className={`${pillClass('sm')} bg-danger-bg text-danger-label`}>
      {t('news.new')}
    </span>
  );
}

/** Дата момента по Бишкеку: «изменено 21.10.2026». */
export const momentDate = (iso: string) => formatDateRu(bishkekDate(new Date(iso)));

/**
 * Строка под заголовком (прототип newsOpen, renderNews): «20.10.2026 · версия 1.4», у исправленной
 * опубликованной — ещё «· изменено 21.10.2026».
 */
export function newsMeta(
  t: Translate,
  n: { date: IsoDate; release: string | null; editedAt?: string | null },
): string {
  return [
    formatDateRu(n.date),
    n.release ? t('news.meta.version', { v: n.release }) : null,
    n.editedAt ? t('news.meta.edited', { date: momentDate(n.editedAt) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
