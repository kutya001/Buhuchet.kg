'use client';

import {
  addEnumStep,
  enumChecked,
  enumMatchChecked,
  filterTypeOf,
  matchesValue,
  type EnumLabelOf,
  type EnumSelection,
  type EnumStep,
  type ListFilterValue,
} from '@buhuchet/domain';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { buttonClass, linkButtonClass } from '../button';
import { inputClass } from '../form';
import { Icon } from '../icon';
import {
  enumFilterFits,
  enumFilterOf,
  enumSelectionOf,
  formatFilterNumber,
  parseFilterNumber,
} from './grid-filters';
import type { GridColumn, GridLabels, GridValues } from './types';

/** Значений больше стольких — над списком галочек поле «Найти значение» (прототип: `keys.length > 8`). */
const FIND_FROM = 8;

/** Пауза после ввода в «Найти значение», прежде чем искать значения на сервере, — мс. */
const FIND_DELAY = 250;

/** Подписи значений, загруженных для галочек: по ним чип показывает «Бухгалтер», а не код роли. */
export type ValueLabels = Readonly<Record<string, string | null>>;

const labelsOf = (values: GridValues): ValueLabels =>
  Object.fromEntries(values.items.map((i) => [i.value, i.label]));

const HINT = 'text-[11.5px] leading-[1.4] text-faint';

