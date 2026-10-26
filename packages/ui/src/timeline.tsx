import type { ReactNode } from 'react';

export interface TimelineItem {
  id: string;
  /** Дата и время слева: две строки. */
  date: string;
  time: string;
  /** Что произошло. */
  text: ReactNode;
  /** Кто — под текстом серым. */
  who: string;
}

/**
 * Лента событий (`ul.tl` прототипа, cards.css): слева дата и время, справа что произошло и кто;
 * строки разделены чертой («История изменений учётной политики»).
 */
export function Timeline({ items, label }: { items: readonly TimelineItem[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((item) => (
        <li
          key={item.id}
          data-timeline-item=""
          className="grid grid-cols-[92px_minmax(0,1fr)] gap-2.5 border-b border-line py-[7px] text-[13px] last:border-b-0"
        >
          <span className="text-[12px] text-faint tabular-nums">
            {item.date}
            <br />
            {item.time}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {item.text}
            <br />
            <span className="text-[12px] text-muted">{item.who}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
