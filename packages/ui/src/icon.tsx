import { ICONS, type IconName } from './icons';

const SIZES = {
  sm: 'h-[13px] w-[13px] stroke-2',
  /** Вкладка в дереве модулей. */
  xs: 'h-3.5 w-3.5 stroke-[1.75]',
  /** Вкладка модуля в ряду вкладок. */
  tab: 'h-[15px] w-[15px] stroke-[1.75]',
  md: 'h-4 w-4 stroke-[1.75]',
  lg: 'h-7 w-7 stroke-[1.5]',
} as const;

/**
 * Значок как в прототипе (`ic()` в core/icons.js, класс `.ic`): линии цвета текста, размер 16 px,
 * `sm` — 13 px, `xs` — 14 px, `tab` — 15 px, `lg` — 28 px. Значок только украшает: смысл всегда
 * дублирует подпись или aria-label.
 */
export function Icon({
  name,
  size = 'md',
  className = '',
}: {
  name: IconName;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={`flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] ${SIZES[size]} ${className}`}
      // Содержимое — постоянная строка из ICONS, не данные пользователя; чужое имя — пустой значок.
      dangerouslySetInnerHTML={{ __html: Object.hasOwn(ICONS, name) ? ICONS[name] : '' }}
    />
  );
}
