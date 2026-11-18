'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useFadeAway } from './fade-away';
import { PHONE_QUERY, useMediaQuery } from './use-media';
import { useSwipeDown } from './use-swipe-down';

const PLACEMENTS = {
  'bottom-start': 'top-full left-0 mt-1.5',
  'bottom-end': 'top-full right-0 mt-1.5',
  'top-end': 'bottom-full right-0 mb-2',
} as const;

export interface PopoverProps {
  /** Кнопка, которая открывает окошко: `toggle` по нажатию, `open` и `id` — для aria-expanded/controls. */
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  /** Содержимое; `close` закрывает окошко (например, после выбора пункта меню). */
  children: (close: () => void) => ReactNode;
  /** Название окошка для экранного диктора. */
  label: string;
  /** dialog — пояснение, menu — список действий. */
  role?: 'dialog' | 'menu';
  placement?: keyof typeof PLACEMENTS;
  /** Окошко с пояснением — с полями, меню — без (`.pop.pad` / `.pop` прототипа). */
  padded?: boolean;
  /** Открыто с первой отрисовки (для проверок разметки). */
  defaultOpen?: boolean;
  /**
   * На ПК с мышью открывается и при наведении: через 300 мс, закрывается, когда указатель ушёл с кнопки
   * и окошка (как «ⓘ» прототипа, ui/popups.js). На телефоне — только нажатием.
   */
  hover?: boolean;
  /** Классы обёртки (например, кнопка «+» на телефоне закреплена в углу экрана вместе с меню). */
  className?: string;
}

const HOVER_QUERY = '(hover: hover) and (min-width: 768px)';
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 220;
/** Отступ окошка от края экрана (openPop прототипа: `x = max(8, min(x, W - w - 8))`). */
const EDGE = 8;

/**
 * На телефоне любое меню и всплывающее окошко — лист снизу (прототип v131, css/mobile.css
 * `.pop:not(.bell-pop)`; решение заказчика 17.11.2026): во всю ширину, не выше 80 % экрана, с ручкой
 * сверху и затемнением вокруг; выезжает снизу и уезжает вниз. Место, заданное в `style`, на телефоне не
 * действует.
 */
export const PHONE_SHEET =
  "max-md:fixed max-md:top-auto! max-md:right-0! max-md:bottom-0! max-md:left-0! max-md:m-0 max-md:w-full max-md:max-w-none max-md:min-w-0 max-md:max-h-[80dvh] max-md:translate-none! max-md:rounded-t-2xl max-md:rounded-b-none max-md:border-b-0 max-md:px-2 max-md:pt-[18px] max-md:pb-[calc(10px+env(safe-area-inset-bottom,0px))] max-md:shadow-[0_0_0_100vmax_var(--bu-cover),var(--bu-shadow-l)] max-md:animate-sheet-in max-md:before:absolute max-md:before:top-[7px] max-md:before:left-1/2 max-md:before:-ml-5 max-md:before:h-1 max-md:before:w-10 max-md:before:rounded max-md:before:bg-line-strong max-md:before:content-['']";

/** Уход меню и окошка: на ПК гаснет, на телефоне лист уезжает вниз (`useFadeAway`). */
export const POP_LEAVE = 'animate-fade-out max-md:animate-sheet-out';

/** Сдвиг по горизонтали, чтобы окошко `left…right` не выходило за край экрана шириной `width`. */
export function edgeShift(left: number, right: number, width: number): number {
  if (left < EDGE) return EDGE - left;
  if (right > width - EDGE) return Math.max(EDGE - left, width - EDGE - right);
  return 0;
}

