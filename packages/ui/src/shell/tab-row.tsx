'use client';

import { Fragment, useLayoutEffect, useRef } from 'react';
import { buttonClass, iconButtonClass } from '../button';
import { Icon } from '../icon';
import { BetaBadge, MenuItems, type MenuItem } from '../menu';
import { Popover } from '../popover';
import { CountBadge } from './badge';
import type { ShellLink, ShellTab } from './types';

const DefaultLink: ShellLink = (props) => <a {...props} />;

const PHONE = '(max-width: 767px)';

/**
 * Подгонка ряда вкладок под ширину (прототип ui/shell.js, fitTabs; ТЗ «Вкладки модуля»): на ПК, если
 * ряд не помещается, сначала у отдельных кнопок добавления остаются только значки, затем уменьшаются
 * отступы вкладок, затем скрываются их значки, и только потом ряд прокручивается; на телефоне остаются
 * только значки. Активная вкладка сдвигается в видимую часть.
 */
function fitTabs(row: HTMLElement) {
  const root = row.parentElement;
  const over = () => row.scrollWidth > row.clientWidth + 2;
  row.dataset.fit = 'full';
  if (root) root.dataset.slim = 'false';
  if (window.matchMedia(PHONE).matches) {
    if (over()) row.dataset.fit = 'icons';
  } else {
    if (over() && root) root.dataset.slim = 'true';
    if (over()) row.dataset.fit = 'tight';
    if (over()) row.dataset.fit = 'labels';
  }
  const on = row.querySelector<HTMLElement>('[aria-selected="true"]');
  // Прокручиваем только ряд: scrollIntoView прокрутил бы и страницу.
  if (on && over()) {
    row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
  }
}

/** Способ добавления; `separate` — на ПК отдельной кнопкой рядом с «+ Добавить», на телефоне — в меню «+». */
export interface AddAction extends MenuItem {
  separate?: boolean;
}

export interface TabRowProps {
  tabs: readonly ShellTab[];
  activeTab: string | null;
  /** Название ряда вкладок для экранного диктора (название модуля). */
  label: string;
  /** Способы добавления по правам; пусто — кнопки «+ Добавить» нет. */
  addActions: readonly AddAction[];
  addLabel: string;
  onAdd: (actionId: string) => void;
  /** Кнопка «Статистика»: только у экрана с плашками-итогами. */
  stats?: StatsToggle;
  Link?: ShellLink;
}

/**
 * Кнопка «Статистика» (прототип ui/shell.js, `#stat-btn`; ТЗ «Статистика модуля»): скрывает и
 * показывает плашки-итоги модуля; подсказка — «Показать статистику» или «Скрыть статистику».
 */
export interface StatsToggle {
  shown: boolean;
  onToggle: () => void;
  label: string;
  show: string;
  hide: string;
}

/**
 * Ряд вкладок и кнопка «+ Добавить» (прототип ui/shell.js, renderPage; css/controls.css `.tabrow`,
 * `.tab`, `.add-btn`): вкладки-«острова» со значком и счётчиком по центру, кнопка справа на том же
 * уровне; между группами вкладок — черта (`.tab-sep`). Один способ добавления — кнопка сразу его запускает, несколько — открывает меню выбора. На
 * телефоне вместо кнопки — круглая «+» справа внизу со всеми способами. У экрана с плашками-итогами
 * перед ними — значок «Статистика» (на ПК и на телефоне).
 */
