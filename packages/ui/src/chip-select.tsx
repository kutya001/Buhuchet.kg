'use client';

import { CHECKBOX_CLASS } from './check-row';
import { Icon } from './icon';
import type { IconName } from './icons';

/** Вариант выбора кнопками-плашками: значение, подпись и значок. */
export interface ChipOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Плашка выбора: выбранная — цвета акцента. */
const chipClass = (on: boolean) =>
  `inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'border-transparent bg-accent text-on-accent shadow-cta' : 'border-line bg-raised text-muted'}`;

/**
 * Выбор одного варианта плашками (прототип css/controls.css `.chipsel`): круглые кнопки в строку с
 * переносом, выбранная — цвета акцента. Вид реквизита («Расчётный счёт» / «Перевод по номеру
 * телефона»). `id` — для подписи поля (`Field`).
 */
export function ChipSelect<T extends string>({
  id,
  options,
  value,
  onChange,
  label,
}: {
  id?: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Название группы кнопок для экранного диктора. */
  label: string;
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      data-chip-select=""
      className="flex flex-wrap gap-1.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={chipClass(on)}
          >
            {o.icon ? <Icon name={o.icon} size="sm" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Плашка выбора нескольких: значение, краткая подпись и полное название в подсказке. */
export interface ChipMultiOption {
  value: string;
  label: string;
  title?: string;
}

/**
 * Выбор нескольких вариантов плашками (прототип `.chipsel`, у которого отмечено несколько): виды
 * отчётов основания. Нажатие отмечает или снимает плашку; выбранные — по порядку вариантов.
 */
export function ChipMultiSelect({
  id,
  options,
  value,
  onChange,
  label,
  describedBy,
}: {
  id?: string;
  options: readonly ChipMultiOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Название группы кнопок для экранного диктора. */
  label: string;
  describedBy?: string;
}) {
  const toggle = (code: string) => {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      data-chip-multi=""
      className="flex flex-wrap gap-1.5"
    >
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => toggle(o.value)}
            className={chipClass(on)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Строка списка галочек: значение и подпись. */
export interface CheckListOption {
  value: string;
  label: string;
}

/**
 * Список с галочками в рамке с прокруткой (прототип css/popups.css `.fl-list`): банки и кошельки, к
 * которым привязан номер телефона. Отмеченные — по порядку списка.
 */
export function CheckList({
  id,
  options,
  value,
  onChange,
  label,
  invalid = false,
  describedBy,
}: {
  id?: string;
  options: readonly CheckListOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Название списка для экранного диктора. */
  label: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const toggle = (code: string, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(code);
    else next.delete(code);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      data-check-list=""
      className={`flex max-h-[190px] flex-col overflow-auto rounded-lg border p-1 ${invalid ? 'border-danger' : 'border-line'}`}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px] hover:bg-row-hover"
        >
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            value={o.value}
            checked={value.includes(o.value)}
            onChange={(e) => toggle(o.value, e.target.checked)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
