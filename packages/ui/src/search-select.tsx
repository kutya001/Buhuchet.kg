'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { FloatingPanel } from './floating';
import { inputClass, MONO_CLASS } from './form';
import { Icon } from './icon';

/** Строка списка: значение, подпись и «второе имя» для поиска цифрами (ИНН контрагента). */
export interface SearchSelectOption {
  value: string;
  label: string;
  /** Цифры справа от подписи (ИНН): по ним список тоже ищет. */
  hint?: string;
}

export interface SearchSelectLabels {
  /** Подсказка в строке поиска: «Название или ИНН». */
  placeholder: string;
  /** Название строки поиска и окошка для экранного диктора. */
  search: string;
  /** «Ничего не найдено». */
  nothing: string;
  /** «Показаны первые 200 из 340 — уточните поиск». */
  more: (shown: number, total: number) => string;
}

/** В окошке — не больше стольких строк; остальные находятся поиском (прототип `CPS_MAX`). */
export const SEARCH_SELECT_MAX = 200;

/** Как сравнивает поиск: без учёта регистра и «ё/е» (прототип `norm`). */
export const searchFold = (text: string) =>
  text.toLowerCase().replace(/ё/g, 'е').replace(/ /g, ' ');

/**
 * Подходит ли строка под запрос (прототип `cpsHit`): часть подписи либо цифры подряд из `hint`
 * (пробелы в цифрах не мешают). Пустой выбор при поиске не показывается. `query` — уже `searchFold`.
 */
export function searchSelectHit(option: SearchSelectOption, query: string): boolean {
  if (!query) return true;
  if (option.value === '') return false;
  const digits = query.replace(/\s/g, '');
  return (
    searchFold(option.label).includes(query) ||
    (/^\d+$/.test(digits) && (option.hint ?? '').includes(digits))
  );
}

/**
 * Строки окошка по запросу: первые `SEARCH_SELECT_MAX` подходящих, сколько их всего и какая строка
 * под курсором клавиатуры — при поиске первая, без него — выбранная (прототип `cpsOpen`, `rows`).
 */
export function searchSelectRows(
  options: readonly SearchSelectOption[],
  query: string,
  value: string,
): { shown: SearchSelectOption[]; total: number; active: number } {
  const q = searchFold(query.trim());
  const matched = options.filter((o) => searchSelectHit(o, q));
  const shown = matched.slice(0, SEARCH_SELECT_MAX);
  const active = q ? (shown.length ? 0 : -1) : shown.findIndex((o) => o.value === value);
  return { shown, total: matched.length, active };
}

/** Курсор клавиатуры после ↑ или ↓: не выходит за края списка. */
export function searchSelectMove(active: number, count: number, down: boolean): number {
  if (!count) return -1;
  return down ? Math.min(count - 1, active + 1) : Math.max(0, active - 1);
}

const HINT_CLASS = `flex-none text-[11.5px] font-normal text-faint ${MONO_CLASS}`;

/** Что написано на кнопке поля (`cpsFace`): подпись выбранного, его ИНН и стрелка. */
export function SearchSelectFace({
  text,
  hint,
  none,
}: {
  text: string;
  hint?: string;
  /** Ничего не выбрано — подпись пустого выбора бледным. */
  none?: boolean;
}) {
  return (
    <>
      <span className={`min-w-0 flex-1 truncate${none ? ' text-faint' : ''}`}>{text}</span>
      {hint ? <small className={`${HINT_CLASS} max-[480px]:hidden`}>{hint}</small> : null}
      <Icon name="down" size="sm" className="text-muted" />
    </>
  );
}

const rowTone = (on: boolean, active: boolean) =>
  on
    ? 'bg-sel font-semibold'
    : active
      ? 'bg-row-hover'
      : 'bg-transparent hover:bg-row-hover';

/** Строки окошка (`.cps-o`), «Ничего не найдено» или приписка «Показаны первые N из M». */
export function SearchSelectRows({
  listId,
  shown,
  total,
  value,
  active,
  labels,
  onPick,
}: {
  listId: string;
  shown: readonly SearchSelectOption[];
  total: number;
  value: string;
  active: number;
  labels: Pick<SearchSelectLabels, 'nothing' | 'more'>;
  onPick: (option: SearchSelectOption) => void;
}) {
  if (!shown.length) {
    return <div className="px-2 py-3 text-center text-[13px] text-faint">{labels.nothing}</div>;
  }
  return (
    <>
      {shown.map((o, i) => (
        <button
          key={o.value}
          id={`${listId}-${i}`}
          type="button"
          role="option"
          aria-selected={o.value === value}
          data-active={i === active ? '' : undefined}
          tabIndex={-1}
          onClick={() => onPick(o)}
          className={`flex w-full flex-none cursor-pointer items-baseline justify-between gap-2.5 rounded-[5px] border-0 px-2.5 py-[7px] text-left text-[13px] leading-[1.35] text-ink pointer-coarse:py-2.5 ${rowTone(o.value === value, i === active)}`}
        >
          <span className={`min-w-0 [overflow-wrap:anywhere]${o.value === '' ? ' text-faint' : ''}`}>
            {o.label}
          </span>
          {o.hint ? <small className={HINT_CLASS}>{o.hint}</small> : null}
        </button>
      ))}
      {total > shown.length ? (
        <div className="flex-none px-2.5 pt-1.5 pb-0.5 text-[11.5px] text-faint">
          {labels.more(shown.length, total)}
        </div>
      ) : null}
    </>
  );
}

