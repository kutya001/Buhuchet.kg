import type { ReactNode } from 'react';
import { Icon } from '../icon';
import { CountBadge } from './badge';
import type { ShellLink, ShellModule } from './types';

const DefaultLink: ShellLink = (props) => <a {...props} />;

/** Знак Buhuchet.kg (прототип `.logo`): круг, квадрат и треугольник. */
export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid flex-none grid-cols-[repeat(3,10px)] items-end gap-[3px]"
    >
      <i className="block h-2.5 rounded-full bg-brand-red" />
      <i className="block h-2.5 bg-brand-yellow" />
      <i className="block h-0 w-0 border-x-[5px] border-b-[10px] border-x-transparent border-b-brand-blue" />
    </span>
  );
}

export function Brand({ mode }: { mode: string }) {
  return (
    <div className="flex items-center gap-[11px] px-2 pt-2 pb-4">
      <BrandMark />
      <div>
        <div className="text-base leading-[1.1] font-[750] tracking-[-0.015em]">Buhuchet.kg</div>
        <div className="mt-0.5 text-[10.5px] font-[650] tracking-[0.12em] text-faint uppercase">
          {mode}
        </div>
      </div>
    </div>
  );
}

export interface SideNavLabels {
  /** «Модули» — название панели для экранного диктора. */
  nav: string;
  expand: string;
  collapse: string;
}

/**
 * Панель модулей на ПК (прототип ui/shell.js, renderSide; css/shell.css `.side`, `.tree`): вверху
 * «Buhuchet.kg» и режим, дерево модулей до вкладок — название открывает модуль, стрелка рядом
 * раскрывает его вкладки, вкладка открывает модуль сразу на ней; активные модуль и вкладка подсвечены.
 * Внизу — `footer` (организация, «Выйти из аккаунта»).
 */
export function SideNav({
  mode,
  modules,
  activeModule,
  activeTab,
  openIds,
  onToggle,
  labels,
  footer,
  Link = DefaultLink,
}: {
  mode: string;
  modules: readonly ShellModule[];
  activeModule: string | null;
  activeTab: string | null;
  /** Модули с раскрытыми вкладками. */
  openIds: ReadonlySet<string>;
  onToggle: (moduleId: string) => void;
  labels: SideNavLabels;
  footer: ReactNode;
  Link?: ShellLink;
}) {
  return (
    <aside
      aria-label={labels.nav}
      className="col-start-1 row-span-2 row-start-1 flex min-h-0 flex-col overflow-auto rounded-2xl border border-line bg-pane px-2.5 pt-2 pb-3 shadow-pane group-data-[nav=hidden]/app:hidden max-md:hidden"
    >
      <Brand mode={mode} />
      <nav className="flex flex-1 flex-col gap-0.5">
        {modules.map((m) => {
          const on = m.id === activeModule;
          const open = m.tabs.length > 0 && openIds.has(m.id);
          return (
            <div key={m.id}>
              <div
                className={`flex items-center rounded-lg transition-colors duration-150 ${on ? 'bg-nav-active text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]' : 'text-muted hover:bg-hover hover:text-ink'}`}
              >
                <Link
                  href={m.href}
                  aria-current={on ? 'page' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13.5px] font-[550] text-inherit no-underline"
                >
                  <Icon name={m.icon} />
                  <span className="truncate">{m.title}</span>
                  {m.count && <CountBadge count={m.count} className="ml-auto" />}
                </Link>
                {m.tabs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggle(m.id)}
                    aria-expanded={open}
                    aria-label={`${open ? labels.collapse : labels.expand}: ${m.title}`}
                    className="mr-[3px] grid h-[26px] w-[26px] flex-none cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-faint hover:bg-row-hover hover:text-ink"
                  >
                    <Icon
                      name="right"
                      size="sm"
                      className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                    />
                  </button>
                )}
              </div>
              {open && (
                <div className="mt-px mb-1.5 ml-[21px] flex flex-col gap-px border-l border-line pl-2">
                  {m.tabs.map((t) => {
                    const tabOn = on && t.id === activeTab;
                    return (
                      <Link
                        key={t.id}
                        href={t.href}
                        aria-current={tabOn ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-[5px] px-2 py-[5px] text-[13px] no-underline ${tabOn ? 'bg-nav-active font-[550] text-ink' : 'text-muted hover:bg-hover hover:text-ink'}`}
                      >
                        <Icon name={t.icon} size="xs" />
                        <span className="truncate">{t.label}</span>
                        {t.count && <CountBadge count={t.count} className="ml-auto" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5">{footer}</div>
    </aside>
  );
}

/**
 * Организация внизу левой панели (прототип `.orgbtn`): значок, название и строка под ним; нажатие
 * открывает профиль организации.
 */
export function SideOrg({
  name,
  sub,
  href,
  title,
  Link = DefaultLink,
}: {
  name: string;
  sub: string;
  href: string;
  title: string;
  Link?: ShellLink;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="flex items-center gap-2.5 rounded-lg p-2 text-ink no-underline hover:bg-hover"
    >
      <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-btn text-muted shadow-btn">
        <Icon name="landmark" size="sm" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-[1.2] font-[650]">{name}</span>
        <span className="block text-[11.5px] text-faint">{sub}</span>
      </span>
    </Link>
  );
}

/** Строка кнопок под организацией («Мой профиль», «Выйти из аккаунта»). */
export function SideFootRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-nowrap gap-1">{children}</div>;
}

/** Кнопка в строке под организацией (прототип `.foot-row .btn.ghost.sm`). */
export function SideFootButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: 'user' | 'logout';
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-[29px] min-w-0 flex-[1_1_auto] cursor-pointer items-center justify-center gap-1 rounded-lg border-0 bg-transparent px-1 py-1 text-[11.5px] font-[550] whitespace-nowrap text-muted hover:bg-row-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon name={icon} size="sm" />
      {label}
    </button>
  );
}
