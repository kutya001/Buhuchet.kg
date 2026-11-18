'use client';

import type { ReactNode } from 'react';
import { Icon } from './icon';
import { Popover } from './popover';

/**
 * «?» с пояснением (прототип v131 ui/empty.js `tipI`, css/popups.css `.tipi`, `.tip-t`; решение
 * заказчика 17.11.2026 «Меньше текста, понятнее, плавнее»): постоянный текст на экране заменяет значок
 * «?» — пояснение открывается при наведении на ПК и по нажатию на телефоне (там — листом снизу). Значок
 * 22 px (на телефоне 24 px), область нажатия — не меньше 44 px.
 */
export function HelpTip({
  label,
  text,
  tone = 'muted',
  className = '',
}: {
  /** Название пояснения для экранного диктора: к чему оно («Вознаграждение», «К уплате»). */
  label: string;
  text: ReactNode;
  /** `current` — цветом текста вокруг (в цветной метке или заметке). */
  tone?: 'muted' | 'current';
  className?: string;
}) {
  if (!text) return null;
  return (
    <Popover
      label={label}
      padded
      hover
      className={`relative inline-flex align-middle ${className}`}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          // В строке с переключателем (`label`) нажатие на «?» не переключает её.
          onClick={(e) => {
            e.preventDefault();
            toggle();
          }}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          data-help-tip=""
          className={`relative ml-0.5 inline-grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent transition-[background-color,color] duration-100 before:absolute before:-inset-[11px] before:content-[''] hover:bg-row-hover max-md:h-6 max-md:w-6 ${tone === 'current' ? 'text-current opacity-80' : 'text-muted hover:text-ink'}`}
        >
          <Icon name="help" size="sm" />
        </button>
      )}
    >
      {() => (
        <span className="block max-w-[320px] px-0.5 text-[13.5px] leading-normal font-normal whitespace-normal text-ink max-md:max-w-none max-md:px-1 max-md:pb-1 max-md:text-[15px]">
          {text}
        </span>
      )}
    </Popover>
  );
}