/**
 * Всплывающее окошко у кнопки (прототип ui/popups.js, openPop; стиль `.pop`): описание модуля «ⓘ»,
 * «?» и меню «+ Добавить». На телефоне — лист снизу (`PHONE_SHEET`), рисуется в `document.body`: так его
 * не обрезает и не сдвигает окно или панель, внутри которых стоит кнопка. Закрывается повторным нажатием, клавишей Esc, нажатием вне окошка, кнопкой
 * «Назад» (переход при этом не отменяется) и на телефоне протяжкой вниз; при открытии нажатием фокус
 * переходит в окошко, при закрытии по Esc — обратно на кнопку. Пока окошко открыто, свайп по вкладкам
 * не начинается (`data-overlay`), а Esc внутри окна закрывает сначала окошко (`data-popover`).
 */
export function Popover({
  trigger,
  children,
  label,
  role = 'dialog',
  placement = 'bottom-start',
  padded = false,
  defaultOpen = false,
  hover = false,
  className = 'relative inline-flex',
}: PopoverProps) {
  // Как открыто: нажатием (фокус переходит в окошко) или наведением (уход указателя закрывает).
  const [openBy, setOpenBy] = useState<'click' | 'hover' | null>(defaultOpen ? 'click' : null);
  const open = openBy !== null;
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const phone = useMediaQuery(PHONE_QUERY);
  const close = useCallback(() => setOpenBy(null), []);
  // Открытое наведением нажатие оставляет открытым (как в прототипе), открытое нажатием — закрывает.
  const toggle = useCallback(() => setOpenBy((v) => (v === 'click' ? null : 'click')), []);

  const pointerEnter = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType !== 'mouse' || !window.matchMedia(HOVER_QUERY).matches) return;
    clearTimeout(timer.current);
    if (open) return;
    timer.current = setTimeout(() => setOpenBy((v) => v ?? 'hover'), HOVER_OPEN_MS);
  };
  const pointerLeave = () => {
    clearTimeout(timer.current);
    if (openBy === 'hover') {
      timer.current = setTimeout(
        () => setOpenBy((v) => (v === 'hover' ? null : v)),
        HOVER_CLOSE_MS,
      );
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useSwipeDown(panel, { enabled: open, onClose: close });
  useFadeAway(panel, open);

  // Окошко у кнопки посреди ряда (например, «Столбцы» на телефоне) не уходит за край экрана.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.translate = '';
    if (phone) return;
    const rect = el.getBoundingClientRect();
    const shift = edgeShift(rect.left, rect.right, document.documentElement.clientWidth);
    if (shift) el.style.translate = `${shift}px 0`;
  }, [open, phone]);

  useEffect(() => {
    if (!openBy) return;
    if (openBy === 'click') {
      panel.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus();
    }
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      // На телефоне лист нарисован вне обёртки кнопки.
      if (box.current?.contains(target) || panel.current?.contains(target)) return;
      setOpenBy(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpenBy(null);
      box.current?.querySelector<HTMLElement>('[aria-controls]')?.focus();
    };
    // «Назад» и «Вперёд» закрывают окошко, а переход идёт своим чередом (closePop прототипа).
    const back = () => setOpenBy(null);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('popstate', back);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('popstate', back);
    };
  }, [openBy]);

  return (
    <span
      ref={box}
      className={className}
      onPointerEnter={hover ? pointerEnter : undefined}
      onPointerLeave={hover ? pointerLeave : undefined}
    >
      {trigger({ open, toggle, id })}
      {open &&
        (() => {
          const sheet = (
            <div
              ref={panel}
              id={id}
              role={role}
              aria-label={label}
              data-overlay
              data-popover
              data-leave={POP_LEAVE}
              className={`absolute z-[70] max-h-[min(460px,calc(100dvh-24px))] touch-pan-y w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] animate-rise overflow-auto rounded-xl border border-line-strong bg-raised text-ink shadow-pop ${PLACEMENTS[placement]} ${padded ? 'flex flex-col gap-2.5 p-3' : 'p-1.5'} ${PHONE_SHEET}`}
            >
              {children(close)}
            </div>
          );
          return phone ? createPortal(sheet, document.body) : sheet;
        })()}
    </span>
  );
}
