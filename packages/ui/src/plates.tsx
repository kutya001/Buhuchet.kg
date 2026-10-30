'use client';

import type { ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icons';

/** Цвет кружка со значком плашки (`.pl-dot.<цвет>` прототипа). */
export type PlateColor = 'red' | 'yellow' | 'green' | 'blue' | 'orange' | 'purple' | 'gray';

const DOT: Record<PlateColor, string> = {
  red: 'bg-danger-bg text-danger',
  yellow: 'bg-warn-bg text-warn',
  green: 'bg-ok-bg text-ok',
  blue: 'bg-info-bg text-info',
  orange: 'bg-caution-bg text-caution',
  purple: 'bg-violet-bg text-violet',
  gray: 'bg-sel text-muted',
};

export interface PlateProps {
  id: string;
  icon: IconName;
  color: PlateColor;
  label: string;
  /**
   * Число или сумма строкой («12», «1 250,50»); нули показываются, а не пустое место (ТЗ). Без значения —
   * плашка-действие из подписи и пояснения («Добавить язык» в «Локализации»).
   */
  value?: string;
  /** Единица мелко после числа: «сом». */
  unit?: string;
  /** Пояснение под числом. */
  sub?: ReactNode;
  /** Фильтр плашки стоит в списке — плашка нажата. */
  on?: boolean;
  /** Нажатие: поставить или снять фильтр списка, открыть вкладку. Без него — только итог. */
  onClick?: () => void;
  /** Недоступная плашка-действие: видна бледной, не нажимается (прототип `disabled`, `opacity:.6`). */
  disabled?: boolean;
}

/**
 * Плашка-итог (прототип modules/home.js, `plate`; стили `.plate`, `.pl-top`, `.pl-dot`, `.pl-val`,
 * `.pl-sub`): значок в цветном кружке и подпись, крупное число, пояснение. Нажатая плашка-фильтр —
 * вдавлена; плашка без действия не нажимается.
 */
export function Plate({
  id,
  icon,
  color,
  label,
  value,
  unit,
  sub,
  on = false,
  onClick,
  disabled = false,
}: PlateProps) {
  const content = (
    <>
      <span
        data-plate-label
        className="flex items-center gap-2 text-[12.5px] font-semibold text-muted max-md:group-data-static/plates:gap-1.5 max-md:group-data-static/plates:text-[11.5px]"
      >
        <span
          className={`grid h-6 w-6 flex-none place-items-center rounded-[7px] max-md:group-data-static/plates:h-5 max-md:group-data-static/plates:w-5 ${DOT[color]}`}
        >
          <Icon name={icon} size="sm" />
        </span>
        {label}
      </span>
      {value !== undefined && (
        <span
          data-plate-value
          className="text-[25px] leading-[1.05] font-[720] tracking-[-0.025em] tabular-nums max-md:text-[21px] max-md:group-data-static/plates:text-[18px]"
        >
          {value}
          {unit && (
            <small className="ml-[3px] text-[13px] font-[550] tracking-normal text-faint">
              {unit}
            </small>
          )}
        </span>
      )}
      {sub && (
        <span
          data-plate-sub
          className="text-[12px] text-faint group-data-static/plates:leading-[1.35] max-md:group-data-static/plates:line-clamp-2 max-md:group-data-static/plates:text-[11px]"
        >
          {sub}
        </span>
      )}
    </>
  );
  const box =
    'flex min-w-0 flex-col gap-[7px] rounded-xl border border-line bg-raised px-3.5 pt-3 pb-[13px] text-left text-ink max-md:group-data-static/plates:gap-1 max-md:group-data-static/plates:px-3 max-md:group-data-static/plates:py-2.5';
  if (disabled) {
    return (
      <button
        type="button"
        data-plate={id}
        disabled
        className={`${box} cursor-not-allowed font-[inherit] opacity-60`}
      >
        {content}
      </button>
    );
  }
  if (!onClick) {
    return (
      <div data-plate={id} className={box}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-plate={id}
      aria-pressed={on}
      onClick={onClick}
      className={`${box} cursor-pointer font-[inherit] transition-[transform,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${on ? 'shadow-btn-active' : 'hover:-translate-y-px hover:shadow-pane'}`}
    >
      {content}
    </button>
  );
}

/**
 * Статистика модуля — ряд плашек-итогов над списком (прототип `.plates`; ТЗ «Статистика модуля
 * (плашки-итоги)»): на ПК — сколько поместится, не уже 158 px, на телефоне — по две в строку, число
 * 21 px. Скрыта кнопкой «Статистика» в ряду вкладок (`shown` = false) — ряда нет. `static` — плашки
 * внутри окна (`.plates.static`): на ПК не уже 200 px, на телефоне компактнее — число 18 px, пояснение
 * в две строки.
 */
export function Plates({
  shown = true,
  static: inWindow = false,
  children,
}: {
  shown?: boolean;
  static?: boolean;
  children: ReactNode;
}) {
  if (!shown) return null;
  return (
    <div
      data-plates
      data-static={inWindow ? '' : undefined}
      className={`group/plates grid gap-2.5 max-md:grid-cols-2 ${inWindow ? 'grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:gap-2' : 'grid-cols-[repeat(auto-fit,minmax(158px,1fr))]'}`}
    >
      {children}
    </div>
  );
}
