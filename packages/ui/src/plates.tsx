'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { linkButtonClass } from './button';
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
        className="flex items-center gap-2 text-[12.5px] font-semibold text-muted max-md:group-data-row/plates:block max-md:group-data-row/plates:text-[11.5px] max-md:group-data-row/plates:leading-[1.25] max-md:group-data-static/plates:gap-1.5 max-md:group-data-static/plates:text-[11.5px]"
      >
        <span
          data-plate-dot={color}
          className={`grid h-6 w-6 flex-none place-items-center rounded-[7px] max-md:group-data-row/plates:hidden max-md:group-data-static/plates:h-5 max-md:group-data-static/plates:w-5 ${DOT[color]}`}
        >
          <Icon name={icon} size="sm" />
        </span>
        {label}
      </span>
      {value !== undefined && (
        <span
          data-plate-value
          className={`text-[25px] leading-[1.05] font-[720] tracking-[-0.025em] tabular-nums max-md:text-[21px] max-md:group-data-row/plates:text-[18px] max-md:group-data-static/plates:text-[18px] ${color === 'red' ? 'max-md:group-data-row/plates:text-danger' : ''}`}
        >
          {value}
          {unit && (
            <small className="ml-[3px] text-[13px] font-[550] tracking-normal text-faint max-md:group-data-row/plates:text-[11px]">
              {unit}
            </small>
          )}
        </span>
      )}
      {sub && (
        <span
          data-plate-sub
          className="text-[12px] text-faint group-data-static/plates:leading-[1.35] max-md:group-data-row/plates:hidden max-md:group-data-static/plates:line-clamp-2 max-md:group-data-static/plates:text-[11px]"
        >
          {sub}
        </span>
      )}
    </>
  );
  // Телефон, плашки модуля (прототип v139–v141 css/mobile.css): число сверху, подпись под ним, без
  // значка и пояснения; красное число — только у красной плашки (просрочка).
  const box =
    'flex min-w-0 flex-col gap-[7px] rounded-xl border border-line bg-raised px-3.5 pt-3 pb-[13px] text-left text-ink max-md:group-data-row/plates:min-w-min max-md:group-data-row/plates:flex-[1_1_0] max-md:group-data-row/plates:flex-col-reverse max-md:group-data-row/plates:justify-end max-md:group-data-row/plates:gap-px max-md:group-data-row/plates:rounded-[10px] max-md:group-data-row/plates:px-[9px] max-md:group-data-row/plates:py-[7px] max-md:group-data-all/plates:basis-[30%] max-md:group-data-static/plates:gap-1 max-md:group-data-static/plates:px-3 max-md:group-data-static/plates:py-2.5';
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

/** Подписи «Ещё N» и «Свернуть» ряда плашек на телефоне (даёт приложение из словаря). */
export interface PlatesLabels {
  more: (n: number) => string;
  less: string;
}

const PlatesLabelsContext = createContext<PlatesLabels | null>(null);

export function PlatesLabelsProvider({
  labels,
  children,
}: {
  labels: PlatesLabels;
  children: ReactNode;
}) {
  return <PlatesLabelsContext.Provider value={labels}>{children}</PlatesLabelsContext.Provider>;
}

/** Телефон: на виду три плашки; «Ещё N» раскрывает остальные, если их больше четырёх (прототип `plMob`). */
export const PLATES_ROW = 3;
export const PLATES_ALL_MAX = 4;

/** Сколько плашек прячется за «Ещё N»; 0 — все на виду. */
export function platesHidden(count: number): number {
  return count > PLATES_ALL_MAX ? count - PLATES_ROW : 0;
}

/** Раскрытые ряды плашек — по адресу страницы, до перезагрузки (прототип `PL_ALL`: на сеанс). */
const OPENED = new Set<string>();

/**
 * Статистика модуля — ряд плашек-итогов над списком (прототип `.plates`; ТЗ «Статистика модуля
 * (плашки-итоги)»): на ПК — сколько поместится, не уже 158 px. На телефоне (прототип v139–v141,
 * решение заказчика 17.11.2026) — одна строка из трёх чисел с подписями; плашек больше четырёх —
 * «Ещё N» раскрывает остальные, «Свернуть» прячет. Скрыта кнопкой «Статистика» в ряду вкладок
 * (`shown` = false) — ряда нет. `static` — плашки внутри окна (`.plates.static`): на ПК не уже 200 px,
 * на телефоне по две в строку и компактнее — число 18 px, пояснение в две строки.
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
  const labels = useContext(PlatesLabelsContext);
  const row = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [opened, setOpened] = useState(false);
  useLayoutEffect(() => {
    if (!shown || inWindow) return;
    setCount(row.current?.children.length ?? 0);
    setOpened(OPENED.has(window.location.pathname));
  }, [shown, inWindow, children]);
  if (!shown) return null;
  // Без подписей (экран вне оболочки) ряд не сворачивается.
  const hidden = labels && !inWindow ? platesHidden(count) : 0;
  const all = hidden === 0 || opened;
  const toggle = () => {
    const key = window.location.pathname;
    if (opened) OPENED.delete(key);
    else OPENED.add(key);
    setOpened(!opened);
  };
  return (
    <>
      <div
        ref={row}
        data-plates
        data-static={inWindow ? '' : undefined}
        data-row={inWindow ? undefined : ''}
        data-all={!inWindow && all ? '' : undefined}
        className={`group/plates grid gap-2.5 ${inWindow ? 'grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 max-md:gap-2' : 'grid-cols-[repeat(auto-fit,minmax(158px,1fr))] max-md:flex max-md:flex-nowrap max-md:gap-1.5 max-md:data-all:flex-wrap max-md:[&:not([data-all])>:nth-child(n+4)]:hidden'}`}
      >
        {children}
      </div>
      {labels && hidden > 0 && (
        <button
          type="button"
          data-plates-more
          aria-expanded={opened}
          onClick={toggle}
          className={`${linkButtonClass()} -mt-1.5 hidden min-h-8 self-start text-[13px] max-md:inline-flex max-md:items-center`}
        >
          {opened ? labels.less : labels.more(hidden)}
        </button>
      )}
    </>
  );
}
