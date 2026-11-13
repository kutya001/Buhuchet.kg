import type { ReactNode } from 'react';
import { Icon } from '../icon';
import { CountBadge } from './badge';
import type { ShellLink, ShellModule } from './types';

const DefaultLink: ShellLink = (props) => <a {...props} />;

/*
 * Знак Buhuchet.kg — логотип 36 «растёт перо» (решение заказчика 06.11.2026, прототип v75 `LOGO_SVG`,
 * `logoSvg`, стили `.logo`): спираль цветом бренда, буквы «B» и «u» (Inter Bold) цветом текста; в тёмной
 * теме оба цвета светлее — их дают переменные темы. `centerline` — средняя линия спирали (прототип v78
 * `LOGO_SVG.cl`): по ней лендинг рисует спираль от центра (маска поверх спирали).
 */
export const BRAND_LOGO = {
  viewBox: '1.2 11.1 66 50.9',
  spiral:
    'M25.74 40.63C26.92 40.75 28.13 40.68 29.31 40.39C30.49 40.09 31.63 39.59 32.65 38.9C33.68 38.2 34.57 37.34 35.58 36.53C36.59 35.72 37.52 34.7 38.27 33.49C39.02 32.28 39.6 30.89 39.91 29.37C40.23 27.85 40.28 26.21 40.03 24.56C39.77 22.91 39.21 21.25 38.34 19.69C37.46 18.14 36.28 16.7 34.83 15.49C33.39 14.29 31.69 13.31 29.83 12.66C27.97 12 25.96 11.67 23.91 11.7C21.87 11.73 19.79 12.12 17.81 12.87C15.84 13.61 13.96 14.71 12.3 16.11C10.63 17.5 8.85 18.83 7.3 20.57C5.74 22.31 4.41 24.39 3.45 26.73C2.5 29.08 1.91 31.68 1.8 34.41C1.69 37.14 2.05 39.99 2.95 42.78C3.84 45.56 5.26 48.27 7.17 50.72C9.08 53.17 11.48 55.34 14.26 57.07C17.03 58.8 20.19 60.08 23.54 60.79C26.89 61.5 30.44 61.64 33.98 61.16C37.52 60.68 41.04 59.58 44.34 57.89C47.64 56.2 50.48 53.7 53.52 51.3C56.55 48.9 59.31 45.9 61.56 42.37C63.81 38.85 65.55 34.8 66.56 30.41A2.32 2.32 0 0 0 62.01 29.59C61.5 33.55 60.4 37.35 58.77 40.82C57.13 44.29 54.98 47.43 52.43 50.09C49.88 52.76 46.47 54.24 43.25 55.38C40.04 56.52 36.78 57.09 33.65 57.16C30.52 57.23 27.51 56.8 24.74 55.98C21.97 55.16 19.45 53.95 17.23 52.46C15.01 50.97 13.1 49.2 11.52 47.26C9.95 45.32 8.71 43.21 7.83 41.03C6.94 38.84 6.4 36.58 6.21 34.34C6.01 32.1 6.16 29.87 6.64 27.75C7.11 25.63 7.9 23.62 8.98 21.81C10.05 20 11.4 18.32 13.16 17.35C14.92 16.38 16.75 15.74 18.54 15.41C20.34 15.08 22.09 15.05 23.74 15.26C25.38 15.47 26.92 15.92 28.3 16.54C29.68 17.16 30.91 17.96 31.97 18.87C33.03 19.79 33.92 20.82 34.63 21.92C35.35 23.02 35.89 24.18 36.25 25.38C36.61 26.58 36.8 27.8 36.8 29.01C36.8 30.22 36.62 31.42 36.27 32.55C35.91 33.68 35.39 34.74 34.7 35.69C34.02 36.63 32.97 37.19 31.96 37.54C30.95 37.9 29.93 38.08 28.97 38.1C28.01 38.13 27.09 38.01 26.26 37.77A1.45 1.45 0 0 0 25.74 40.63Z',
  b: {
    transform: 'translate(16.67 34.34) scale(0.51)',
    d: 'M2.6 0H14.9C21.5 0 24.9 -3.4 24.9 -8C24.9 -12.3 21.8 -14.9 18.6 -15.1V-15.4C21.5 -16 23.8 -18.2 23.8 -21.6C23.8 -26 20.6 -29.1 14.2 -29.1H2.6ZM8.6 -4.9V-12.8H13.9C16.9 -12.8 18.8 -11 18.8 -8.6C18.8 -6.4 17.2 -4.9 13.8 -4.9ZM8.6 -16.9V-24.2H13.4C16.2 -24.2 17.8 -22.8 17.8 -20.7C17.8 -18.3 15.9 -16.9 13.3 -16.9Z',
  },
  u: {
    transform: 'translate(43.48 38.62) scale(0.51)',
    d: 'M10 0.3C13.3 0.3 15.6 -1.4 16.8 -4.5L16.9 0H22.4V-21.8H16.5V-9.2C16.5 -6.3 14.8 -4.6 12.3 -4.6C9.8 -4.6 8.4 -6.2 8.4 -9V-21.8H2.5V-7.9C2.5 -2.8 5.5 0.3 10 0.3Z',
  },
  centerline:
    'M26.00 39.20C27.01 39.38 28.07 39.41 29.14 39.25C30.21 39.09 31.29 38.75 32.30 38.22C33.33 37.70 34.30 36.98 35.14 36.11C35.99 35.23 36.72 34.19 37.27 33.02C37.82 31.85 38.20 30.55 38.35 29.19C38.52 27.83 38.45 26.39 38.14 24.97C37.83 23.55 37.28 22.13 36.48 20.80C35.69 19.48 34.66 18.24 33.40 17.18C32.15 16.12 30.69 15.23 29.06 14.60C27.45 13.96 25.67 13.57 23.82 13.48C21.98 13.39 20.06 13.60 18.17 14.14C16.30 14.68 14.44 15.54 12.73 16.73C11.02 17.91 9.45 19.41 8.14 21.19C6.82 22.96 5.76 25.01 5.04 27.24C4.33 29.48 3.96 31.89 4.00 34.38C4.04 36.86 4.50 39.42 5.39 41.91C6.28 44.39 7.60 46.80 9.34 48.99C11.09 51.19 13.25 53.16 15.75 54.77C18.24 56.38 21.08 57.62 24.14 58.38C27.20 59.15 30.48 59.44 33.81 59.16C37.15 58.89 40.54 58.05 43.80 56.64C47.05 55.22 50.18 53.23 52.98 50.70C55.77 48.16 58.22 45.09 60.17 41.59C62.11 38.10 63.52 34.17 64.28 30.00',
} as const;

