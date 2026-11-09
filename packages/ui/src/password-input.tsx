'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type Ref,
  type RefCallback,
} from 'react';
import { inputClass, MONO_CLASS } from './form';
import { Icon } from './icon';

/** Подписи глаза в поле пароля (из словаря): «Показать пароль» и «Скрыть пароль». */
export interface PasswordEyeLabels {
  show: string;
  hide: string;
}

/** Значки и подпись глаза: открыт — «Скрыть пароль» и перечёркнутый глаз (прототип pwEyeBtn). */
export const passwordEye = (open: boolean, labels: PasswordEyeLabels) => ({
  icon: open ? ('eyeoff' as const) : ('eye' as const),
  label: open ? labels.hide : labels.show,
});

/** Скрытый пароль на экране: точки по длине, не меньше восьми (прототип pwTxt). */
export const passwordDots = (value: string) => '•'.repeat(Math.max(8, value.length));

const EYE_CLASS =
  'grid shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue';

function EyeButton({
  open,
  labels,
  controls,
  className,
  onToggle,
}: {
  open: boolean;
  labels: PasswordEyeLabels;
  controls: string | undefined;
  className: string;
  onToggle: () => void;
}) {
  const eye = passwordEye(open, labels);
  return (
    <button
      type="button"
      className={`${EYE_CLASS} ${className}`}
      aria-controls={controls}
      aria-pressed={open}
      aria-label={eye.label}
      title={eye.label}
      data-pw-eye=""
      // Нажатие на глаз не уводит фокус из поля (прототип: mousedown → preventDefault).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
    >
      <Icon name={eye.icon} size="sm" />
    </button>
  );
}

/**
 * Поле пароля с глазом (прототип v82 pwInp, стили `.pw-w`, `.pw-eye`): глаз справа в поле, 40 px
 * (44 px на сенсорном экране), показывает и скрывает пароль; курсор и выделение остаются, где были.
 * Открытость не запоминается: новое поле — скрыто, временный пароль — `open` (сразу виден).
 */
export function PasswordInput({
  labels,
  open: initial = false,
  mono = false,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  labels: PasswordEyeLabels;
  open?: boolean;
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(initial);
  const input = useRef<HTMLInputElement | null>(null);
  // Выделение поля в фокусе до смены вида: после смены type браузер может его сбросить.
  const keep = useRef<[number | null, number | null] | null>(null);
  const setRef: RefCallback<HTMLInputElement> = (el) => {
    input.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };
  useLayoutEffect(() => {
    const el = input.current;
    const sel = keep.current;
    keep.current = null;
    if (!el || !sel) return;
    el.focus();
    try {
      el.setSelectionRange(sel[0], sel[1]);
    } catch {
      // У некоторых типов поля выделение не задаётся — не страшно.
    }
  }, [open]);
  const toggle = () => {
    const el = input.current;
    keep.current =
      el && typeof document !== 'undefined' && document.activeElement === el
        ? [el.selectionStart, el.selectionEnd]
        : null;
    setOpen((x) => !x);
  };
  return (
    <span className="relative block" data-pw="">
      <input
        {...props}
        ref={setRef}
        type={open ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="off"
        className={`${inputClass({ mono })} pr-[42px] pointer-coarse:min-h-[44px] pointer-coarse:pr-12 [&::-ms-clear]:hidden [&::-ms-reveal]:hidden`}
      />
      <EyeButton
        open={open}
        labels={labels}
        controls={props.id}
        className="absolute inset-y-0 right-0 w-10 rounded-r-lg pointer-coarse:w-11"
        onToggle={toggle}
      />
    </span>
  );
}

/**
 * Временный пароль текстом с глазом (прототип v82 pwTxt, «Пароль сброшен»): сразу виден, глаз
 * прячет его точками. `data-temporary-password` — у самого пароля.
 */
export function PasswordText({
  value,
  labels,
  id,
}: {
  value: string;
  labels: PasswordEyeLabels;
  id?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <span className="inline-flex items-center gap-0.5 align-middle" data-pw="">
      <b id={id} data-temporary-password="" className={`${MONO_CLASS} text-base`}>
        {open ? value : passwordDots(value)}
      </b>
      <EyeButton
        open={open}
        labels={labels}
        controls={id}
        className="h-8 w-9 rounded-md pointer-coarse:h-11 pointer-coarse:w-11"
        onToggle={() => setOpen((x) => !x)}
      />
    </span>
  );
}
