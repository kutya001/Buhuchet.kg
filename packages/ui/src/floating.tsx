'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { menuPosition } from './action-menu';
import { PHONE_QUERY } from './use-media';
import { useSwipeDown } from './use-swipe-down';

const SIZE_CLASS = {
  menu: 'w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] gap-2.5 overflow-auto p-3',
  select: 'w-[min(420px,calc(100vw-16px))] gap-1.5 overflow-hidden p-2',
} as const;

/**
 * Всплывающее окошко у элемента поверх страницы (прототип ui/popups.js, openPop с `cls:'pad'`): как
 * `Popover`, но рисуется в `document.body` — не обрезается прокруткой таблицы (фильтр у заголовка
 * столбца). Место — `menuPosition`: под элементом, а если не помещается — над ним; вырос за край
 * экрана — место считается заново. Закрывается Esc (фокус возвращается на элемент), нажатием вне
 * окошка и элемента, кнопкой «Назад» и на телефоне протяжкой вниз. При открытии фокус — на первом поле
 * ввода (на телефоне — на первой кнопке, чтобы не выскакивала клавиатура, как `!isMobile()` в openPop).
 */
export function FloatingPanel({
  anchor,
  label,
  size = 'menu',
  onClose,
  children,
}: {
  anchor: HTMLElement;
  /** Название окошка для экранного диктора. */
  label: string;
  /**
   * `menu` — по содержимому, 210–360 px (фильтр столбца); `select` — список с поиском (`.cps-pop`
   * прототипа): 420 px, прокручивается список внутри, а не окошко.
   */
  size?: 'menu' | 'select';
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useSwipeDown(box, { enabled: true, onClose });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const size = { w: el.offsetWidth, h: el.offsetHeight };
      const viewport = { w: window.innerWidth, h: window.innerHeight };
      // Содержимое поменяло размер (значения фильтра пришли с сервера) — окошко переставляется, только
      // если вышло за край экрана: поле «Найти значение» не уезжает во время ввода.
      setPos((prev) =>
        prev && prev.x + size.w <= viewport.w && prev.y + size.h <= viewport.h
          ? prev
          : menuPosition({ anchor }, size, viewport),
      );
    };
    place();
    const resized = new ResizeObserver(place);
    resized.observe(el);
    return () => resized.disconnect();
  }, [anchor]);

  // Фокус — когда окошко встало на место: до этого оно скрыто (`visibility: hidden`) и фокус не берёт.
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    const field = window.matchMedia(PHONE_QUERY).matches
      ? null
      : box.current?.querySelector<HTMLElement>(
          'input:not([type=checkbox]):not([disabled]),select:not([disabled])',
        );
    (field ?? box.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
  }, [placed]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('popstate', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('popstate', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      data-overlay
      data-popover
      style={pos ? { left: pos.x, top: pos.y } : { left: 0, top: 0, visibility: 'hidden' }}
      className={`fixed z-[70] flex max-h-[min(460px,calc(100dvh-24px))] touch-pan-y animate-slide-up flex-col rounded-xl border border-line-strong bg-raised text-ink shadow-pop ${SIZE_CLASS[size]}`}
    >
      {children}
    </div>,
    document.body,
  );
}