/** Знак Buhuchet.kg; `className` задаёт размер (по умолчанию 44 × 34, как `.logo` прототипа). */
export function BrandMark({ className = 'h-[34px] w-[44px]' }: { className?: string }) {
  return (
    <svg
      viewBox={BRAND_LOGO.viewBox}
      aria-hidden="true"
      focusable="false"
      data-brand-mark=""
      className={`block flex-none text-ink ${className}`}
    >
      <path className="fill-brand-blue" d={BRAND_LOGO.spiral} />
      <path className="fill-current" transform={BRAND_LOGO.b.transform} d={BRAND_LOGO.b.d} />
      <path className="fill-current" transform={BRAND_LOGO.u.transform} d={BRAND_LOGO.u.d} />
    </svg>
  );
}

export function Brand({
  mode,
  className = 'px-2 pt-2 pb-4',
}: {
  mode: string;
  /** Отступы: в левой панели и в панели «Меню» телефона они разные. */
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-[11px] md:group-data-[nav=hidden]/app:justify-center md:group-data-[nav=hidden]/app:gap-0 md:group-data-[nav=hidden]/app:px-0 ${className}`}
    >
      <BrandMark />
      <div className="md:group-data-[nav=hidden]/app:hidden">
        <div data-brand-name="" className="text-base leading-[1.1] font-[750] tracking-[-0.015em]">
          Buhuchet.kg
        </div>
        <div className="mt-0.5 text-[10.5px] font-[650] tracking-[0.12em] text-faint uppercase">
          {mode}
        </div>
      </div>
    </div>
  );
}

/** Подпись в свёрнутой панели (ПК): на экране её нет, экранный диктор читает. */
// Скрытая подпись (`sr-only`) стоит абсолютно: её кнопка в свёрнутой панели — `relative`, иначе при низком
// окне подпись выходит за панель и страница начинает прокручиваться.
const MINI_TEXT = 'md:group-data-[nav=hidden]/app:sr-only';
/** Счётчик модуля в свёрнутой панели — в правом верхнем углу значка (прототип `.ti .badge`). */
const MINI_BADGE =
  'md:group-data-[nav=hidden]/app:absolute md:group-data-[nav=hidden]/app:top-px md:group-data-[nav=hidden]/app:right-0 md:group-data-[nav=hidden]/app:m-0 md:group-data-[nav=hidden]/app:min-w-4 md:group-data-[nav=hidden]/app:px-1 md:group-data-[nav=hidden]/app:text-[9.5px] md:group-data-[nav=hidden]/app:leading-[15px]';
/** Точка модуля в свёрнутой панели (прототип `.ti .kb-dot`). */
const MINI_DOT =
  'md:group-data-[nav=hidden]/app:absolute md:group-data-[nav=hidden]/app:top-[5px] md:group-data-[nav=hidden]/app:right-1.5 md:group-data-[nav=hidden]/app:m-0';

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
 * Внизу — `footer` (организация, «Выйти из аккаунта»). Свёрнутая панель (прототип v85
 * `.app.nav-hidden`, ПК) — полоска значков: названия, стрелки и вкладки скрыты, название модуля — в
 * подсказке значка, счётчик и точка — в углу значка; экранный диктор названия читает по-прежнему.
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
      className="col-start-1 row-span-2 row-start-1 flex min-h-0 flex-col overflow-x-hidden overflow-y-auto rounded-2xl border border-line bg-pane px-2.5 pt-2 pb-3 shadow-pane max-md:hidden md:group-data-[nav=hidden]/app:px-[7px] md:group-data-[nav=hidden]/app:[scrollbar-width:none] md:group-data-[nav=hidden]/app:[&::-webkit-scrollbar]:hidden"
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
                  title={m.title}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13.5px] font-[550] text-inherit no-underline md:group-data-[nav=hidden]/app:relative md:group-data-[nav=hidden]/app:justify-center md:group-data-[nav=hidden]/app:px-0 md:group-data-[nav=hidden]/app:py-[9px]"
                >
                  <Icon name={m.icon} />
                  <span className={`truncate ${MINI_TEXT}`}>{m.title}</span>
                  {m.count && (
                    <CountBadge
                      count={m.count}
                      className={`ml-auto ${m.count.dot ? MINI_DOT : MINI_BADGE}`}
                    />
                  )}
                </Link>
                {m.tabs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggle(m.id)}
                    aria-expanded={open}
                    aria-label={`${open ? labels.collapse : labels.expand}: ${m.title}`}
                    className="mr-[3px] grid h-[26px] w-[26px] flex-none cursor-pointer place-items-center rounded-[5px] border-0 bg-transparent text-faint hover:bg-row-hover hover:text-ink md:group-data-[nav=hidden]/app:hidden"
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
                <div className="mt-px mb-1.5 ml-[21px] flex flex-col gap-px border-l border-line pl-2 md:group-data-[nav=hidden]/app:hidden">
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
 * открывает окно профиля организации (прототип `orgProfileDlg`).
 */
export function SideOrg({
  name,
  sub,
  title,
  onClick,
}: {
  name: string;
  sub: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-side-org=""
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent p-2 text-left text-ink hover:bg-hover md:group-data-[nav=hidden]/app:relative md:group-data-[nav=hidden]/app:justify-center md:group-data-[nav=hidden]/app:px-0 md:group-data-[nav=hidden]/app:py-1.5"
    >
      <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-btn text-muted shadow-btn">
        <Icon name="landmark" size="sm" />
      </span>
      <span className={`min-w-0 ${MINI_TEXT}`}>
        <span className="block truncate text-[13px] leading-[1.2] font-[650]">{name}</span>
        <span className="block text-[11.5px] text-faint">{sub}</span>
      </span>
    </button>
  );
}

/** Строка кнопок под организацией («Мой профиль», «Выйти из аккаунта»); в свёрнутой панели — столбиком. */
export function SideFootRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-nowrap gap-1 md:group-data-[nav=hidden]/app:flex-col md:group-data-[nav=hidden]/app:items-center">
      {children}
    </div>
  );
}

/**
 * Кнопка в строке под организацией (прототип `.foot-row .btn.ghost.sm`); в свёрнутой панели — один
 * значок 16 px, подпись — в подсказке.
 */
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
      title={label}
      className="inline-flex min-h-[29px] min-w-0 flex-[1_1_auto] cursor-pointer items-center justify-center gap-1 rounded-lg border-0 bg-transparent px-1 py-1 text-[11.5px] font-[550] whitespace-nowrap text-muted hover:bg-row-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 md:group-data-[nav=hidden]/app:relative md:group-data-[nav=hidden]/app:w-full md:group-data-[nav=hidden]/app:gap-0 md:group-data-[nav=hidden]/app:px-0 md:group-data-[nav=hidden]/app:py-[7px]"
    >
      <Icon
        name={icon}
        size="sm"
        className="md:group-data-[nav=hidden]/app:h-4 md:group-data-[nav=hidden]/app:w-4"
      />
      <span className={MINI_TEXT}>{label}</span>
    </button>
  );
}
