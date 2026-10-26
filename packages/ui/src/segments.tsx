'use client';

import { Icon } from './icon';
import type { IconName } from './icons';

/** Вариант переключателя: значение, подпись и значок. */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Размер кнопок: обычный (`.seg`) и маленький (`.seg.sm`, область группы прав). */
const SEGMENT_SIZES = {
  md: 'min-h-[26px] px-2.5 py-1 text-[12.5px]',
  sm: 'min-h-6 px-2 py-[3px] text-[12px]',
} as const;

/**
 * Переключатель из кнопок (прототип css/controls.css `.seg`, `.seg.sm`): выбранная кнопка светлая с
 * тенью. Для компоновки форм на телефоне помечен `data-segments`. `fill` — кнопки на всю ширину
 * (на телефоне в заголовке группы прав).
 */
export function Segments<T extends string>({
  options,
  value,
  onChange,
  label,
  fill = false,
  size = 'md',
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Название группы кнопок для экранного диктора. */
  label: string;
  fill?: boolean;
  size?: keyof typeof SEGMENT_SIZES;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-segments=""
      className={`gap-0.5 rounded-lg border border-line bg-pane-alt p-[3px] ${fill ? 'flex' : 'inline-flex'}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 ${SEGMENT_SIZES[size]} font-[550] focus-visible:outline-2 focus-visible:outline-accent ${fill ? 'flex-1' : ''} ${o.value === value ? 'bg-raised text-ink shadow-btn' : 'bg-transparent text-muted'}`}
        >
          {o.icon ? <Icon name={o.icon} size="sm" /> : null}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
