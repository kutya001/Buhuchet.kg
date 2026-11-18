'use client';

import { diffDays, type IsoDate } from '@buhuchet/domain';
import { StatusMini, StatusMiniNone, StatusPill } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { miniView } from './status-view';

/** Шкала коротко, без строки «когда» — для строки состояния карточки (прототип `scaleMini0`). */
export function MiniScale({ t, input }: { t: Translate; input: Parameters<typeof miniView>[1] }) {
  const view = miniView(t, { ...input, history: [] });
  if (view.kind === 'none') return <StatusMiniNone label={view.label} title={view.title} />;
  if (view.kind === 'pill') return <StatusPill {...view.pill} size="sm" />;
  return <StatusMini {...view.props} />;
}

/**
 * Слова о сроке для строки состояния (прототип `dueBit`): «просрочен на N дн.» у просроченного, иначе в
 * ближайшие две недели — «сегодня» или «осталось N дн.».
 */
export function dueWords(t: Translate, date: IsoDate, late: boolean, today: IsoDate) {
  const n = diffDays(date, today);
  return {
    late: late ? t('status.line.late', { n: -n }) : null,
    left:
      late || n < 0 || n > 14
        ? null
        : n === 0
          ? t('status.line.today')
          : t('status.line.left', { n }),
  };
}