function SearchPanel({
  listId,
  options,
  value,
  seed,
  labels,
  onPick,
  onLeave,
}: {
  listId: string;
  options: readonly SearchSelectOption[];
  value: string;
  seed: string;
  labels: SearchSelectLabels;
  onPick: (option: SearchSelectOption) => void;
  /** Tab: закрыть и вернуть фокус на поле. */
  onLeave: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(() => ({
    query: seed,
    active: searchSelectRows(options, seed, value).active,
  }));
  const rows = searchSelectRows(options, state.query, value);

  useLayoutEffect(() => {
    // Высота списка закрепляется: при вводе окошко не прыгает и не отрывается от поля.
    const el = list.current;
    if (el) el.style.height = `${el.offsetHeight}px`;
    if (seed) input.current?.setSelectionRange(seed.length, seed.length);
  }, [seed]);

  useEffect(() => {
    const el = list.current;
    (
      el?.querySelector<HTMLElement>('[data-active]') ??
      el?.querySelector<HTMLElement>('[aria-selected=true]')
    )?.scrollIntoView({ block: 'nearest' });
  }, [state]);

  const keydown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setState((s) => ({
        ...s,
        active: searchSelectMove(s.active, rows.shown.length, e.key === 'ArrowDown'),
      }));
    } else if (e.key === 'Enter') {
      // Enter выбирает строку, а не сохраняет форму под окошком.
      e.preventDefault();
      e.stopPropagation();
      const picked = rows.shown[state.active];
      if (picked) onPick(picked);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onLeave();
    }
  };

  return (
    <>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={state.active >= 0 ? `${listId}-${state.active}` : undefined}
        aria-label={labels.search}
        placeholder={labels.placeholder}
        autoComplete="off"
        spellCheck={false}
        data-search-select-input=""
        className={`${inputClass()} flex-none`}
        value={state.query}
        onChange={(e) => {
          const query = e.target.value;
          setState({ query, active: searchSelectRows(options, query, value).active });
          if (list.current) list.current.scrollTop = 0;
        }}
        onKeyDown={keydown}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        className="flex max-h-[min(300px,45dvh)] flex-col overflow-auto overscroll-contain"
      >
        <SearchSelectRows
          listId={listId}
          shown={rows.shown}
          total={rows.total}
          value={value}
          active={state.active}
          labels={labels}
          onPick={onPick}
        />
      </div>
    </>
  );
}

export interface SearchSelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'onChange' | 'type' | 'children'
> {
  value: string;
  options: readonly SearchSelectOption[];
  onChange: (value: string) => void;
  /** Подпись пустого выбора («— выберите контрагента —»); без неё пустой строки в списке нет. */
  empty?: string;
  labels: SearchSelectLabels;
}

/**
 * Список с поиском (прототип ui/cp-select.js, `cpSel` и `cpsOpen`; стили `.cps*`) — одно поле для всех
 * форм, где выбирают контрагента. Кнопка с подписью и ИНН выбранного; по нажатию — окошко со строкой
 * поиска и списком: ищет по части названия (без учёта регистра и «ё/е») и по цифрам ИНН подряд.
 * Клавиши: на поле буква или ↑ ↓ открывают список; в списке ↑ ↓ выбирают строку, Enter подтверждает,
 * Esc и Tab закрывают. Окошко рисуется в `document.body` (`FloatingPanel`): прокрутка окна формы его
 * не обрезает. Нажатие на подпись поля только ставит фокус на поле, как у обычного списка. Остальные
 * свойства (id и aria от `Field`, data-атрибуты формы) уходят кнопке.
 */
export function SearchSelect({
  value,
  options,
  onChange,
  empty,
  labels,
  className,
  ...rest
}: SearchSelectProps) {
  const listId = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState<{ seed: string } | null>(null);
  const pressed = useRef(false);
  const all = useMemo(
    () => (empty === undefined ? options : [{ value: '', label: empty }, ...options]),
    [options, empty],
  );
  const current = options.find((o) => o.value === value);
  const close = useCallback(() => setOpen(null), []);

  const pick = (option: SearchSelectOption) => {
    setOpen(null);
    if (option.value !== value) onChange(option.value);
    anchor?.focus({ preventScroll: true });
  };

  return (
    <>
      <button
        {...rest}
        ref={setAnchor}
        type="button"
        data-search-select=""
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        className={`${inputClass()} flex cursor-pointer items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:border-line-strong aria-expanded:shadow-[0_0_0_3px_var(--bu-sel)]${className ? ` ${className}` : ''}`}
        onPointerDown={() => {
          pressed.current = true;
        }}
        onClick={(e) => {
          // Нажатие на подпись поля приходит кнопке как клик мышью без нажатия на неё саму.
          const direct = pressed.current || e.detail === 0;
          pressed.current = false;
          if (direct) setOpen((o) => (o ? null : { seed: '' }));
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen((o) => o ?? { seed: '' });
          } else if (e.key.length === 1 && e.key !== ' ') {
            e.preventDefault();
            setOpen({ seed: e.key });
          }
        }}
      >
        <SearchSelectFace
          text={current?.label ?? empty ?? ''}
          hint={current?.hint}
          none={!current}
        />
      </button>
      {open && anchor ? (
        <FloatingPanel anchor={anchor} label={labels.search} size="select" onClose={close}>
          <SearchPanel
            key={open.seed}
            listId={listId}
            options={all}
            value={current ? value : ''}
            seed={open.seed}
            labels={labels}
            onPick={pick}
            onLeave={() => {
              setOpen(null);
              anchor.focus({ preventScroll: true });
            }}
          />
        </FloatingPanel>
      ) : null}
    </>
  );
}
