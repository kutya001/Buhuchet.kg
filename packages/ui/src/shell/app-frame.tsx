'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from '../gestures';

const PHONE = '(max-width: 767px)';
const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]),textarea';
/** Содержимое страницы проявляется за `--bu-t-base` (прототип v131, `#page.pg-in`). */
const PAGE_FADE = 'animate-fade-in';
/**
 * Отметка «страницу сменил свайп»: соседняя вкладка уже въехала на место, проявлять её заново не нужно.
 * Ставит `TabPager` на `[data-page]`, снимает каркас.
 */
export const PAGE_SWIPED_ATTR = 'data-page-swiped';

/**
 * Каркас рабочей страницы (прототип index.html `.app`, css/shell.css, css/mobile.css): три «площадки»
 * со скруглёнными углами и тенью на фоне рамки — левая панель модулей во всю высоту окна, справа от
 * неё верхняя панель и под ней рабочая область. Свёрнутая левая панель (прототип v85 `.app.nav-hidden`)
 * — полоска значков шириной 60 px, ширина меняется плавно. «На всю ширину» (`.app.wide`) снимает с
 * рабочей области предел 1640 px и центрирование, со списка «По центру» — его предел. Уже 768 px
 * левой панели нет: верхняя панель, рабочая область и внизу —
 * нижняя панель модулей; учитываются вырезы экрана, содержимое не прячется под нижней панелью. При
 * открытой клавиатуре телефона нижняя панель и кнопка «+» скрываются. Прокручивается только рабочая
 * область, верхняя панель остаётся на месте. Смена модуля или вкладки (`pageKey`) — содержимое страницы
 * проявляется (прототип v131); при «уменьшить движение» и после свайпа вкладок — сразу на месте.
 */
export function AppFrame({
  navHidden,
  wide = false,
  side,
  topBar,
  bottomNav,
  sheet,
  children,
  paneLabel,
  pageKey,
}: {
  /** Левая панель свёрнута до значков (ПК). */
  navHidden: boolean;
  /** «На всю ширину»: рабочая область без предела ширины (ПК). */
  wide?: boolean;
  side: ReactNode;
  topBar: ReactNode;
  /** Нижняя панель телефона. */
  bottomNav?: ReactNode;
  /** Выдвижная панель «Меню» телефона. */
  sheet?: ReactNode;
  children: ReactNode;
  /** Название рабочей области для экранного диктора (текущий модуль). */
  paneLabel?: string;
  /** Что открыто: модуль и вкладка. Меняется — содержимое страницы проявляется заново. */
  pageKey?: string;
}) {
  const keyboard = usePhoneKeyboard();
  const page = useRef<HTMLDivElement>(null);
  const shown = useRef(pageKey);
  useEffect(() => {
    if (shown.current === pageKey) return;
    shown.current = pageKey;
    const el = page.current;
    if (!el) return;
    const swiped = el.hasAttribute(PAGE_SWIPED_ATTR);
    el.removeAttribute(PAGE_SWIPED_ATTR);
    el.classList.remove(PAGE_FADE);
    if (swiped || reducedMotion()) return;
    // Перезапуск анимации: без чтения размера браузер не заметит, что класс сняли и поставили снова.
    void el.offsetWidth;
    el.classList.add(PAGE_FADE);
  }, [pageKey]);
  return (
    <div
      data-nav={navHidden ? 'hidden' : 'shown'}
      data-kb={keyboard}
      data-wide={wide}
      className="group/app grid h-dvh grid-cols-[276px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-2.5 transition-[grid-template-columns] duration-[240ms] ease-[cubic-bezier(.3,.7,.3,1)] motion-reduce:transition-none md:data-[nav=hidden]:grid-cols-[60px_minmax(0,1fr)] max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)_auto] max-md:gap-2 max-md:pt-[max(8px,env(safe-area-inset-top,0px))] max-md:pr-[max(8px,env(safe-area-inset-right,0px))] max-md:pb-[calc(8px+env(safe-area-inset-bottom,0px))] max-md:pl-[max(8px,env(safe-area-inset-left,0px))] max-md:data-[kb=true]:grid-rows-[auto_minmax(0,1fr)]"
    >
      {topBar}
      {side}
      <main
        aria-label={paneLabel}
        className="relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-auto rounded-xl border border-line bg-pane shadow-pane data-[paging=true]:overflow-x-hidden max-md:col-start-1 max-md:rounded-2xl"
      >
        <div
          ref={page}
          data-page=""
          className="mx-auto flex max-w-[1640px] min-w-0 group-data-[wide=true]/app:max-w-none flex-col gap-3.5 px-7 pt-[22px] pb-12 max-md:gap-3 max-md:px-4 max-md:pt-4 max-md:pb-[92px]"
        >
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
