/**
 * Кружок с инициалами (прототип `.av.round`): сотрудник в списке и в меню профиля. Инициалы считает
 * экран (`initials` из `@buhuchet/domain`).
 */
export function Avatar({ initials, size = 26 }: { initials: string; size?: 26 | 30 }) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full bg-btn font-bold tracking-[0.02em] text-muted shadow-btn ${size === 26 ? 'h-[26px] w-[26px] text-[10.5px]' : 'h-[30px] w-[30px] text-[12px]'}`}
    >
      {initials}
    </span>
  );
}
