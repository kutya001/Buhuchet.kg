import { Icon } from './icon';
import type { IconName } from './icons';

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  /** Пояснение мелким шрифтом под названием. */
  sub?: string;
  /** Метка рядом с названием, например «Бета». */
  badge?: string;
}

/** Метка «Бета» у способа добавления (прототип `.beta-p`). */
export function BetaBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-warn-bg px-[7px] align-middle text-[11px] leading-[17px] font-bold tracking-[0.02em] text-warn">
      {label}
    </span>
  );
}

/**
 * Пункты меню действий (прототип ui/popups.js, menu; стиль `.mi`): значок, название, пояснение.
 * Используется внутри `Popover` с role="menu".
 */
export function MenuItems({
  items,
  onSelect,
  active,
}: {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  /** Выделенный пункт (прототип `.mi.on`), например текущая вкладка карточки. */
  active?: string;
}) {
  return items.map((item) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      aria-current={item.id === active ? 'true' : undefined}
      onClick={() => onSelect(item.id)}
      className={`flex w-full cursor-pointer items-start gap-2.5 rounded-[5px] border-0 px-2.5 py-[7px] text-left text-[13px] leading-[1.35] text-ink ${item.id === active ? 'bg-sel font-semibold' : 'bg-transparent hover:bg-row-hover'}`}
    >
      <Icon name={item.icon} className="mt-px text-muted" />
      <span>
        {item.label}
        {item.badge && (
          <>
            {' '}
            <BetaBadge label={item.badge} />
          </>
        )}
        {item.sub && <span className="block text-[11.5px] text-faint">{item.sub}</span>}
      </span>
    </button>
  ));
}
