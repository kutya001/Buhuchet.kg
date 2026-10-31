'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icons';
import { useFormPack } from './use-form-pack';

/**
 * Поля и блоки форм как в прототипе (spec/prototype/src/css/controls.css `.inp`, `.fld`, `.form`;
 * cards.css `.box`, `.kv`, `.note`; ui/popups.js `fld`, `setErr`). Тексты — пропсами из словаря.
 */

/** Кнопка внутри поля выбора файла (`::file-selector-button`). */
const FILE_BUTTON_CLASS =
  'file:mr-1.5 file:cursor-pointer file:rounded-[4px] file:border file:border-line-strong file:bg-pane file:px-1.5 file:text-ink';

/** Моноширинный текст (`.mono`): логин, код, номер счёта. */
export const MONO_CLASS = 'font-mono text-[.92em] [font-feature-settings:"calt"_1,"zero"_1]';

/**
 * Поле ввода (`.inp`): рамка, при фокусе — тёмная рамка и кольцо, с ошибкой (`aria-invalid`) —
 * красная рамка, только для чтения — фон панели. Подходит для input, select и textarea. `full: false` —
 * без ширины на всю строку (ширину задаёт свой класс). Фон панели — только у поля с атрибутом `readonly`
 * (`.inp[readonly]`): псевдокласс `:read-only` браузер ставит и списку, и выбору файла. `file` — выбор
 * файла с кнопкой в рамке, как в прототипе.
 */
