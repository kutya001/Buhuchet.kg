'use client';

import { filterTypeOf, searchText, type ListFilterValue } from '@buhuchet/domain';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { buttonClass, linkButtonClass } from '../button';
import { inputClass } from '../form';
import { Icon } from '../icon';
import { enumFilter, formatFilterNumber, parseFilterNumber } from './grid-filters';
import type { GridColumn, GridLabels, GridValues } from './types';

/** Значений больше стольких — над списком галочек поле «Найти значение» (прототип: `keys.length > 8`). */
const FIND_FROM = 8;

/** Подписи значений, загруженных для галочек: по ним чип показывает «Бухгалтер», а не код роли. */
export type ValueLabels = Readonly<Record<string, string | null>>;

const HINT = 'text-[11.5px] leading-[1.4] text-faint';

/**
 * Меню столбца (прототип ui/grid.js, filterPop; ТЗ «Фильтр у каждого столбца по его типу»): текст —
 * «Содержит…»; число — «От» и «До» включительно; дата — «С даты» и «По дату»; справочник и статус —
 * галочки значений с числом записей по всему списку, «Выбрать все», «(Пусто)» и «Найти значение»,
 * если значений больше восьми. Внизу — «Группировать по этому столбцу» (или «Убрать группировку…»),
 * «Очистить» и «Применить»; Enter — «Применить».
 */
