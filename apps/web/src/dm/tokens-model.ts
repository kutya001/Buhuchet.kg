import { pluralForm, type DmTokenState } from '@buhuchet/domain';
import type { IconName, Pill } from '@buhuchet/ui';
import type { ComponentProps } from 'react';
import type { Translate } from '../l10n/translate';

type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/** Состояние токена: цвет и значок (прототип `DM_TST`). */
export const TOKEN_PILL: Readonly<Record<DmTokenState, { tone: PillTone; icon: IconName }>> = {
  active: { tone: 'ok', icon: 'check' },
  stopped: { tone: 'warn', icon: 'pause' },
  expired: { tone: 'plain', icon: 'clock' },
  revoked: { tone: 'plain', icon: 'ban' },
};

/** «30 дней», «7 дней» (прототип: `${d} ${plural(d,'день','дня','дней')}`). */
export function tokenTermText(t: Translate, days: number): string {
  return t(`dm.tok.term.${pluralForm(days)}`, { n: days });
}
