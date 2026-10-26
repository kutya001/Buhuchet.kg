'use client';

import { useLayoutEffect, useRef } from 'react';
import { Icon } from './icon';
import type { IconName } from './icons';
import { MenuItems } from './menu';
import { Popover } from './popover';
import { CountBadge } from './shell/badge';
import type { ShellCount } from './shell/types';

const PHONE = '(max-width: 767px)';

/** Вкладка карточки записи (контрагент, сотрудник). */
export interface CardTab {
  id: string;
  label: string;
  icon: IconName;
  /** Нулевой счётчик не показывается (ТЗ «Карточка записи с вкладками»). */
  count?: ShellCount;
}

/**
 * На ПК ряд не помещается — сначала уменьшаются отступы, затем скрываются значки, и только потом
 * ряд прокручивается, а текущая вкладка сдвигается в видимую часть (прототип ui/mobile-pack.js
 * ctabsFit). На телефоне видна только текущая вкладка — подгонять нечего.
 */
function fitCardTabs(row: HTMLElement) {
  const over = () => row.scrollWidth > row.clientWidth + 1;
  row.dataset.fit = 'full';
  if (window.matchMedia(PHONE).matches) return;
  if (over()) row.dataset.fit = 'tight';
  if (over()) row.dataset.fit = 'labels';
  const on = row.querySelector<HTMLElement>('[aria-selected="true"]');
  if (on && over()) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
}

const TAB =
  'inline-flex flex-none cursor-pointer items-center gap-[7px] rounded-full border px-[11px] py-[5px] text-[12.5px] font-[550] transition-[background-color,color,transform] duration-200 group-data-[fit=labels]/ctabs:gap-[5px] group-data-[fit=labels]/ctabs:px-[9px] group-data-[fit=tight]/ctabs:gap-[5px] group-data-[fit=tight]/ctabs:px-[9px]';
const BADGE = 'min-w-[18px] px-[5px] text-[10.5px] leading-4';

/**
 * Ряд вкладок карточки записи (прототип ui/popups.js cardTabs и bindCardTabs, css/cards.css
 * `.ctabs`; ТЗ «Карточка записи с вкладками»): закреплён вверху содержимого окна, со значками и
 * счётчиками. На телефоне вместо ряда — одна кнопка во всю ширину: значок и название текущей вкладки,
 * счётчик, справа «N из M» и стрелка; нажатие открывает список всех вкладок, текущая выделена (ряд
 * на телефоне не прокручивается, поэтому список не обрезается). Свайп по содержимому окна листает
 * вкладки (`Modal` с `tabs`).
 */
export function CardTabs({
  tabs,
  active,
  onSelect,
  label,
  position,
  inWindow = false,
}: {
  tabs: readonly CardTab[];
  active: string;
  onSelect: (id: string) => void;
  /** Название ряда для экранного диктора. */
  label: string;
  /** «N из M» текущей вкладки на телефоне (текст из словаря). */
  position: (n: number, total: number) => string;
  /**
   * Ряд в содержимом окна: закрепляется у самого верха, поверх отступа содержимого (прототип
   * css/cards.css `.mb>.ctabs`).
   */
  inWindow?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    fitCardTabs(el);
    const observer = new ResizeObserver(() => fitCardTabs(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabs, active]);

  const items = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    sub: t.count?.value ? String(t.count.value) : undefined,
  }));

  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      data-fit="full"
      className={`group/ctabs sticky z-[4] -mx-1 flex ${inWindow ? '-top-1.5 -mt-1.5 max-md:-top-1 max-md:-mt-1' : 'top-0'} gap-1.5 overflow-x-auto bg-pane px-1 py-2 shadow-[0_1px_0_var(--bu-border)] [scrollbar-width:none] data-[fit=labels]:gap-1 data-[fit=tight]:gap-1 max-md:overflow-visible [&::-webkit-scrollbar]:hidden [&>:first-child]:ml-auto [&>:last-child]:mr-auto`}
    >
      {tabs.map((t, i) => {
        const count = t.count?.value ? <CountBadge count={t.count} className={BADGE} /> : null;
        const icon = (
          <span className="inline-grid group-data-[fit=labels]/ctabs:hidden">
            <Icon name={t.icon} size="tab" />
          </span>
        );
        if (t.id !== active) {
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected="false"
              title={t.label}
              onClick={() => onSelect(t.id)}
              className={`${TAB} border-line bg-pane-alt text-muted hover:-translate-y-px hover:bg-raised hover:text-ink max-md:hidden`}
            >
              {icon}
              <span>{t.label}</span>
              {count}
            </button>
          );
        }
        return (
          <Popover
            key={t.id}
            label={label}
            role="menu"
            className="relative inline-flex flex-none max-md:flex-auto"
            trigger={({ open, toggle, id }) => (
              <button
                type="button"
                role="tab"
                aria-selected="true"
                aria-expanded={open}
                aria-controls={id}
                title={t.label}
                // Список всех вкладок — только на телефоне; на ПК текущая вкладка уже открыта.
                onClick={() => {
                  if (window.matchMedia(PHONE).matches) toggle();
                }}
                className={`${TAB} animate-pop border-transparent bg-raised text-ink shadow-btn max-md:min-h-11 max-md:flex-auto max-md:justify-start max-md:px-3.5 max-md:py-[9px] max-md:text-sm`}
              >
                {icon}
                <span>{t.label}</span>
                {count}
                <span className="ml-auto hidden items-center gap-1 text-xs font-semibold text-faint max-md:inline-flex">
                  {position(i + 1, tabs.length)}
                  <Icon name="down" size="sm" />
                </span>
              </button>
            )}
          >
            {(close) => (
              <MenuItems
                items={items}
                active={active}
                onSelect={(id) => {
                  close();
                  if (id !== active) onSelect(id);
                }}
              />
            )}
          </Popover>
        );
      })}
    </div>
  );
}