/**
 * Меню столбца (прототип ui/grid.js, filterPop; ТЗ «Фильтр у каждого столбца по его типу»): текст —
 * «Содержит…»; число — «От» и «До» включительно; дата — «С даты» и «По дату»; справочник и статус —
 * галочки значений с числом записей по всему списку, «Выбрать все», «(Пусто)» и «Найти значение»,
 * если значений больше восьми. Значений больше 500 — приходят первые 500, а «Найти значение» ищет на
 * сервере по всем; «Выбрать все» отмечает все подходящие, в том числе не показанные (шаг выбора
 * `addEnumStep`). Внизу — «Группировать по этому столбцу» (или «Убрать группировку…»), «Очистить» и
 * «Применить»; Enter — «Применить».
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
  /** Значения столбца для галочек с сервера; `q` — «Найти значение» по всем значениям. */
  loadValues?: (key: string, q?: string) => Promise<GridValues>;
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
  const [selection, setSelection] = useState<EnumSelection>(() => enumSelectionOf(filter));
  // Подписи всех значений, которые приходили с сервера: для шагов выбора и чипа.
  const [names, setNames] = useState<ValueLabels>({});
  const [find, setFind] = useState('');
  const [found, setFound] = useState<{ q: string; values: GridValues | 'error' } | null>(null);
  const [tooMany, setTooMany] = useState(false);

  useEffect(() => {
    if (type !== 'enum' || !loadValues) return;
    let live = true;
    loadValues(column.key).then(
      (v) => {
        if (!live) return;
        setValues(v);
        setNames((prev) => ({ ...prev, ...labelsOf(v) }));
      },
      () => live && setValues('error'),
    );
    return () => {
      live = false;
    };
    // Значения грузятся один раз при открытии меню.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Пришли не все значения — «Найти значение» ищет на сервере по всем (ТЗ «Поиск и фильтры»).
  const partial = typeof values === 'object' && values.more;
  const needle = find.trim();
  useEffect(() => {
    if (!partial || !needle || !loadValues) return;
    let live = true;
    const timer = setTimeout(() => {
      loadValues(column.key, needle).then(
        (v) => {
          if (!live) return;
          setFound({ q: needle, values: v });
          setNames((prev) => ({ ...prev, ...labelsOf(v) }));
        },
        () => live && setFound({ q: needle, values: 'error' }),
      );
    }, FIND_DELAY);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [partial, needle, loadValues, column.key]);

  const labelOf: EnumLabelOf = (v) => (Object.hasOwn(names, v) ? names[v] : undefined);
  const step = (next: EnumStep) => {
    setTooMany(false);
    setSelection((prev) => addEnumStep(prev, next, labelOf));
  };

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
    if (typeof values !== 'object') return;
    const next = enumFilterOf(selection, values.more ? null : values.items);
    if (!enumFilterFits(next)) {
      setTooMany(true);
      return;
    }
    onApply(next, names);
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
          found={found}
          selection={selection}
          labelOf={labelOf}
          onStep={step}
          find={find}
          onFind={setFind}
          tooMany={tooMany}
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

/**
 * Галочки значений (`.fl-list` прототипа). Пришли все значения — «Найти значение» ищет среди них;
 * пришли не все — ищет сервер (`found`). Пока ответ на новый поиск не пришёл, виден прежний список
 * (окно не прыгает), но отмечать в нём нельзя.
 */
function EnumValues({
  values,
  found,
  selection,
  labelOf,
  onStep,
  find,
  onFind,
  tooMany,
  labels,
}: {
  values: GridValues | 'loading' | 'error';
  found: { q: string; values: GridValues | 'error' } | null;
  selection: EnumSelection;
  labelOf: EnumLabelOf;
  onStep: (step: EnumStep) => void;
  find: string;
  onFind: (find: string) => void;
  tooMany: boolean;
  labels: GridLabels;
}) {
  if (values === 'loading') return <div className={HINT}>{labels.filterLoading}</div>;
  if (values === 'error') {
    return <div className="text-[12.5px] text-danger-label">{labels.filterLoadError}</div>;
  }
  const needle = find.trim();
  let shown: GridValues | 'error' = values;
  let busy = false;
  if (!values.more) {
    shown = { ...values, items: values.items.filter((i) => matchesValue(i.label, needle)) };
  } else if (needle && found?.q === needle) {
    shown = found.values;
  } else if (needle) {
    busy = true;
    if (found && found.values !== 'error') shown = found.values;
  }
  return (
    <>
      {(values.items.length > FIND_FROM || values.more) && (
        <input
          className={inputClass()}
          value={find}
          onChange={(e) => onFind(e.target.value)}
          placeholder={labels.filterFind}
          aria-label={labels.filterFind}
          maxLength={200}
        />
      )}
      {shown === 'error' ? (
        <div className="text-[12.5px] text-danger-label">{labels.filterLoadError}</div>
      ) : (
        <EnumList
          shown={shown}
          needle={needle}
          busy={busy}
          selection={selection}
          labelOf={labelOf}
          onStep={onStep}
          labels={labels}
        />
      )}
      {tooMany && <div className="text-[12.5px] text-danger-label">{labels.filterTooMany}</div>}
    </>
  );
}

const ROW =
  'flex cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px] hover:bg-row-hover';
const BOX = 'm-0 h-4 w-4 flex-none cursor-pointer accent-accent';

/**
 * Список галочек с «Выбрать все» и подсказкой, если показаны не все подходящие значения. «Выбрать
 * все» — шаг по «Найти значение» (без поиска — все значения), поэтому отмечает и не показанные;
 * отмечена, если отмечены все подходящие (`enumMatchChecked`), а не только показанные.
 */
function EnumList({
  shown,
  needle,
  busy,
  selection,
  labelOf,
  onStep,
  labels,
}: {
  shown: GridValues;
  needle: string;
  /** Идёт поиск на сервере: список прежний, отмечать нельзя. */
  busy: boolean;
  selection: EnumSelection;
  labelOf: EnumLabelOf;
  onStep: (step: EnumStep) => void;
  labels: GridLabels;
}) {
  const isOn = (i: GridValues['items'][number]) => enumChecked(selection, i.value, i.label);
  const allOn =
    !busy &&
    shown.items.length > 0 &&
    shown.items.every(isOn) &&
    (!shown.more || enumMatchChecked(selection, needle, labelOf));
  return (
    <>
      <div
        className={`flex max-h-[230px] flex-col overflow-auto rounded-lg border border-line p-1 ${busy ? 'opacity-60' : ''}`}
        aria-busy={busy}
        data-filter-values
      >
        <label className={ROW}>
          <input
            type="checkbox"
            className={BOX}
            checked={allOn}
            disabled={busy}
            onChange={(e) => onStep({ on: e.target.checked, match: needle })}
          />
          <b>{labels.filterAll}</b>
        </label>
        {shown.items.map((i) => (
          <label key={i.value} className={ROW}>
            <input
              type="checkbox"
              className={BOX}
              checked={isOn(i)}
              disabled={busy}
              onChange={(e) => onStep({ on: e.target.checked, vals: [i.value] })}
            />
            {i.label === null ? (
              <i className="text-faint">{labels.empty}</i>
            ) : (
              <span className="min-w-0 truncate">{i.label}</span>
            )}
            <span className="ml-auto text-[11px] text-faint tabular-nums">{i.count}</span>
          </label>
        ))}
      </div>
      {busy ? (
        <div className={HINT}>{labels.filterLoading}</div>
      ) : (
        shown.more && (
          <div className={HINT} data-filter-more>
            {labels.filterMore(shown.items.length, shown.total)}
          </div>
        )
      )}
    </>
  );
}
