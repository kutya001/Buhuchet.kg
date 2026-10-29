import type { ReactNode } from 'react';

/**
 * Переключатель (`.sw` прототипа, controls.css): дорожка 36 × 20, бегунок 16 px; включён — зелёный,
 * недоступен — бледный.
 */
export const SWITCH_CLASS = [
  'relative m-0 h-5 w-9 flex-none cursor-pointer appearance-none rounded-full bg-line-strong align-middle',
  'shadow-[inset_0_1px_3px_rgba(0,0,0,.22)] transition-colors duration-200',
  "after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-knob after:content-['']",
  'after:shadow-[0_1px_2px_rgba(0,0,0,.3)] after:transition-transform after:duration-200',
  'checked:bg-ok checked:after:translate-x-4 disabled:cursor-not-allowed disabled:opacity-50',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
].join(' ');

/** Галочка (`input[type=checkbox]` прототипа): 16 px, цвет акцента. */
export const CHECKBOX_CLASS =
  'm-0 h-4 w-4 flex-none cursor-pointer accent-accent align-middle disabled:cursor-default';

/**
 * Строка с переключателем или галочкой (`.check-row` прототипа): слева переключатель, справа название
 * и пояснения под ним; строки разделены чертой. Нажатие на любую часть строки переключает.
 * `kind="check"` — галочка (разделы страницы контрагента), `compact` — с меньшими отступами (вложенный
 * список под переключателем, `.pg-pol .check-row`). Строки ставятся прямо в `Box`: между ними его отступ.
 */
export function CheckRow({
  kind = 'switch',
  checked,
  disabled = false,
  onChange,
  label,
  children,
  compact = false,
  plain = false,
  ...data
}: {
  kind?: 'switch' | 'check';
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  /** Название: у переключателя — жирным, если не `plain`. */
  label: ReactNode;
  /** Пояснения под названием (`.hint`). */
  children?: ReactNode;
  compact?: boolean;
  /** Название переключателя обычным шрифтом (настройки напоминаний в Telegram). */
  plain?: boolean;
} & { [attr: `data-${string}`]: string | undefined }) {
  return (
    <label
      data-check-row=""
      {...data}
      className={`flex items-center gap-2.5 border-b border-line last:border-b-0 ${compact ? 'py-1' : 'py-2'} ${disabled ? '' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        role={kind === 'switch' ? 'switch' : undefined}
        className={kind === 'switch' ? SWITCH_CLASS : CHECKBOX_CLASS}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        {kind === 'switch' && !plain ? <b>{label}</b> : label}
        {children}
      </span>
    </label>
  );
}

/** Пояснение под названием в строке (`.hint`): мелкий бледный текст. */
export function Hint({ children }: { children: ReactNode }) {
  return <div className="text-[11.5px] leading-[1.4] text-faint">{children}</div>;
}