export function TabRow({
  tabs,
  activeTab,
  label,
  addActions,
  addLabel,
  onAdd,
  stats,
  Link = DefaultLink,
}: TabRowProps) {
  const row = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    fitTabs(el);
    const observer = new ResizeObserver(() => fitTabs(el));
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [tabs, activeTab]);

  const separate = addActions.filter((a) => a.separate);
  const inMenu = addActions.filter((a) => !a.separate);

  return (
    <div data-slim="false" className="group/row flex min-w-0 items-center gap-2.5">
      <span className="min-w-0 flex-[1_1_0] max-md:hidden" />
      {tabs.length > 0 && (
        <div
          ref={row}
          role="tablist"
          aria-label={label}
          data-tabrow
          data-fit="full"
          data-swiping="false"
          className="group/tabs relative -mt-0.5 mb-0.5 flex min-w-0 flex-[0_1_auto] gap-1.5 overflow-x-auto px-0.5 pt-1 pb-1.5 [scrollbar-width:none] data-[fit=tight]:gap-1 data-[fit=labels]:gap-1 max-md:flex-[1_1_auto] [&::-webkit-scrollbar]:hidden [&>:first-child]:ml-auto [&>:last-child]:mr-auto"
        >
          {tabs.map((t, i) => {
            const on = t.id === activeTab;
            const sep = i > 0 && !!t.group && t.group !== tabs[i - 1]!.group;
            return (
              <Fragment key={t.id}>
                {sep ? (
                  <span
                    aria-hidden="true"
                    data-tab-sep
                    className="mx-0.5 my-1 w-px flex-none self-stretch bg-line-strong"
                  />
                ) : null}
                <Link
                  href={t.href}
                  role="tab"
                  aria-selected={on}
                  title={t.title ?? t.label}
                  className={`inline-flex flex-none cursor-pointer items-center gap-[7px] rounded-full border px-3.5 py-[7px] text-[13px] font-[550] no-underline transition-[background-color,color,transform] duration-200 group-data-[fit=icons]/tabs:px-[11px] group-data-[fit=labels]/tabs:gap-[5px] group-data-[fit=labels]/tabs:px-[9px] group-data-[fit=tight]/tabs:gap-[5px] group-data-[fit=tight]/tabs:px-[9px] ${on ? 'animate-pop border-transparent bg-raised text-ink shadow-btn group-data-[swiping=true]/tabs:animate-none group-data-[swiping=true]/tabs:border-line group-data-[swiping=true]/tabs:bg-pane-alt group-data-[swiping=true]/tabs:text-muted group-data-[swiping=true]/tabs:shadow-none' : 'border-line bg-pane-alt text-muted hover:-translate-y-px hover:bg-raised hover:text-ink'}`}
                >
                  <span className="inline-grid group-data-[fit=labels]/tabs:hidden">
                    <Icon name={t.icon} size="tab" />
                  </span>
                  {/* Без места — только значок; название остаётся в имени вкладки для экранного диктора. */}
                  <span className="group-data-[fit=icons]/tabs:sr-only">{t.label}</span>
                  {t.count && <CountBadge count={t.count} />}
                </Link>
              </Fragment>
            );
          })}
        </div>
      )}
      <div className="flex min-w-max flex-[1_0_0] items-center justify-end gap-2 empty:min-w-0 max-md:flex-[0_0_auto] max-md:min-w-0">
        {stats && (
          <button
            type="button"
            data-no-swipe
            data-stats-toggle
            onClick={stats.onToggle}
            aria-label={stats.label}
            aria-pressed={stats.shown}
            title={stats.shown ? stats.hide : stats.show}
            className={`${iconButtonClass()} ${stats.shown ? 'bg-btn! text-ink! shadow-btn' : ''}`}
          >
            <Icon name="chart" />
          </button>
        )}
        {separate.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onAdd(a.id)}
            title={a.label}
            className={`${buttonClass()} max-md:hidden`}
          >
            <Icon name={a.icon} />
            <span className="group-data-[slim=true]/row:hidden">{a.label}</span>
            {a.badge && <BetaBadge label={a.badge} />}
          </button>
        ))}
        {inMenu.length > 0 && (
          <span className="contents max-md:hidden">
            <AddControl actions={inMenu} label={addLabel} onAdd={onAdd} />
          </span>
        )}
      </div>
      {addActions.length > 0 && (
        // Свайп вкладок не начинается на кнопке «+».
        <span data-no-swipe className="contents">
          <AddControl actions={addActions} label={addLabel} onAdd={onAdd} fab />
        </span>
      )}
    </div>
  );
}

/** «+ Добавить» на ПК или круглая «+» на телефоне: один способ — сразу, несколько — меню. */
function AddControl({
  actions,
  label,
  onAdd,
  fab = false,
}: {
  actions: readonly MenuItem[];
  label: string;
  onAdd: (id: string) => void;
  fab?: boolean;
}) {
  const many = actions.length > 1;
  const wrapper = fab
    ? 'fixed right-4 bottom-[calc(78px+env(safe-area-inset-bottom,0px))] z-20 inline-flex group-data-[kb=true]/app:hidden md:hidden'
    : 'relative inline-flex';
  const look = fab
    ? 'grid h-[54px] w-[54px] cursor-pointer place-items-center rounded-full border-0 bg-accent text-on-accent shadow-[var(--bu-sh-cta),var(--bu-shadow-l)]'
    : buttonClass('cta');
  const content = fab ? (
    <Icon name="plus" className="h-6 w-6 stroke-[2.2]" />
  ) : (
    <>
      <Icon name="plus" />
      <span>{label}</span>
      {many && <Icon name="down" size="sm" />}
    </>
  );
  if (!many) {
    return (
      <span className={wrapper}>
        <button
          type="button"
          onClick={() => onAdd(actions[0]!.id)}
          aria-label={fab ? label : undefined}
          title={label}
          className={look}
        >
          {content}
        </button>
      </span>
    );
  }
  return (
    <Popover
      label={label}
      role="menu"
      placement={fab ? 'top-end' : 'bottom-end'}
      className={wrapper}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={fab ? label : undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          className={look}
        >
          {content}
        </button>
      )}
    >
      {(close) => (
        <MenuItems
          items={actions}
          onSelect={(id) => {
            close();
            onAdd(id);
          }}
        />
      )}
    </Popover>
  );
}