export function FilterPanel<Row>({
  column,
  filter,
  grouped,
  loadValues,
  onApply,
  onToggleGroup,
  labels,
}: {
  column: GridColumn<Row>;
  filter: ListFilterValue | undefined;
  /** Список уже сгруппирован по этому столбцу. */
  grouped: boolean;
  /** Значения столбца для галочек с сервера. */
  loadValues?: (key: string) => Promise<GridValues>;
  /** Новый фильтр (null — убрать) и подписи значений галочек для чипа. */
  onApply: (filter: ListFilterValue | null, valueLabels?: ValueLabels) => void;
  onToggleGroup: () => void;
  labels: GridLabels;
}) {
  const type = filterTypeOf(column.type);
  const id = useId();
  const [q, setQ] = useState(filter?.type === 'text' ? filter.q : '');
  const [from, setFrom] = useState(() => initialBound(column, filter, 'from'));
  const [to, setTo] = useState(() => initialBound(column, filter, 'to'));
  const [bad, setBad] = useState(false);
  const [values, setValues] = useState<GridValues | 'loading' | 'error'>('loading');
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [find, setFind] = useState('');

  useEffect(() => {
    if (type !== 'enum' || !loadValues) return;
    let live = true;
    loadValues(column.key).then(
      (v) => {
        if (!live) return;
        setValues(v);
        const all = v.items.map((i) => i.value);
        setChecked(new Set(filter?.type === 'enum' ? filter.vals : all));
      },
      () => live && setValues('error'),
    );
    return () => {
      live = false;
    };
    // Значения грузятся один раз при открытии меню.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    if (type === 'text') {
      const text = q.trim();
      onApply(text ? { type: 'text', q: text } : null);
      return;
    }
    if (type === 'num') {
      const a = parseFilterNumber(column.type, from);
      const b = parseFilterNumber(column.type, to);
      if (a === 'bad' || b === 'bad') {
        setBad(true);
        return;
      }
      onApply(a === null && b === null ? null : { type: 'num', from: a, to: b });
      return;
    }
    if (type === 'date') {
      onApply(from || to ? { type: 'date', from: from || null, to: to || null } : null);
      return;
    }
    if (typeof values !== 'object' || !checked) return;
    const all = values.items.map((i) => i.value);
    const names = Object.fromEntries(values.items.map((i) => [i.value, i.label]));
    onApply(enumFilter(all, checked), names);
  };

  const enter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    apply();
  };

  return (
    <div className="flex flex-col gap-2.5" onKeyDown={enter} data-filter-panel={column.key}>
      <h4 className="m-0 text-[12px] font-[650] tracking-[0.07em] text-faint uppercase">
        {column.label}
      </h4>
      {type === 'text' && (
        <input
          className={inputClass()}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={labels.filterContains}
          aria-label={labels.filterContains}
          maxLength={200}
        />
      )}
      {type === 'num' && (
        <>
          <div className="flex gap-2">
            {(
              [
                [from, setFrom, labels.filterFrom],
                [to, setTo, labels.filterTo],
              ] as const
            ).map(([value, set, label]) => (
              <input
                key={label}
                className={inputClass()}
                value={value}
                onChange={(e) => {
                  set(e.target.value);
                  setBad(false);
                }}
                placeholder={label}
                aria-label={label}
                aria-invalid={bad}
                aria-describedby={`${id}-hint`}
                inputMode="decimal"
              />
            ))}
          </div>
          <div id={`${id}-hint`} className={bad ? 'text-[11.5px] text-danger-label' : HINT}>
            {bad ? labels.filterBadNumber : labels.filterBounds}
          </div>
        </>
      )}
      {type === 'date' && (
        <>
          {(
            [
              [from, setFrom, labels.filterSince, 'from'],
              [to, setTo, labels.filterUntil, 'to'],
            ] as const
          ).map(([value, set, label, part]) => (
            <div key={part} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${part}`} className="text-[12.5px] font-[550] text-muted">
                {label}
              </label>
              <input
                id={`${id}-${part}`}
                type="date"
                className={inputClass()}
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            </div>
          ))}
        </>
      )}
      {type === 'enum' && (
        <EnumValues
          values={loadValues ? values : 'error'}
          checked={checked}
          onChecked={setChecked}
          find={find}
          onFind={setFind}
          labels={labels}
        />
      )}
      <button
        type="button"
        onClick={onToggleGroup}
        className={`${linkButtonClass()} mt-0.5 inline-flex items-center gap-1.5 self-start text-[12.5px]`}
      >
        <Icon name="layers" size="sm" />
        {grouped ? labels.ungroupColumn : labels.groupByColumn}
      </button>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => onApply(null)} className={buttonClass('ghost', 'sm')}>
          {labels.clear}
        </button>
        <button type="button" onClick={apply} className={buttonClass('cta', 'sm')}>
          {labels.apply}
        </button>
      </div>
    </div>
  );
}

function initialBound<Row>(
  column: GridColumn<Row>,
  filter: ListFilterValue | undefined,
  part: 'from' | 'to',
): string {
  if (filter?.type === 'num') {
    const v = filter[part];
    return v == null ? '' : formatFilterNumber(column.type, v);
  }
  if (filter?.type === 'date') return filter[part] ?? '';
  return '';
}

/** Галочки значений (`.fl-list` прототипа): «Выбрать все» отмечает видимые после поиска значения. */
function EnumValues({
  values,
  checked,
  onChecked,
  find,
  onFind,
  labels,
}: {
  values: GridValues | 'loading' | 'error';
  checked: Set<string> | null;
  onChecked: (checked: Set<string>) => void;
  find: string;
  onFind: (find: string) => void;
  labels: GridLabels;
}) {
  if (values === 'loading') return <div className={HINT}>{labels.filterLoading}</div>;
  if (values === 'error' || !checked) {
    return <div className="text-[12.5px] text-danger-label">{labels.filterLoadError}</div>;
  }
  const needle = searchText(find.trim());
  const shown = values.items.filter(
    (i) => !needle || searchText(i.label ?? labels.empty).includes(needle),
  );
  const allOn = shown.length > 0 && shown.every((i) => checked.has(i.value));
  const toggle = (vals: readonly string[], on: boolean) => {
    const next = new Set(checked);
    for (const v of vals) {
      if (on) next.add(v);
      else next.delete(v);
    }
    onChecked(next);
  };
  const row =
    'flex cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px] hover:bg-row-hover';
  const box = 'm-0 h-4 w-4 flex-none cursor-pointer accent-accent';
  return (
    <>
      {values.items.length > FIND_FROM && (
        <input
          className={inputClass()}
          value={find}
          onChange={(e) => onFind(e.target.value)}
          placeholder={labels.filterFind}
          aria-label={labels.filterFind}
        />
      )}
      <div
        className="flex max-h-[230px] flex-col overflow-auto rounded-lg border border-line p-1"
        data-filter-values
      >
        <label className={row}>
          <input
            type="checkbox"
            className={box}
            checked={allOn}
            onChange={(e) =>
              toggle(
                shown.map((i) => i.value),
                e.target.checked,
              )
            }
          />
          <b>{labels.filterAll}</b>
        </label>
        {shown.map((i) => (
          <label key={i.value} className={row}>
            <input
              type="checkbox"
              className={box}
              checked={checked.has(i.value)}
              onChange={(e) => toggle([i.value], e.target.checked)}
            />
            {i.label === null ? (
              <i className="text-muted">{labels.empty}</i>
            ) : (
              <span className="min-w-0 truncate">{i.label}</span>
            )}
            <span className="ml-auto text-[11px] text-muted tabular-nums">{i.count}</span>
          </label>
        ))}
      </div>
      {values.more && <div className={HINT}>{labels.filterMore(values.items.length)}</div>}
    </>
  );
}
