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
  /** Число или сумма строкой («12», «1 250,50»); нули показываются, а не пустое место (ТЗ). */
  value: string;
  /** Единица мелко после числа: «сом». */
  unit?: string;
  /** Пояснение под числом. */
  sub?: ReactNode;
  /** Фильтр плашки стоит в списке — плашка нажата. */
  on?: boolean;
  /** Нажатие: поставить или снять фильтр списка, открыть вкладку. Без него — только итог. */
  onClick?: () => void;
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
}: PlateProps) {
  const content = (
    <>
      <span className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        <span className={`grid h-6 w-6 flex-none place-items-center rounded-[7px] ${DOT[color]}`}>
          <Icon name={icon} size="sm" />
        </span>
        {label}
      </span>
      <span className="text-[25px] leading-[1.05] font-[720] tracking-[-0.025em] tabular-nums max-md:text-[21px]">
        {value}
        {unit && (
          <small className="ml-[3px] text-[13px] font-[550] tracking-normal text-faint">
            {unit}
          </small>
        )}
      </span>
      {sub && <span className="text-[12px] text-faint">{sub}</span>}
    </>
  );
  const box =
    'flex min-w-0 flex-col gap-[7px] rounded-xl border border-line bg-raised px-3.5 pt-3 pb-[13px] text-left text-ink';
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
 * 21 px. Скрыта кнопкой «Статистика» в ряду вкладок (`shown` = false) — ряда нет. Плашки внутри
 * карточки записи (компактнее на телефоне, `.plates.static`) добавят экраны карточек.
 */
export function Plates({ shown = true, children }: { shown?: boolean; children: ReactNode }) {
  if (!shown) return null;
  return (
    <div
      data-plates
      className="grid grid-cols-[repeat(auto-fit,minmax(158px,1fr))] gap-2.5 max-md:grid-cols-2"
    >
      {children}
    </div>
  );
}
