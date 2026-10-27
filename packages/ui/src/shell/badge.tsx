import type { ShellCount } from './types';

const TONES = {
  none: 'bg-sel text-muted',
  // Красный — цвет опасной кнопки: в тёмной теме темнее, чем в прототипе, контраст не ниже 4,5 : 1.
  red: 'bg-danger-btn text-on-accent',
  yellow:
    'bg-warn-bg text-warn-label shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bu-yellow)_35%,transparent)]',
} as const;

/** Счётчик-«таблетка» (прототип `.badge`): число записей у модуля или вкладки. */
export function CountBadge({ count, className = '' }: { count: ShellCount; className?: string }) {
  if (count.dot) return <NavDot title={count.title} className={className} />;
  // Нулевой счётчик — серый, даже если вкладка «красная» (как в прототипе).
  const tone = count.value && count.tone ? count.tone : 'none';
  return (
    <span
      title={count.title}
      className={`min-w-5 flex-none rounded-full px-1.5 text-center text-[11px] leading-[18px] font-[650] tabular-nums ${TONES[tone]} ${className}`}
    >
      {count.value}
    </span>
  );
}

/** Синяя точка у модуля или на кнопке «Меню» (прототип `.kb-dot`, `#burger.has-dot`). */
export function NavDot({ title, className = '' }: { title?: string; className?: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      role={title ? 'img' : undefined}
      className={`h-2 w-2 flex-none rounded-full bg-info shadow-[0_0_0_3px_var(--color-info-bg)] ${className}`}
    />
  );
}
