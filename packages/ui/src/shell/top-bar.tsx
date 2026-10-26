'use client';

import { useState, type ReactNode } from 'react';
import { iconButtonClass } from '../button';
import { Icon } from '../icon';
import { Popover } from '../popover';

export interface TopBarProps {
  /** Название текущего модуля и вкладки (вкладки нет — null). */
  title: string;
  tab: string | null;
  /** «Меню»: показать или скрыть левую панель. */
  menu: { label: string; onClick: () => void };
  /** «ⓘ» у названия: описание модуля. */
  info: { label: string; content: ReactNode };
  /** Общий поиск по текущей вкладке. */
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** Где ищем — название вкладки (или модуля) справа в поле. */
    scope: string;
  };
  /** Дата и время по Бишкеку. */
  clock: ReactNode;
  /** «?» — помощь по модулю; `content` получает `close`. */
  help: { label: string; title: string; content: (close: () => void) => ReactNode };
  /** Переключатель темы. */
  theme: { label: string; title: string; onToggle: () => void };
}

/**
 * Верхняя панель (прототип index.html `#topbar`, ui/shell.js initTop и renderPage; css/shell.css,
 * mobile.css `.tb-title`): «Меню», название модуля и под ним вкладки с «ⓘ», общий поиск, дата и время,
 * «?» и переключатель темы. Стоит над рабочей областью и не прокручивается. Длинное название
 * обрезается многоточием, полное — в подсказке и по нажатию.
 */
export function TopBar({ title, tab, menu, info, search, clock, help, theme }: TopBarProps) {
  const [full, setFull] = useState(false);
  const wrap = full ? 'whitespace-normal' : 'truncate';
  return (
    <header className="col-start-2 row-start-1 flex min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-pane py-[7px] pr-3 pl-2.5 shadow-pane group-data-[nav=hidden]/app:col-start-1 max-md:col-start-1 max-md:gap-1 max-md:px-2 max-md:py-1.5">
      <button
        type="button"
        onClick={menu.onClick}
        aria-label={menu.label}
        title={menu.label}
        className={iconButtonClass()}
      >
        <Icon name="menu" />
      </button>
      <button
        type="button"
        onClick={() => setFull((v) => !v)}
        title={tab ? `${title} · ${tab}` : title}
        className="flex max-w-[360px] min-w-0 flex-[0_1_auto] cursor-pointer flex-col items-start justify-center gap-px border-0 bg-transparent px-1 py-0.5 text-left text-ink max-md:max-w-none max-md:flex-1"
      >
        <b className={`block max-w-full text-[15px] font-bold tracking-[-0.01em] ${wrap}`}>
          {title}
        </b>
        {tab && (
          <span className={`block max-w-full text-[11.5px] font-[550] text-muted ${wrap}`}>
            {tab}
          </span>
        )}
      </button>
      <Popover
        label={info.label}
        padded
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={info.label}
            aria-expanded={open}
            aria-controls={id}
            className={`-ml-1.5 ${iconButtonClass('sm')}`}
          >
            <Icon name="info" size="sm" />
          </button>
        )}
      >
        {() => info.content}
      </Popover>
      <div className="flex min-w-0 flex-1 justify-center max-md:hidden">
        <div role="search" className="relative w-[min(560px,100%)]">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
            autoComplete="off"
            className="h-[34px] w-full rounded-full border border-line bg-pane pr-16 pl-[34px] text-[13.5px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)] outline-none focus:border-line-strong focus:shadow-[0_0_0_3px_var(--bu-sel)]"
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 max-w-[40%] -translate-y-1/2 truncate text-[11px] text-faint">
            {search.scope}
          </span>
        </div>
      </div>
      <div className="text-[13px] font-[550] whitespace-nowrap text-muted tabular-nums">
        {clock}
      </div>
      <Popover
        label={help.label}
        padded
        placement="bottom-end"
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-label={help.label}
            title={help.title}
            aria-expanded={open}
            aria-controls={id}
            className={iconButtonClass()}
          >
            <Icon name="help" />
          </button>
        )}
      >
        {help.content}
      </Popover>
      <button
        type="button"
        onClick={theme.onToggle}
        aria-label={theme.label}
        title={theme.title}
        className={iconButtonClass()}
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
