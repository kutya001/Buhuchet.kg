'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';
import type { IconName } from './icons';
import { useSwipeDown } from './use-swipe-down';

/** Пункт меню действий (прототип ui/popups.js, `menu`: `label`, `icon`, `danger`, `disabled`, `reason`, `on`). */
export interface ActionItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Опасное действие — красным (`.mi.danger`). */
  danger?: boolean;
  /** Недоступно: пункт виден, но не нажимается; почему — в `reason` мелким шрифтом. */
  disabled?: boolean;
  reason?: string;
  /** Пояснение мелким шрифтом под названием. */
  sub?: string;
  /** Выбранный вариант (`.mi.on`), например «Компактно» в настройках вида. */
  on?: boolean;
  run: () => void;
}

/** Черта между группами пунктов (`.msep`). */
export interface ActionSeparator {
  id: string;
  separator: true;
}

export type ActionEntry = ActionItem | ActionSeparator;

const isSeparator = (entry: ActionEntry): entry is ActionSeparator => 'separator' in entry;

/**
 * Пункты меню действий: значок, название, пояснение или причина недоступности. Стрелки вверх и вниз
 * переводят фокус между пунктами. `onPick` вызывается до действия пункта (меню закрывается, затем
 * действие открывает своё окно).
 */
export function ActionList({
  items,
  onPick,
}: {
  items: readonly ActionEntry[];
  onPick: () => void;
}) {
  const arrows = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'),
    ];
    if (!buttons.length) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]!.focus();
  };
  return (
    <div onKeyDown={arrows} className="flex flex-col">
      {items.map((item) =>
        isSeparator(item) ? (
          <div key={item.id} role="separator" className="mx-1 my-[5px] h-px bg-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-current={item.on ? 'true' : undefined}
            onClick={() => {
              onPick();
              item.run();
            }}
            className={`flex w-full cursor-pointer items-start gap-2.5 rounded-[5px] border-0 px-2.5 py-[7px] text-left text-[13px] leading-[1.35] disabled:cursor-not-allowed disabled:opacity-50 ${item.danger ? 'text-danger' : 'text-ink'} ${item.on ? 'bg-sel font-semibold' : 'bg-transparent enabled:hover:bg-row-hover'}`}
          >
            <Icon
              name={item.icon ?? 'right'}
              className={`mt-px ${item.danger ? 'text-danger' : 'text-muted'}`}
            />
            <span>
              {item.label}
              {(item.disabled && item.reason) || item.sub ? (
                <span className="block text-[11.5px] text-faint">
                  {item.disabled && item.reason ? item.reason : item.sub}
                </span>
              ) : null}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

/** Где открыть меню: в точке нажатия (правый клик, долгое нажатие) или у элемента («⋯», клавиатура). */
export type MenuPlace = { x: number; y: number } | { anchor: HTMLElement };

const EDGE = 8;

/**
 * Место меню на экране (прототип ui/popups.js, openPop): у точки — левым верхним углом в ней, у элемента —
 * под ним по левому краю, а если не помещается — по правому краю и над ним; всегда не ближе 8 px к
 * краям окна.
 */
export function menuPosition(
  place: MenuPlace,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  let x: number;
  let y: number;
  if ('anchor' in place) {
    const r = place.anchor.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 6;
    if (x + size.w > viewport.w - EDGE) x = r.right - size.w;
    if (y + size.h > viewport.h - EDGE) y = Math.max(EDGE, r.top - size.h - 6);
  } else {
    ({ x, y } = place);
  }
  return {
    x: Math.max(EDGE, Math.min(x, viewport.w - size.w - EDGE)),
    y: Math.max(EDGE, Math.min(y, viewport.h - size.h - EDGE)),
  };
}

/**
 * Меню действий записи поверх страницы (прототип ui/popups.js, `menu` + `openPop`; стиль `.pop`):
 * открывается правым кликом или долгим нажатием на строке, кнопкой «⋯» и клавишами ContextMenu или
 * Shift+F10. Рисуется в `document.body`, поэтому не обрезается прокруткой таблицы. Закрывается выбором
 * пункта, Esc (фокус возвращается на элемент), нажатием вне меню, кнопкой «Назад» (переход идёт своим
 * чередом, как у `Popover`) и на телефоне протяжкой вниз (ТЗ «Управление свайпами»).
 */
export function ActionMenu({
  items,
  place,
  label,
  onClose,
}: {
  items: readonly ActionEntry[];
  place: MenuPlace;
  /** Название меню для экранного диктора. */
  label: string;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useSwipeDown(box, { enabled: true, onClose });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setPos(
      menuPosition(
        place,
        { w: el.offsetWidth, h: el.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    );
  }, [place]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus();
    const anchor = 'anchor' in place ? place.anchor : null;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('popstate', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('popstate', onClose);
    };
  }, [place, onClose]);

  return createPortal(
    <div
      ref={box}
      role="menu"
      aria-label={label}
      data-overlay
      data-popover
      style={pos ? { left: pos.x, top: pos.y } : { left: 0, top: 0, visibility: 'hidden' }}
      className="fixed z-[70] max-h-[min(460px,calc(100dvh-24px))] w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] touch-pan-y animate-slide-up overflow-auto rounded-xl border border-line-strong bg-raised p-1.5 text-ink shadow-pop"
    >
      <ActionList items={items} onPick={onClose} />
    </div>,
    document.body,
  );
}
