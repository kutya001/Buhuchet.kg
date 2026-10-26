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

/** Сдвиг по горизонтали, чтобы окошко `left…right` не выходило за край экрана шириной `width`. */
export function edgeShift(left: number, right: number, width: number): number {
  if (left < EDGE) return EDGE - left;
  if (right > width - EDGE) return Math.max(EDGE - left, width - EDGE - right);
  return 0;
}

/**
 * Всплывающее окошко у кнопки (прототип ui/popups.js, openPop; стиль `.pop`): описание модуля «ⓘ»,
 * «?» и меню «+ Добавить». Закрывается повторным нажатием, клавишей Esc, нажатием вне окошка, кнопкой
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

  // Окошко у кнопки посреди ряда (например, «Столбцы» на телефоне) не уходит за край экрана.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.translate = '';
    const rect = el.getBoundingClientRect();
    const shift = edgeShift(rect.left, rect.right, document.documentElement.clientWidth);
    if (shift) el.style.translate = `${shift}px 0`;
  }, [open]);

  useEffect(() => {
    if (!openBy) return;
    if (openBy === 'click') {
      panel.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus();
    }
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpenBy(null);
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
      {open && (
        <div
          ref={panel}
          id={id}
          role={role}
          aria-label={label}
          data-overlay
          data-popover
          className={`absolute z-[70] max-h-[min(460px,calc(100dvh-24px))] touch-pan-y w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] animate-slide-up overflow-auto rounded-xl border border-line-strong bg-raised text-ink shadow-pop ${PLACEMENTS[placement]} ${padded ? 'flex flex-col gap-2.5 p-3' : 'p-1.5'}`}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}
