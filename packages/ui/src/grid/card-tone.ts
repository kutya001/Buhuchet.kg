import type { GridRowStripe, GridRowTone } from './types';

const STRIPE_COLOR: Record<GridRowStripe, string> = {
  info: 'border-l-info',
  violet: 'border-l-violet',
};

/**
 * Рамка и фон плитки записи — у вида «Карточки» и карточки доски (прототип `.gcard`, `.gcard.k-day`,
 * `.gcard.k-month`, `.gcard.overdue`, `.gcard.warn`): полоса слева — вид записи; просроченная — на
 * розовом фоне с красноватой рамкой, и полоса у неё того же цвета, что рамка; приглушения у плиток нет.
 * У одного свойства — один класс: цвет рамки и фон не ставятся дважды.
 */
export function cardToneClass(tone?: GridRowTone, stripe?: GridRowStripe): string {
  if (tone === 'overdue') {
    return `border-[color-mix(in_srgb,var(--bu-red)_40%,var(--bu-border))] bg-raised bg-[image:linear-gradient(var(--bu-red-bg),var(--bu-red-bg))] ${stripe ? 'border-l-[3px]' : ''}`;
  }
  if (stripe) return `border-line bg-raised border-l-[3px] ${STRIPE_COLOR[stripe]}`;
  if (tone === 'warn') return 'border-line bg-raised border-l-[3px] border-l-caution';
  return 'border-line bg-raised';
}
