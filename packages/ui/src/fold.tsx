import type { ReactNode } from 'react';

/** Строка-заголовок свёрнутого блока: стрелка, подпись серым, не ниже 36 px (на телефоне 44 px). */
const SUMMARY_CLASS =
  'flex min-h-9 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-muted select-none [-webkit-tap-highlight-color:transparent] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:min-h-11 [&::-webkit-details-marker]:hidden';

/** Стрелка «›», у раскрытого — «⌄» (прототип `details.fmore>summary::before`). */
function Chevron() {
  return (
    <span
      aria-hidden="true"
      className="mx-[3px] inline-block h-[7px] w-[7px] -rotate-45 border-r-2 border-b-2 border-current transition-transform duration-180 ease-[cubic-bezier(.2,.8,.2,1)] group-open:rotate-45 motion-reduce:transition-none"
    />
  );
}

/** Содержимое раскрытого блока появляется плавно (прототип `slideUp`), без движения — сразу. */
const BODY_CLASS = 'animate-rise motion-reduce:animate-none';

/**
 * Свёрнутый блок (решение заказчика 17.11.2026, «Меньше текста, понятнее, плавнее»; прототип v134
 * `details.rc-det`, `details.rc-hist`): редкое — под одной строкой, раскрывается по нажатию. `box` —
 * блок карточки с заголовком-строкой («История»), иначе — строка внутри блока («Подробности»).
 */
export function Fold({
  title,
  box = false,
  open,
  onToggle,
  children,
  ...data
}: {
  title: ReactNode;
  box?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
} & { [key: `data-${string}`]: string }) {
  return (
    <details
      {...data}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      className={
        box
          ? 'group min-w-0 rounded-xl border border-line bg-raised px-4 py-2'
          : 'group mt-2 min-w-0 border-t border-line pt-1'
      }
    >
      <summary className={SUMMARY_CLASS}>
        <Chevron />
        {title}
      </summary>
      <div className={`${BODY_CLASS} ${box ? 'flex flex-col gap-2.5 pb-1.5' : ''}`}>{children}</div>
    </details>
  );
}

/**
 * «Дополнительно» в форме (прототип v134 `fMore`): редкие поля свёрнуты; рядом с подписью —
 * «· заполнено N», если в них уже что-то есть. Ставится на всю ширину сетки формы.
 */
export function FormMore({
  label,
  filled = 0,
  filledLabel,
  open,
  onToggle,
  children,
  ...data
}: {
  label: string;
  /** Сколько редких полей уже заполнено. */
  filled?: number;
  /** «заполнено {n}» из словаря — при `filled > 0`. */
  filledLabel?: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
} & { [key: `data-${string}`]: string }) {
  return (
    <details
      {...data}
      open={open}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      className="group col-span-full min-w-0"
    >
      <summary className={SUMMARY_CLASS}>
        <Chevron />
        {label}
        {filled > 0 && filledLabel ? (
          <span className="font-normal text-faint">· {filledLabel}</span>
        ) : null}
      </summary>
      <div className={`${BODY_CLASS} mt-2`}>{children}</div>
    </details>
  );
}