export function inputClass(
  options: { mono?: boolean; multiline?: boolean; full?: boolean; file?: boolean } = {},
): string {
  return [
    options.full === false ? '' : 'w-full',
    'min-h-[35px] rounded-lg border border-line bg-field px-2.5 py-[7px] text-[13.5px] text-ink outline-none',
    'shadow-[inset_0_1px_2px_rgba(0,0,0,.04)] transition-[border-color,box-shadow] duration-150',
    'focus:border-line-strong focus:shadow-[0_0_0_3px_var(--bu-sel)] [&[readonly]]:bg-pane-alt',
    options.file ? FILE_BUTTON_CLASS : '',
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
  /** Ошибка под полем: значок и текст красным, рамка поля красная; можно с кнопкой («Вернуть из архива»). */
  error?: ReactNode;
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

/**
 * Отметки у поля (прототип rdMarks формы «Из свидетельства и выписки»: `.src-l`, `.alt-l`, `.need-l`,
 * `.fld.need`): строки под полем ввода перед подсказкой и оранжевая рамка у незаполненного
 * обязательного поля (у поля с ошибкой рамка остаётся красной).
 */
export interface FieldMark {
  node?: ReactNode;
  need?: boolean;
}

/**
 * Отметки полей формы по id поля: форма даёт их всем своим полям сразу, не протягивая через
 * составные поля (ГКЭД, телефон, списки).
 */
export const FieldMarks = createContext<((id: string) => FieldMark | null | undefined) | null>(
  null,
);

/**
 * Оранжевая рамка поля ввода у незаполненного обязательного поля (`.fld.need .inp`, `.gk-main`).
 * Классы целиком — их находит сборка стилей.
 */
const NEED_CLASS = [
  '[&_input]:shadow-[0_0_0_1.5px_var(--bu-orange-bg),inset_0_0_0_1px_var(--bu-orange)]',
  '[&_select]:shadow-[0_0_0_1.5px_var(--bu-orange-bg),inset_0_0_0_1px_var(--bu-orange)]',
  '[&_textarea]:shadow-[0_0_0_1.5px_var(--bu-orange-bg),inset_0_0_0_1px_var(--bu-orange)]',
  '[&_[data-gked-main]]:shadow-[0_0_0_1.5px_var(--bu-orange-bg),inset_0_0_0_1px_var(--bu-orange)]',
].join(' ');

/** Поле формы (`.fld`): подпись, поле ввода, отметки формы, подсказка и ошибка. */
export function Field(props: FieldProps) {
  const { id, label, required, hint, error, full, children } = props;
  const mark = useContext(FieldMarks)?.(id);
  const need = !!mark?.need && !error;
  return (
    <div
      data-field=""
      data-full={full ? '' : undefined}
      data-need={need ? '' : undefined}
      className={`flex min-w-0 flex-col gap-[5px]${full ? ' col-span-full' : ''}${need ? ` ${NEED_CLASS}` : ''}`}
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
      {mark?.node}
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
  /** Во всю ширину, через оба столбца (`.pk-wide`: «Что даёт» и «Условия» в описании льготы). */
  wide?: boolean;
  /** Через два столбца сетки, до 420 px — в один (`.sf-kv`: «Тариф Соцфонда» в карточке контрагента). */
  span2?: boolean;
}

/** Ровно два столбца, на телефоне — один (`.pk-kv`: описание вида в «Подборе отчётов» и «Выборе налогов»). */
const KV_TWO_CLASS = 'grid grid-cols-2 gap-x-[18px] gap-y-3 max-md:grid-cols-1';

export function KeyValues({
  items,
  columns = 'auto',
}: {
  items: readonly KeyValueItem[];
  columns?: 'auto' | 2;
}) {
  const ref = useRef<HTMLDListElement>(null);
  useFormPack(ref, 'kv');
  return (
    <dl ref={ref} className={`m-0 ${columns === 2 ? KV_TWO_CLASS : KV_CLASS}`}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`flex min-w-0 flex-col gap-0.5${item.wide ? ' col-span-full' : item.span2 ? ' col-span-2 max-[420px]:col-span-1' : ''}`}
        >
          <dt className="text-[11.5px] font-semibold text-faint">{item.label}</dt>
          <dd
            data-kv-value=""
            className={`m-0 text-[13.5px] [overflow-wrap:anywhere] [&_[data-pill]]:max-w-full [&_[data-pill]]:whitespace-normal${item.mono ? ` ${MONO_CLASS}` : ''}`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Блок карточки (`.box`): заголовок прописными буквами (с пометкой — `title` разметкой), справа от него
 * — кнопки; без заголовка — только рамка.
 */
export function Box({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-box
      className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-raised px-4 py-3.5"
    >
      {title ? (
        <h3 className="m-0 flex items-center gap-2 text-[11.5px] font-bold tracking-[.08em] text-faint uppercase">
          <span className="grow">{title}</span>
          {actions}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

const NOTE_TONES = {
  info: 'border-line bg-pane-alt text-muted',
  warn: 'border-transparent bg-caution-bg text-caution-label',
  bad: 'border-transparent bg-danger-bg text-danger-label',
  ok: 'border-transparent bg-ok-bg text-ok',
  beta: 'border-transparent bg-warn-bg text-warn',
} as const;

const NOTE_ICONS: Record<keyof typeof NOTE_TONES, IconName> = {
  info: 'info',
  warn: 'alert',
  bad: 'alert',
  ok: 'check',
  beta: 'alert',
};

/**
 * Заметка (`.note`, `.note.warn`, `.note.bad`, `.note.ok`, `.note.beta` — жёлтая «Бета-версия»): значок и
 * текст. `alert` — важное сообщение, которое экранный диктор читает сразу (ошибка формы). `center` —
 * значок по центру строки, как у заметки с кнопкой (`.fe-note`).
 */
export function Note({
  tone = 'info',
  icon,
  alert = false,
  center = false,
  children,
}: {
  tone?: keyof typeof NOTE_TONES;
  icon?: IconName;
  alert?: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className={`flex ${center ? 'items-center' : 'items-start'} gap-[9px] rounded-lg border px-3 py-[9px] text-[12.5px] leading-[1.45] ${NOTE_TONES[tone]}`}
    >
      <Icon name={icon ?? NOTE_ICONS[tone]} className={center ? undefined : 'mt-px'} />
      <div className="min-w-0 grow">{children}</div>
    </div>
  );
}

const PILL_TONES = {
  plain: 'bg-label-bg text-label',
  ok: 'bg-ok-bg text-ok',
  bad: 'bg-danger-bg text-danger-label',
  caution: 'bg-caution-bg text-caution-label',
  warn: 'bg-warn-bg text-warn-label',
  violet: 'bg-violet-bg text-violet',
  info: 'bg-info-bg text-info-label',
} as const;

const PILL_SIZES = {
  md: 'py-px pr-[9px] pl-[7px] text-[12px] leading-5',
  sm: 'py-0 pr-[7px] pl-[6px] text-[11px] leading-[17px]',
} as const;

/** Форма и размер метки (`.pill`, `.pill.sm`) — общие у `Pill` и метки статуса. */
export function pillClass(size: keyof typeof PILL_SIZES = 'md'): string {
  return `inline-flex items-center gap-[5px] rounded-full align-middle font-semibold whitespace-nowrap ${PILL_SIZES[size]}`;
}

/**
 * Метка (`.pill`): «Привязан», «Основной»; `caution` — оранжевая (`.pill.orange`, «не привязан»),
 * `warn` — жёлтая (`.pill.yellow`, «сверить»), `violet` — фиолетовая (`.pill.purple`, «ждёт» у задачи);
 * `info` — синяя (`.pill.blue`, «по УГНС», «Возобновление запланировано»);
 * `sm` — маленькая (`.pill.sm`). В компактном списке метка ниже (`data-pill`).
 */
export function Pill({
  tone = 'plain',
  size = 'md',
  icon,
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  size?: keyof typeof PILL_SIZES;
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span data-pill className={`${pillClass(size)} ${PILL_TONES[tone]}`}>
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </span>
  );
}

const TAG_TONES = {
  plain: 'bg-label-bg text-label',
  info: 'bg-info-bg text-info',
  violet: 'bg-violet-bg text-violet',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-danger-bg text-danger',
} as const;

/**
 * Ярлык (`.tag`): «все права», «Свои контрагенты» в карточке роли; `title` — подсказка. `info` и
 * `violet` — метки вида срока задачи «День» и «Месяц» (`.tag.kd-day`, `.tag.kd-month`); `warn` и `bad`
 * — «изменена» и «удалена» в журналах операций (`.tag.yellow`, `.tag.red`).
 */
export function Tag({
  icon,
  title,
  wide = false,
  tone = 'plain',
  children,
}: {
  icon?: IconName;
  title?: string;
  /** Не уже 58 px, текст по центру — метки «Этап N» столбиком (Админка → «Статусы»). */
  wide?: boolean;
  tone?: keyof typeof TAG_TONES;
  children: ReactNode;
}) {
  return (
    <span
      data-tag=""
      title={title}
      className={`inline-flex flex-none items-center gap-1 rounded px-1.5 align-[1px] text-[10.5px] leading-[17px] font-[650] tracking-[.03em] whitespace-nowrap ${TAG_TONES[tone]}${wide ? ' min-w-[58px] justify-center' : ''}`}
    >
      {icon ? <Icon name={icon} size="sm" /> : null}
      {children}
    </span>
  );
}
