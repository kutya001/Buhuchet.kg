'use client';

import {
  useEffect,
  useState,
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

/** Состояние нажатия пальцем: таймер долгого нажатия, точка касания, «меню уже открыто». */
export interface PressState {
  timer: ReturnType<typeof setTimeout> | undefined;
  start: { x: number; y: number } | null;
  pressed: boolean;
}

interface RowEventOptions<Row> {
  onOpen?: (row: Row) => void;
  /** Нет меню — правый клик остаётся браузерным. */
  onMenu?: (row: Row, place: MenuPlace) => void;
}

/**
 * Как открывается запись и её меню (прототип ui/grid.js, bind; ТЗ «Действия над записью»): нажатие
 * на строку или Enter — карточка записи; правый клик, долгое нажатие пальцем (550 мс), клавиши
 * ContextMenu и Shift+F10 — меню действий. После долгого нажатия отпускание пальца запись не
 * открывает. Нажатие на кнопку, ссылку или галочку внутри строки запись не открывает.
 */
export function rowEvents<Row>(
  press: PressState,
  { onOpen, onMenu }: RowEventOptions<Row>,
): RowEvents<Row> {
  const cancel = () => {
    clearTimeout(press.timer);
    press.start = null;
  };

  return {
    menuAt: (row, place) => onMenu?.(row, place),
    handlers: (row) => ({
      onClick: (e) => {
        if (press.pressed) {
          press.pressed = false;
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
        press.pressed = false;
        if (e.pointerType !== 'touch' || !onMenu) return;
        const x = e.clientX;
        const y = e.clientY;
        press.start = { x, y };
        clearTimeout(press.timer);
        press.timer = setTimeout(() => {
          press.pressed = true;
          press.start = null;
          onMenu(row, { x, y });
          try {
            navigator.vibrate?.(15);
          } catch {
            // Вибрация недоступна — меню всё равно открыто.
          }
        }, LONG_PRESS_MS);
      },
      onPointerUp: () => clearTimeout(press.timer),
      onPointerCancel: cancel,
      onPointerMove: (e) => {
        const s = press.start;
        if (e.pointerType !== 'touch' || !s) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP_PX) cancel();
      },
    }),
  };
}

/** Обработчики строк списка (`rowEvents`) с таймером долгого нажатия, который живёт вместе с экраном. */
export function useRowEvents<Row>(options: RowEventOptions<Row>): RowEvents<Row> {
  // Состояние нажатия меняют только обработчики событий: экран из-за него не перерисовывается.
  const [press] = useState<PressState>(() => ({ timer: undefined, start: null, pressed: false }));
  useEffect(() => () => clearTimeout(press.timer), [press]);
  return rowEvents(press, options);
}
