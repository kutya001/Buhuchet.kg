import type { StatusTone } from '@buhuchet/domain';

/**
 * Цвета статуса по справочнику «Статусы» (прототип `.sc-<цвет>`: `--sc` — цвет статуса, `--scb` —
 * подложка; `.pill.<цвет>`). Текст и метки — токенами не ниже 4,5 : 1 (серые и бледные — `label`),
 * кружок номера текущего шага и залитые точки — `*-btn` со светлым текстом (docs/deviations.md, п. 26).
 */
export interface StatusToneClasses {
  /** Цвет статуса текстом: «2/3» компактной шкалы, отметка шага. */
  text: string;
  /** Метка статуса (`.pill.<цвет>`). */
  pill: string;
  /** Текущий шаг шкалы: рамка и подложка (`.scf-s.c`) — отдельно, чтобы рамку заменял пунктир шага-действия. */
  stepBorder: string;
  stepBg: string;
  /** Кружок номера текущего шага (`.scf-s.c .n`). */
  number: string;
  /** Точка шага компактной шкалы (`.scm-d i`) и обводка текущей. */
  dot: string;
  ring: string;
}

export const STATUS_TONE: Readonly<Record<StatusTone, StatusToneClasses>> = {
  gray: {
    text: 'text-label',
    pill: 'bg-label-bg text-label',
    stepBorder: 'border-label/35',
    stepBg: 'bg-btn',
    number: 'border-gray-btn bg-gray-btn',
    dot: 'border-label bg-label',
    ring: 'ring-btn',
  },
  blue: {
    text: 'text-info',
    pill: 'bg-info-bg text-info',
    stepBorder: 'border-info/35',
    stepBg: 'bg-info-bg',
    number: 'border-info-btn bg-info-btn',
    dot: 'border-info bg-info',
    ring: 'ring-info-bg',
  },
  yellow: {
    text: 'text-warn-label',
    pill: 'bg-warn-bg text-warn-label',
    stepBorder: 'border-warn/35',
    stepBg: 'bg-warn-bg',
    number: 'border-warn-btn bg-warn-btn',
    dot: 'border-warn bg-warn',
    ring: 'ring-warn-bg',
  },
  green: {
    text: 'text-ok',
    pill: 'bg-ok-bg text-ok',
    stepBorder: 'border-ok/35',
    stepBg: 'bg-ok-bg',
    number: 'border-ok-btn bg-ok-btn',
    dot: 'border-ok bg-ok',
    ring: 'ring-ok-bg',
  },
  orange: {
    text: 'text-caution-label',
    pill: 'bg-caution-bg text-caution-label',
    stepBorder: 'border-caution/35',
    stepBg: 'bg-caution-bg',
    number: 'border-caution-btn bg-caution-btn',
    dot: 'border-caution bg-caution',
    ring: 'ring-caution-bg',
  },
  red: {
    text: 'text-danger-label',
    pill: 'bg-danger-bg text-danger-label',
    stepBorder: 'border-danger/35',
    stepBg: 'bg-danger-bg',
    number: 'border-danger-btn bg-danger-btn',
    dot: 'border-danger bg-danger',
    ring: 'ring-danger-bg',
  },
  purple: {
    text: 'text-violet',
    pill: 'bg-violet-bg text-violet',
    stepBorder: 'border-violet/35',
    stepBg: 'bg-violet-bg',
    number: 'border-violet-btn bg-violet-btn',
    dot: 'border-violet bg-violet',
    ring: 'ring-violet-bg',
  },
  faint: {
    text: 'text-label',
    pill: 'bg-faint-pill-bg text-label shadow-[inset_0_0_0_1px_var(--bu-border)]',
    stepBorder: 'border-faint/35',
    stepBg: 'bg-btn',
    number: 'border-faint-btn bg-faint-btn',
    dot: 'border-faint bg-faint',
    ring: 'ring-btn',
  },
};
