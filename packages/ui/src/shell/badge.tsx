import type { ShellCount } from './types';

const TONES = {
  // Серый — `--label` на `--label-bg`, как в прототипе v59: не ниже 4,5 : 1 (docs/deviations.md, п. 26).
  none: 'bg-label-bg text-label',
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

/** Цвет точки: синяя — «Начните с Базы знаний», красная и жёлтая — незаполненные показатели. */
const DOT_TONES = {
  info: 'bg-info shadow-[0_0_0_3px_var(--color-info-bg)]',
  red: 'bg-danger shadow-[0_0_0_3px_var(--color-danger-bg)]',
  yellow: 'bg-warn shadow-[0_0_0_3px_var(--color-warn-bg)]',
} as const;

/**
 * Точка у модуля или на кнопке «Меню» (прототип `.kb-dot`, `#burger.has-dot`): синяя; на «Меню» —
 * красная или жёлтая, когда не заполнены показатели (`#burger.dot-red`, `.dot-yellow`).
 */
export function NavDot({
  title,
  tone = 'info',
  className = '',
}: {
  title?: string;
  tone?: keyof typeof DOT_TONES;
  className?: string;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      role={title ? 'img' : undefined}
      className={`h-2 w-2 flex-none rounded-full ${DOT_TONES[tone]} ${className}`}
    />
  );
}
