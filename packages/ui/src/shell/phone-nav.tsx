import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '../icon';
import type { IconName } from '../icons';
import { CountBadge } from './badge';
import { Brand } from './side-nav';
import type { ShellCount, ShellLink } from './types';

const DefaultLink: ShellLink = (props) => <a {...props} />;

/** Модуль в нижней панели или в «Других модулях». */
export interface PhoneModule {
  id: string;
  /** В нижней панели — короткая подпись («Отчёты»), в «Других модулях» — полное название. */
  title: string;
  icon: IconName;
  href: string;
  count?: ShellCount;
}

/**
 * Нижняя панель телефона (прототип ui/shell.js renderBnav, css/mobile.css `.bnav`, `.bn`; ТЗ
 * «Мобильная навигация»): всегда на экране, четыре основных модуля значком с короткой подписью,
 * активный подсвечен; основной модуль без права просто не показывается. При открытой клавиатуре
 * скрывается. На ПК её нет.
 */
export function BottomNav({
  modules,
  active,
  label,
  Link = DefaultLink,
}: {
  modules: readonly PhoneModule[];
  active: string | null;
  /** «Модули» — название панели для экранного диктора. */
  label: string;
  Link?: ShellLink;
}) {
  return (
    <nav
      aria-label={label}
      data-no-swipe
      className="col-start-1 row-start-3 hidden gap-0.5 overflow-x-auto rounded-2xl border border-line bg-pane p-1.5 shadow-pane [scrollbar-width:none] max-md:flex group-data-[kb=true]/app:hidden [&::-webkit-scrollbar]:hidden"
    >
      {modules.map((m) => {
        const on = m.id === active;
        return (
          <Link
            key={m.id}
            href={m.href}
            aria-current={on ? 'page' : undefined}
            className={`relative flex min-w-[66px] flex-[1_0_auto] flex-col items-center gap-[3px] rounded-[10px] px-1.5 pt-1.5 pb-[5px] text-[10.5px] font-semibold no-underline ${on ? 'bg-pane-alt text-ink shadow-btn' : 'text-muted'}`}
          >
            <Icon name={m.icon} size="nav" />
            <span>{m.title}</span>
            {m.count && (
              <CountBadge
                count={m.count}
                className="absolute top-0.5 right-2 min-w-4 px-1 text-[9.5px] leading-[15px]"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Содержимое панели «Меню» на телефоне (прототип ui/shell.js renderSheet, css/grid.css
 * `.sheet-mods`): название платформы и режим, «Другие модули» — все остальные модули по правам в
 * порядке меню по два в строку, активный подсвечен, — и ниже `footer` (организация, «Выйти»).
 * Выбор модуля закрывает панель (`onSelect`).
 */
export function PhoneMenu({
  mode,
  modules,
  active,
  label,
  onSelect,
  footer,
  Link = DefaultLink,
}: {
  mode: string;
  modules: readonly PhoneModule[];
  active: string | null;
  /** «Другие модули». */
  label: string;
  onSelect: (e: MouseEvent<HTMLAnchorElement>, module: PhoneModule) => void;
  footer: ReactNode;
  Link?: ShellLink;
}) {
  return (
    <>
      <Brand mode={mode} className="px-1 pt-1.5 pb-2.5" />
      {modules.length > 0 && (
        <nav
          aria-label={label}
          className="mb-1 grid grid-cols-2 gap-1.5 border-b border-line pt-1 pb-2"
        >
          {modules.map((m) => {
            const on = m.id === active;
            return (
              <Link
                key={m.id}
                href={m.href}
                onClick={(e) => onSelect(e, m)}
                aria-current={on ? 'page' : undefined}
                className={`flex min-w-0 items-center gap-[9px] rounded-[10px] border border-line p-2.5 text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-brand-blue ${on ? 'bg-raised text-ink shadow-btn' : 'bg-pane-alt text-muted'}`}
              >
                <Icon name={m.icon} />
                <span className="min-w-0">{m.title}</span>
                {m.count && <CountBadge count={m.count} className="ml-auto" />}
              </Link>
            );
          })}
        </nav>
      )}
      {footer}
    </>
  );
}

/**
 * Строка панели «Меню» под модулями (прототип `.orgbtn` в renderSheet): значок в квадрате, название
 * и строка под ним — профиль организации, «Выйти из аккаунта».
 */
export function SheetAction({
  icon,
  avatar,
  label,
  sub,
  onClick,
  disabled = false,
}: {
  icon: IconName;
  /** Инициалы в кружке вместо значка (`.av.round` прототипа): «Мой профиль». */
  avatar?: string;
  label: string;
  sub?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent p-2 text-left text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-50"
    >
      {avatar ? (
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-btn text-[12px] font-bold tracking-[.02em] text-muted shadow-btn"
        >
          {avatar}
        </span>
      ) : (
        <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-btn text-muted shadow-btn">
          <Icon name={icon} size="sm" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-[1.2] font-[650]">{label}</span>
        {sub && <span className="block text-[11.5px] text-faint">{sub}</span>}
      </span>
    </button>
  );
}
