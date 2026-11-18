'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { iconButtonClass } from '../button';
import { Icon } from '../icon';
import { Popover } from '../popover';
import { NavDot } from './badge';

export interface TopBarProps {
  /**
   * Короткое название текущего модуля («Отчёты», «Финансы»); `fullTitle` — полное название и вкладка
   * для подсказки. Вкладка в панели не повторяется: она подсвечена в ряду вкладок (прототип v138).
   */
  title: string;
  fullTitle: string;
  /**
   * «Меню»: показать или скрыть левую панель; `dot` — на телефоне точка на кнопке, когда в «Других
   * модулях» есть модуль с точкой или цветным счётчиком (прототип renderSheetDot); `dotTone` — цвет
   * счётчика (не заполнены показатели), без него точка синяя. `panel` — кнопка на ПК (прототип v85
   * paintBurger): подпись по состоянию панели («Свернуть панель до значков» или «Развернуть панель
   * модулей») и развёрнута ли панель; «Меню» с точкой остаётся кнопкой телефона.
   */
  menu: {
    label: string;
    onClick: () => void;
    dot?: string;
    dotTone?: 'red' | 'yellow';
    panel?: { label: string; expanded: boolean };
  };
  /**
   * «?» у названия — единственная подсказка модуля (прототип v138 `#tb-info`, `modHelpPop`): что здесь,
   * что можно добавить и ссылки «Показать на экране», «Видео», «Вся инструкция». Вместо прежних «ⓘ»,
   * значка видео и «?» справа. `content` получает функцию «закрыть окошко».
   */
  info: { label: string; title: string; content: (close: () => void) => ReactNode };
  /** Общий поиск по текущей вкладке. */
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** «Поиск» — значок, который на телефоне раскрывает поле на всю ширину. */
    openLabel: string;
  };
  /** Дата и время по Бишкеку. */
  clock: ReactNode;
  /**
   * «На всю ширину» справа от часов (прототип v85 `#wide`, paintWide): рабочая область без предела
   * ширины; включена — кнопка нажата и значок «свернуть». Только на ПК.
   */
  wide?: { on: boolean; label: string; onToggle: () => void } | null;
  /**
   * Колокольчик уведомлений (доработки 16.11.2026, блок 3; прототип v123 `#bell`): `Bell` со своей
   * панелью; на телефоне прячется, пока раскрыт поиск.
   */
  bell?: ReactNode;
  /**
   * Переключатель темы; на телефоне его нет — тема меняется в «Мой профиль» (прототип v138). `onToggle`
   * получает нажатую кнопку: смена темы идёт волной с её стороны экрана.
   */
  theme: { label: string; title: string; onToggle: (button: HTMLElement) => void };
}

/**
 * Верхняя панель (прототип index.html `#topbar`, ui/shell.js initTop и renderPage; css/shell.css,
 * mobile.css `.tb-title`): «Меню», короткое название модуля с одним «?» (подсказка модуля), общий поиск,
 * дата и время, «На всю ширину», колокольчик и переключатель темы. Стоит над рабочей областью и не
 * прокручивается. Длинное название обрезается многоточием, полное (с вкладкой) — в подсказке; по
 * нажатию название не раскрывается (прототип v138 `tb.onclick=null`). На
 * телефоне поиск свёрнут в значок и раскрывается на всю ширину вместо остальных кнопок; пустое поле при
 * уходе фокуса сворачивается; часов и переключателя темы на телефоне нет (прототип v138).
 */
