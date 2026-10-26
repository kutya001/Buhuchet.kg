'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { menuPosition } from './action-menu';
import { PHONE_QUERY } from './use-media';
import { useSwipeDown } from './use-swipe-down';

/**
 * Всплывающее окошко у элемента поверх страницы (прототип ui/popups.js, openPop с `cls:'pad'`): как
 * `Popover`, но рисуется в `document.body` — не обрезается прокруткой таблицы (фильтр у заголовка
 * столбца). Место — `menuPosition`: под элементом, а если не помещается — над ним. Закрывается Esc
 * (фокус возвращается на элемент), нажатием вне окошка и элемента, кнопкой «Назад» и на телефоне
 * протяжкой вниз. При открытии фокус — на первом поле ввода (на телефоне — на первой кнопке, чтобы не
 * выскакивала клавиатура, как `!isMobile()` в openPop).
 */
export function FloatingPanel({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  /** Название окошка для экранного диктора. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useSwipeDown(box, { enabled: true, onClose });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setPos(
      menuPosition(
        { anchor },
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    );
  }, [anchor]);

  useEffect(() => {
    const field = window.matchMedia(PHONE_QUERY).matches
      ? null
      : box.current?.querySelector<HTMLElement>(
          'input:not([type=checkbox]):not([disabled]),select:not([disabled])',
        );
    (field ?? box.current?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
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
      className="fixed z-[70] flex max-h-[min(460px,calc(100dvh-24px))] w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] touch-pan-y animate-slide-up flex-col gap-2.5 overflow-auto rounded-xl border border-line-strong bg-raised p-3 text-ink shadow-pop"
    >
      {children}
    </div>,
    document.body,
  );
}
