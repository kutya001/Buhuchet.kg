'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
  /** Классы обёртки (например, кнопка «+» на телефоне закреплена в углу экрана вместе с меню). */
  className?: string;
}

/**
 * Всплывающее окошко у кнопки (прототип ui/popups.js, openPop; стиль `.pop`): описание модуля «ⓘ»,
 * «?» и меню «+ Добавить». Закрывается повторным нажатием, клавишей Esc и нажатием вне окошка; при
 * открытии фокус переходит в окошко, при закрытии по Esc — обратно на кнопку.
 */
export function Popover({
  trigger,
  children,
  label,
  role = 'dialog',
  placement = 'bottom-start',
  padded = false,
  defaultOpen = false,
  className = 'relative inline-flex',
}: PopoverProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus();
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      box.current?.querySelector<HTMLElement>('[aria-controls]')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <span ref={box} className={className}>
      {trigger({ open, toggle, id })}
      {open && (
        <div
          ref={panel}
          id={id}
          role={role}
          aria-label={label}
          className={`absolute z-[70] max-h-[min(460px,calc(100dvh-24px))] w-max max-w-[min(360px,calc(100vw-24px))] min-w-[210px] animate-slide-up overflow-auto rounded-xl border border-line-strong bg-raised text-ink shadow-pop ${PLACEMENTS[placement]} ${padded ? 'flex flex-col gap-2.5 p-3' : 'p-1.5'}`}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}
