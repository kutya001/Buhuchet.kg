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

/**
 * Пункты меню действий (прототип ui/popups.js, menu; стиль `.mi`): значок, название, пояснение.
 * Используется внутри `Popover` с role="menu".
 */
export function MenuItems({
  items,
  onSelect,
}: {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
}) {
  return items.map((item) => (
    <button
      key={item.id}
      type="button"
      role="menuitem"
      onClick={() => onSelect(item.id)}
      className="flex w-full cursor-pointer items-start gap-2.5 rounded-[5px] border-0 bg-transparent px-2.5 py-[7px] text-left text-[13px] leading-[1.35] text-ink hover:bg-row-hover"
    >
      <Icon name={item.icon} className="mt-px text-muted" />
      <span>
        {item.label}
        {item.badge && (
          <>
            {' '}
            <span className="inline-flex items-center rounded-full bg-warn-bg px-[7px] align-middle text-[11px] leading-[17px] font-bold tracking-[0.02em] text-warn">
              {item.badge}
            </span>
          </>
        )}
        {item.sub && <span className="block text-[11.5px] text-faint">{item.sub}</span>}
      </span>
    </button>
  ));
}
