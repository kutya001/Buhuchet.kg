'use client';

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { MenuPlace } from '../action-menu';

/** Долгое нажатие пальцем открывает меню записи (прототип ui/grid.js: 550 мс, сдвиг до 8 px). */
export const LONG_PRESS_MS = 550;
export const LONG_PRESS_SLOP_PX = 8;

/** Элементы внутри строки, нажатие на которые строку не открывает. */
const INTERACTIVE = 'a,button,input,select,label,textarea';

export interface RowEvents<Row> {
  /** Обработчики строки таблицы или карточки. */
  handlers: (row: Row) => {
    onClick: (e: ReactMouseEvent<HTMLElement>) => void;
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Открыть меню записи у элемента или в точке. */
  menuAt: (row: Row, place: MenuPlace) => void;
}

/**
 * Как открывается запись и её меню (прототип ui/grid.js, bind; ТЗ «Действия над записью»): нажатие
 * на строку или Enter — карточка записи; правый клик, долгое нажатие пальцем (550 мс), клавиши
 * ContextMenu и Shift+F10 — меню действий. После долгого нажатия отпускание пальца запись не
 * открывает.
 */
export function useRowEvents<Row>({
  onOpen,
  onMenu,
}: {
  onOpen?: (row: Row) => void;
  /** Нет меню — правый клик остаётся браузерным. */
  onMenu?: (row: Row, place: MenuPlace) => void;
}): RowEvents<Row> {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pressed = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };

  return {
    menuAt: (row, place) => onMenu?.(row, place),
    handlers: (row) => ({
      onClick: (e) => {
        if (pressed.current) {
          pressed.current = false;
          return;
        }
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        onOpen?.(row);
      },
      onContextMenu: (e) => {
        if (!onMenu || (e.target as HTMLElement).closest('a')) return;
        e.preventDefault();
        cancel();
        onMenu(row, { x: e.clientX, y: e.clientY });
      },
      onKeyDown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' && onOpen) {
          e.preventDefault();
          onOpen(row);
        }
        if (onMenu && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          e.preventDefault();
          onMenu(row, { anchor: e.currentTarget });
        }
      },
      onPointerDown: (e) => {
        pressed.current = false;
        if (e.pointerType !== 'touch' || !onMenu) return;
        const x = e.clientX;
        const y = e.clientY;
        start.current = { x, y };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          pressed.current = true;
          start.current = null;
          onMenu(row, { x, y });
          try {
            navigator.vibrate?.(15);
          } catch {
            // Вибрация недоступна — меню всё равно открыто.
          }
        }, LONG_PRESS_MS);
      },
      onPointerUp: () => clearTimeout(timer.current),
      onPointerCancel: cancel,
      onPointerMove: (e) => {
        const s = start.current;
        if (e.pointerType !== 'touch' || !s) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) cancel();
      },
    }),
  };
}
