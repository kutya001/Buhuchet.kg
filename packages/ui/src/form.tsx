'use client';

import { useRef, type ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icons';
import { useFormPack } from './use-form-pack';

/**
 * Поля и блоки форм как в прототипе (spec/prototype/src/css/controls.css `.inp`, `.fld`, `.form`;
 * cards.css `.box`, `.kv`, `.note`; ui/popups.js `fld`, `setErr`). Тексты — пропсами из словаря.
 */

/** Моноширинный текст (`.mono`): логин, код, номер счёта. */
export const MONO_CLASS = 'font-mono text-[.92em] [font-feature-settings:"calt"_1,"zero"_1]';

/**
 * Поле ввода (`.inp`): рамка, при фокусе — тёмная рамка и кольцо, с ошибкой (`aria-invalid`) —
 * красная рамка, только для чтения — фон панели. Подходит для input, select и textarea.
 */
export function inputClass(options: { mono?: boolean; multiline?: boolean } = {}): string {
  return [
    'w-full min-h-[35px] rounded-lg border border-line bg-field px-2.5 py-[7px] text-[13.5px] text-ink outline-none',
    'shadow-[inset_0_1px_2px_rgba(0,0,0,.04)] transition-[border-color,box-shadow] duration-150',
    'focus:border-line-strong focus:shadow-[0_0_0_3px_var(--bu-sel)] read-only:bg-pane-alt',
    'aria-[invalid=true]:border-danger',
    options.multiline ? 'min-h-[90px] resize-y leading-normal' : '',
    options.mono ? MONO_CLASS : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Свойства поля ввода, которые даёт `Field`: id для подписи, признак ошибки и пояснения. */
export interface FieldControl {
  id: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
  'aria-describedby'?: string;
}

export interface FieldProps {
  /** id поля ввода: подпись связана с ним; подсказка и ошибка — `<id>-hint`, `<id>-err`. */
  id: string;
  label: string;
  /** Обязательное поле: красная звёздочка у подписи. */
  required?: boolean;
  /** Подсказка под полем («Не короче 8 символов»). */
  hint?: string | undefined;
  /** Ошибка под полем: значок и текст красным, рамка поля красная. */
  error?: string | undefined;
  /** На всю ширину формы и на ПК. */
  full?: boolean;
  /** Поле ввода; функцией — чтобы получить id и aria-свойства (`FieldControl`). */
  children: ReactNode | ((control: FieldControl) => ReactNode);
}

/** Свойства поля ввода для `Field` (тот же расчёт, что внутри него). */
export function fieldControl(
  props: Pick<FieldProps, 'id' | 'required' | 'hint' | 'error'>,
): FieldControl {
  const described = [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-err` : '']
    .filter(Boolean)
    .join(' ');
  return {
    id: props.id,
    ...(props.error ? { 'aria-invalid': true as const } : {}),
    ...(props.required ? { 'aria-required': true as const } : {}),
    ...(described ? { 'aria-describedby': described } : {}),
  };
}

/** Поле формы (`.fld`): подпись, поле ввода, подсказка и ошибка. */
export function Field(props: FieldProps) {
  const { id, label, required, hint, error, full, children } = props;
  return (
    <div
      data-field=""
      data-full={full ? '' : undefined}
      className={`flex min-w-0 flex-col gap-[5px]${full ? ' col-span-full' : ''}`}
    >
      <label htmlFor={id} className="text-[12px] font-semibold tracking-[.01em] text-muted">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {' *'}
          </span>
        ) : null}
      </label>
      {typeof children === 'function' ? children(fieldControl(props)) : children}
      {hint ? (
        <div id={`${id}-hint`} data-hint="" className="text-[11.5px] leading-[1.4] text-faint">
          {hint}
        </div>
      ) : null}
      {error ? (
        <div id={`${id}-err`} className="flex items-start gap-[5px] text-[12px] text-danger">
          <Icon name="alert" size="sm" className="mt-px" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Раскладка формы (`.form`): две колонки, на телефоне до 600 px — компоновка «короткие поля по два в
 * строку» (`useFormPack`, ТЗ «Компоновка форм на телефоне»); до неё и без скриптов — одна колонка.
 * Пустой `<div />` между полями — пустая ячейка, как в прототипе; на телефоне она не показывается.
 */
export const FORM_GRID_CLASS = [
  'grid grid-cols-2 gap-x-3.5 gap-y-[13px] max-[600px]:grid-cols-1',
  'max-[600px]:data-packed:grid-cols-2 [&>[data-pack=full]]:col-span-2 [&>[data-pack=half]]:col-span-1',
  '[&>[data-pack=hidden]]:hidden [&>[data-pack=half]>label]:truncate',
].join(' ');

export function FormGrid({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFormPack(ref, 'form');
  return (
    <div ref={ref} className={`${FORM_GRID_CLASS} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Пары «подпись — значение» (`.kv`): по сетке не уже 220 px; на телефоне — по два, до 420 px — по
 * одному, а до 600 px компоновка ставит два подряд коротких значения в строку, длинное — на всю ширину.
 */
export const KV_CLASS = [
  'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-[18px] gap-y-3',
  'max-md:grid-cols-2 max-[420px]:grid-cols-1 max-[600px]:data-packed:grid-cols-2',
  '[&>[data-pack=full]]:col-span-2 [&>[data-pack=half]]:col-span-1',
].join(' ');

export interface KeyValueItem {
  id: string;
  label: string;
  value: ReactNode;
  /** Значение моноширинным (логин, код). */
  mono?: boolean;
}

export function KeyValues({ items }: { items: readonly KeyValueItem[] }) {
  const ref = useRef<HTMLDListElement>(null);
  useFormPack(ref, 'kv');
  return (
    <dl ref={ref} className={`m-0 ${KV_CLASS}`}>
      {items.map((item) => (
        <div key={item.id} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11.5px] font-semibold text-faint">{item.label}</dt>
          <dd
            data-kv-value=""
            className={`m-0 text-[13.5px] [overflow-wrap:anywhere]${item.mono ? ` ${MONO_CLASS}` : ''}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Блок карточки (`.box`): заголовок прописными буквами, справа от него — кнопки. */
export function Box({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5">
      <h3 className="m-0 flex items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
        <span className="grow">{title}</span>
        {actions}
      </h3>
      {children}
    </section>
  );
}

const NOTE_TONES = {
  info: 'border-line bg-pane-alt text-muted',
  warn: 'border-transparent bg-caution-bg text-caution',
  bad: 'border-transparent bg-danger-bg text-danger',
  ok: 'border-transparent bg-ok-bg text-ok',
} as const;

const NOTE_ICONS: Record<keyof typeof NOTE_TONES, IconName> = {
  info: 'info',
  warn: 'alert',
  bad: 'alert',
  ok: 'check',
};

/**
 * Заметка (`.note`, `.note.warn`, `.note.bad`, `.note.ok`): значок и текст. `alert` — важное сообщение,
 * которое экранный диктор читает сразу (ошибка формы).
 */
export function Note({
  tone = 'info',
  icon,
  alert = false,
  children,
}: {
  tone?: keyof typeof NOTE_TONES;
  icon?: IconName;
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className={`flex items-start gap-[9px] rounded-lg border px-3 py-[9px] text-[12.5px] leading-[1.45] ${NOTE_TONES[tone]}`}
    >
      <Icon name={icon ?? NOTE_ICONS[tone]} className="mt-px" />
      <div className="min-w-0 grow">{children}</div>
    </div>
  );
}

const PILL_TONES = {
  plain: 'bg-sel text-muted',
  ok: 'bg-ok-bg text-ok',
  bad: 'bg-danger-bg text-danger',
} as const;

/** Метка (`.pill`): «Привязан», «Основной». */
export function Pill({
  tone = 'plain',
  icon,
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-full py-px pr-[9px] pl-[7px] align-middle text-[12px] leading-5 font-semibold whitespace-nowrap ${PILL_TONES[tone]}`}
    >
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </span>
  );
}
