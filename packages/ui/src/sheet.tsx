'use client';

import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react';
import { useBackClose } from './back-close';
import { useSwipeDown } from './use-swipe-down';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Название панели для экранного диктора. */
  label: string;
  /**
   * Содержимое; `leave` закрывает панель перед переходом с `replace` (выбор модуля): «Назад» после
   * перехода вернёт на прежнюю страницу, а не на панель.
   */
  children: (leave: () => void) => ReactNode;
}

/**
 * Выдвижная панель снизу на телефоне (прототип `#sheet` и `#sheet-cover`, css/mobile.css `.sheet`;
 * ТЗ «Мобильная навигация»): полоска-ручка вверху, не выше 85 % экрана. Закрывается протяжкой вниз,
 * касанием вне панели, кнопкой «Назад» телефона, клавишей Esc и выбором пункта. Закрытая панель
 * остаётся в разметке за нижним краем экрана и невидима — так она выезжает и уезжает плавно.
 */
export function BottomSheet({ open, onClose, label, children }: BottomSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const cover = useRef<HTMLDivElement>(null);
  const release = useBackClose(open, onClose);
  useSwipeDown(sheet, { enabled: open, onClose, cover });

  const escape = useEffectEvent((e: KeyboardEvent) => {
    // Окно или всплывающее окошко поверх панели Esc закрывает первым.
    if (e.key === 'Escape' && !document.querySelector('[data-window],[data-popover]')) onClose();
  });
  useEffect(() => {
    if (!open) return;
    // Фокус — в панель, после закрытия — обратно на кнопку, которая её открыла.
    const opener = document.activeElement as HTMLElement | null;
    sheet.current?.focus({ preventScroll: true });
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const leave = () => {
    release(true);
    onClose();
  };

  return (
    <>
      <div
        ref={cover}
        hidden={!open}
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-[55] bg-cover md:hidden"
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-open={open}
        data-overlay={open || undefined}
        className="invisible fixed inset-x-0 bottom-0 z-[60] flex max-h-[85dvh] translate-y-[110%] touch-pan-y flex-col gap-1.5 overflow-auto rounded-t-2xl border border-b-0 border-line-strong bg-pane px-4 pt-1 pb-[calc(16px+env(safe-area-inset-bottom,0px))] shadow-pop outline-none [transition:translate_.28s_cubic-bezier(.2,.8,.2,1),visibility_0s_linear_.28s] data-[open=true]:visible data-[open=true]:translate-y-0 data-[open=true]:[transition:translate_.28s_cubic-bezier(.2,.8,.2,1),visibility_0s] md:hidden"
      >
        <div
          data-swipe-handle
          aria-hidden="true"
          className="mx-auto my-1.5 h-1 w-10 flex-none rounded bg-line-strong"
        />
        {children(leave)}
      </div>
    </>
  );
}
