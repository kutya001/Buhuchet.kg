import type { ShellCount } from './types';

const TONES = {
  none: 'bg-sel text-muted',
  red: 'bg-danger text-on-accent',
  yellow:
    'bg-warn-bg text-warn shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bu-yellow)_35%,transparent)]',
} as const;

/** Счётчик-«таблетка» (прототип `.badge`): число записей у модуля или вкладки. */
export function CountBadge({ count, className = '' }: { count: ShellCount; className?: string }) {
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
