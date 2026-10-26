import type { ReactNode } from 'react';
import { TOUCH_AREA } from './button';
import { Icon } from './icon';

/**
 * Плашка (`.chip` прототипа, grid.css): голубая, со скруглением; с `onClear` — крестик убирает её
 * (фильтр над списком, день напоминания «за 7 дней»). `id` — в `data-chip`.
 */
export function Chip({
  id,
  clear,
  onClear,
  children,
}: {
  id?: string;
  /** Подсказка и подпись крестика для экранного диктора. */
  clear?: string;
  onClear?: () => void;
  children: ReactNode;
}) {
  return (
    <span
      data-chip={id ?? ''}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-bg py-0.5 pr-1 pl-2.5 text-[12.5px] font-[550] text-info"
    >
      <span className="truncate">{children}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clear}
          title={clear}
          className={`${TOUCH_AREA} grid h-5 w-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-inherit hover:bg-info-bg`}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </span>
  );
}