export function TopBar({
  title,
  fullTitle,
  menu,
  info,
  search,
  clock,
  wide,
  bell,
  theme,
}: TopBarProps) {
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Остальное на телефоне прячется, пока раскрыт поиск (прототип `.tb-other`).
  const other = searching ? 'max-md:hidden' : '';

  useEffect(() => {
    if (searching) input.current?.focus();
  }, [searching]);

  return (
    <header
      data-searching={searching}
      className="col-start-2 row-start-1 flex min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-pane py-[7px] pr-3 pl-2.5 shadow-pane max-md:col-start-1 max-md:gap-1 max-md:px-2 max-md:py-1.5"
    >
      <button
        type="button"
        onClick={menu.onClick}
        aria-label={menu.label}
        title={menu.label}
        className={`${iconButtonClass()} ${other} ${menu.dot ? 'relative' : ''} ${menu.panel ? 'md:hidden' : ''}`}
      >
        <Icon name="menu" />
        {menu.dot ? (
          <NavDot
            title={menu.dot}
            tone={menu.dotTone ?? 'info'}
            className="absolute top-1 right-1 md:hidden"
          />
        ) : null}
      </button>
      {menu.panel && (
        <button
          type="button"
          onClick={menu.onClick}
          aria-label={menu.panel.label}
          title={menu.panel.label}
          aria-expanded={menu.panel.expanded}
          data-nav-toggle
          className={`${iconButtonClass()} max-md:hidden`}
        >
          <Icon name="menu" />
        </button>
      )}
      <div
        title={fullTitle}
        data-page-title
        className={`flex max-w-[360px] min-w-0 flex-[0_1_auto] flex-col items-start justify-center gap-px px-1 py-0.5 text-left text-ink max-md:max-w-none max-md:flex-1 ${other}`}
      >
        <b className="block max-w-full truncate text-[15px] font-bold tracking-[-0.01em]">
          {title}
        </b>
      </div>
      <Popover
        label={info.label}
        padded
        className={`relative inline-flex ${other}`}
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={info.label}
            title={info.title}
            aria-expanded={open}
            aria-controls={id}
            data-module-help
            className={`-ml-1.5 ${iconButtonClass('sm')}`}
          >
            <Icon name="help" size="sm" />
          </button>
        )}
      >
        {(close) => info.content(close)}
      </Popover>
      <div
        className={`flex min-w-0 flex-1 justify-center max-md:gap-1 ${searching ? '' : 'max-md:flex-none max-md:justify-end'}`}
      >
        <div
          role="search"
          className={`relative w-[min(560px,100%)] ${searching ? 'max-md:w-full' : 'max-md:hidden'}`}
        >
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-faint"
          />
          <input
            ref={input}
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onBlur={() => {
              if (!search.value) setSearching(false);
            }}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            autoComplete="off"
            className="h-[34px] w-full rounded-full border border-line bg-pane pr-3 pl-[34px] text-[13.5px] max-md:h-11 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] outline-none focus:border-line-strong focus:shadow-[0_0_0_3px_var(--bu-sel)]"
          />
        </div>
        {/* Значок остаётся и при раскрытом поле (прототип `#q-open`): нажатие возвращает фокус в поле. */}
        <button
          type="button"
          onClick={() => {
            setSearching(true);
            input.current?.focus();
          }}
          aria-label={search.openLabel}
          title={search.openLabel}
          className={`${iconButtonClass()} md:hidden`}
          data-search-open
        >
          <Icon name="search" />
        </button>
      </div>
      <div className="text-[13px] font-[550] whitespace-nowrap text-muted tabular-nums max-md:hidden">
        {clock}
      </div>
      {wide && (
        <button
          type="button"
          onClick={wide.onToggle}
          aria-pressed={wide.on}
          aria-label={wide.label}
          title={wide.label}
          data-wide-toggle
          className={`${iconButtonClass()} aria-pressed:bg-btn aria-pressed:text-ink aria-pressed:shadow-flat-strong aria-pressed:hover:bg-btn aria-pressed:hover:text-ink max-md:hidden`}
        >
          <Icon name={wide.on ? 'minimize' : 'maximize'} />
        </button>
      )}
      {bell ? <span className={`inline-flex ${other}`}>{bell}</span> : null}
      <button
        type="button"
        onClick={(e) => theme.onToggle(e.currentTarget)}
        data-theme-toggle
        aria-label={theme.label}
        title={theme.title}
        className={`${iconButtonClass()} max-md:hidden`}
      >
        <span className="bu-light-only inline-grid">
          <Icon name="moon" />
        </span>
        <span className="bu-dark-only">
          <Icon name="sun" />
        </span>
      </button>
    </header>
  );
}
