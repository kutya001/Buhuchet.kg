'use client';

import { useEffect, useState, type ReactNode } from 'react';

const PHONE = '(max-width: 767px)';
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]),textarea';

/**
 * Каркас рабочей страницы (прототип index.html `.app`, css/shell.css, css/mobile.css): три «площадки»
 * со скруглёнными углами и тенью на фоне рамки — левая панель модулей во всю высоту окна, справа от
 * неё верхняя панель и под ней рабочая область. Скрытая левая панель — верхняя панель и рабочая
 * область во всю ширину. Уже 768 px левой панели нет: верхняя панель, рабочая область и внизу —
 * нижняя панель модулей; учитываются вырезы экрана, содержимое не прячется под нижней панелью. При
 * открытой клавиатуре телефона нижняя панель и кнопка «+» скрываются. Прокручивается только рабочая
 * область, верхняя панель остаётся на месте.
 */
export function AppFrame({
  navHidden,
  side,
  topBar,
  bottomNav,
  sheet,
  children,
  paneLabel,
}: {
  navHidden: boolean;
  side: ReactNode;
  topBar: ReactNode;
  /** Нижняя панель телефона. */
  bottomNav?: ReactNode;
  /** Выдвижная панель «Меню» телефона. */
  sheet?: ReactNode;
  children: ReactNode;
  /** Название рабочей области для экранного диктора (текущий модуль). */
  paneLabel?: string;
}) {
  const keyboard = usePhoneKeyboard();
  return (
    <div
      data-nav={navHidden ? 'hidden' : 'shown'}
      data-kb={keyboard}
      className="group/app grid h-dvh grid-cols-[276px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-2.5 data-[nav=hidden]:grid-cols-[minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)_auto] max-md:gap-2 max-md:pt-[max(8px,env(safe-area-inset-top,0px))] max-md:pr-[max(8px,env(safe-area-inset-right,0px))] max-md:pb-[calc(8px+env(safe-area-inset-bottom,0px))] max-md:pl-[max(8px,env(safe-area-inset-left,0px))] max-md:data-[kb=true]:grid-rows-[auto_minmax(0,1fr)]"
    >
      {topBar}
      {side}
      <main
        aria-label={paneLabel}
        className="relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-auto rounded-xl border border-line bg-pane shadow-pane group-data-[nav=hidden]/app:col-start-1 data-[paging=true]:overflow-x-hidden max-md:col-start-1 max-md:rounded-2xl"
      >
        <div className="mx-auto flex max-w-[1640px] min-w-0 flex-col gap-3.5 px-7 pt-[22px] pb-12 max-md:gap-3 max-md:px-4 max-md:pt-4 max-md:pb-[92px]">
          {children}
        </div>
      </main>
      {bottomNav}
      {sheet}
    </div>
  );
}

/**
 * Открыта ли клавиатура телефона: фокус в текстовом поле на ширине телефона (как прототип,
 * ui/events.js). Поле потеряло фокус — клавиатура закрыта.
 */
function usePhoneKeyboard(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const focusIn = (e: FocusEvent) => {
      const target = e.target as Element | null;
      if (window.matchMedia(PHONE).matches && target?.matches?.(TEXT_INPUT)) setOpen(true);
    };
    const focusOut = () => {
      clearTimeout(timer);
      // Фокус мог перейти в соседнее поле — проверяем, где он теперь.
      timer = setTimeout(() => {
        if (!document.activeElement?.matches(TEXT_INPUT)) setOpen(false);
      }, 50);
    };
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
    };
  }, []);
  return open;
}
