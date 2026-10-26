import type { ReactNode } from 'react';
import { buttonClass, linkButtonClass } from './button';
import { Icon } from './icon';
import type { IconName } from './icons';

/** Кнопка пустого состояния: первое действие — основная (`primary`), остальные — обычные. */
export interface EmptyAction {
  id: string;
  label: string;
  icon: IconName;
  onClick: () => void;
  primary?: boolean;
}

/**
 * Пустое состояние вместо пустого списка или вкладки (ТЗ «Пустые состояния и первый вход», прототип
 * css/grid.css `.state`, ui/empty.js feHtml): значок, одна строка «что здесь будет», пояснение и кнопка
 * первого действия. Ошибок и пустых таблиц с шапкой новая организация не видит.
 */
export function EmptyState({
  icon,
  title,
  text,
  actions = [],
  children,
}: {
  icon: IconName;
  title: string;
  text?: string;
  actions?: readonly EmptyAction[];
  /** Своё содержимое под пояснением (например, ссылка «Сбросить фильтры»). */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-pane-alt px-4 py-[42px] text-center text-muted">
      <Icon name={icon} size="lg" className="text-faint" />
      <b className="max-w-[520px] text-[15px] text-balance text-ink">{title}</b>
      {text && <span className="max-w-[420px]">{text}</span>}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              className={buttonClass(a.primary ? 'cta' : 'default')}
            >
              <Icon name={a.icon} />
              {a.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * В списке стоит поиск или фильтр, а записей нет: не пустое состояние, а «Ничего не найдено» со
 * ссылкой «Сбросить фильтры» (ТЗ «Пустые состояния и первый вход», прототип ui/grid.js emptyHtml).
 */
export function NothingFound({
  title,
  text,
  resetLabel,
  onReset,
}: {
  title: string;
  text?: string;
  resetLabel: string;
  onReset: () => void;
}) {
  return (
    <EmptyState icon="search" title={title} text={text}>
      <button type="button" onClick={onReset} className={linkButtonClass()}>
        {resetLabel}
      </button>
    </EmptyState>
  );
}
