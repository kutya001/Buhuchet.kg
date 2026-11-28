'use client';

import {
  addDays,
  defaultSeriesRule,
  lastDayOf,
  pluralForm,
  SERIES_COUNT_DEFAULT,
  SERIES_COUNT_MAX,
  SERIES_EVERY_MAX,
  SERIES_MONTH_TERM_UNITS,
  SERIES_UNITS,
  SERIES_WEEKDAY_LETTERS,
  SERIES_WEEKDAY_NAMES,
  seriesDayMonthText,
  seriesMonthModes,
  seriesMonthText,
  seriesRuleProblems,
  seriesRuleText,
  seriesUnitLabel,
  weekdayMondayFirst,
  type IsoDate,
  type SeriesEndKind,
  type SeriesMonthMode,
  type SeriesUnit,
  type TaskTerm,
} from '@buhuchet/domain';
import type { SeriesRuleBody, SeriesScope } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  Field,
  FormGrid,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
} from '@buhuchet/ui';
import { useId, useState } from 'react';
import { useT } from '../l10n/provider';

/** Поле окна «Повтор», у которого может быть ошибка. */
type RuleField = 'every' | 'weekDays' | 'monthMode' | 'start' | 'end';
type Errors = Partial<Record<RuleField, string>>;

interface Draft {
  every: string;
  unit: SeriesUnit;
  weekDays: number[];
  monthMode: SeriesMonthMode;
  endKind: SeriesEndKind;
  endDate: string;
  endCount: string;
  start: string;
}

const draftOf = (rule: SeriesRuleBody | null, start: IsoDate, term: TaskTerm): Draft => {
  const r = rule ?? defaultSeriesRule(start, term);
  return {
    every: String(r.every),
    unit: r.unit,
    weekDays: [...(r.weekDays ?? [])],
    monthMode: r.monthMode ?? 'date',
    endKind: r.end.kind,
    endDate: r.end.date ?? addDays(start, 90),
    endCount: String(r.end.count ?? SERIES_COUNT_DEFAULT),
    start,
  };
};

/** Правило из полей окна: дни — только у «недели», «Когда» — только у «месяца» задачи «На день». */
export function draftRule(d: Draft, term: TaskTerm, start: IsoDate): SeriesRuleBody {
  const every = Number(d.every);
  const week = d.unit === 'week';
  const monthly = d.unit === 'month' && term !== 'month';
  const days = d.weekDays.length ? d.weekDays : [weekdayMondayFirst(start)];
  return {
    every: Number.isFinite(every) ? every : 0,
    unit: d.unit,
    ...(week ? { weekDays: [...days].sort((a, b) => a - b) } : {}),
    ...(monthly ? { monthMode: d.monthMode } : {}),
    end:
      d.endKind === 'date'
        ? { kind: 'date', date: d.endDate || null }
        : d.endKind === 'count'
          ? { kind: 'count', count: Number(d.endCount) }
          : { kind: 'never' },
  };
}

/** Начало из поля: у задачи «На месяц» — последний день выбранного месяца. */
const startOf = (value: string, term: TaskTerm): IsoDate | null => {
  if (term === 'month') return /^\d{4}-\d{2}$/.test(value) ? lastDayOf(value) : null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

/**
 * Окно «Повтор» (доработки 28.11.2026, блок 2; прототип modules/task-series.js, `tsDlg`): интервал и
 * единица (у задачи «На месяц» — только месяцы и годы), дни недели кружками, «Когда» у месяца, «Начало»
 * (срок первой задачи — то же поле, что срок в форме), окончание «Никогда» / дата / после N повторов и
 * правило словами внизу. «Готово» проверяет поля (те же правила, что у сервера) и отдаёт правило и
 * начало; сохраняет его вызывающий.
 */
export function SeriesRuleDialog({
  open,
  onClose,
  rule,
  start,
  term,
  busy = false,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  rule: SeriesRuleBody | null;
  start: IsoDate;
  term: TaskTerm;
  busy?: boolean;
  onDone: (rule: SeriesRuleBody, start: IsoDate) => void;
}) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(rule, start, term));
  const [initial] = useState(draft);
  const [errors, setErrors] = useState<Errors>({});
  const monthTerm = term === 'month';
  const startDate = startOf(draft.start, term) ?? start;
  const units = monthTerm ? SERIES_MONTH_TERM_UNITS : SERIES_UNITS;
  const modes = seriesMonthModes(startDate);
  const current = draftRule(draft, term, startDate);
  const preview = seriesRuleText({ rule: current, start: startDate, term });

  const set = (patch: Partial<Draft>, clear?: RuleField) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Число начала сменилось — «Когда», которого для него нет, сбрасывается на «N-го числа».
      const s = startOf(next.start, term);
      if (s && !seriesMonthModes(s).includes(next.monthMode)) next.monthMode = 'date';
      if (next.unit === 'week' && !next.weekDays.length && s) next.weekDays = [weekdayMondayFirst(s)];
      return next;
    });
    if (clear) setErrors((e) => ({ ...e, [clear]: undefined }));
  };

  const done = () => {
    const s = startOf(draft.start, term);
    const next: Errors = {};
    const every = Number(draft.every);
    if (!Number.isInteger(every) || every < 1 || every > SERIES_EVERY_MAX)
      next.every = t('err.series_every');
    if (draft.unit === 'week' && !draft.weekDays.length) next.weekDays = t('err.series_week_days');
    if (!s) next.start = t('task.series.dlg.start_required');
    const plan = { rule: draftRule(draft, term, s ?? start), start: s ?? start, term };
    const problems = seriesRuleProblems(plan);
    if (problems.monthMode) next.monthMode = t(`err.${problems.monthMode}`);
    if (problems.end) next.end = t(`err.${problems.end}`);
    setErrors(next);
    if (Object.keys(next).length || !s) return;
    onDone(plan.rule, s);
  };

  const times = (n: number) => t(`task.series.dlg.times.${pluralForm(n)}`);
  const count = Number(draft.endCount);

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      title={t('task.series.dlg.title')}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-series-done=""
            className={buttonClass('cta')}
            disabled={busy}
            onClick={done}
          >
            {t('task.series.dlg.done')}
          </button>
        </>
      }
    >
      <div data-series-dialog="">
        <FormGrid>
          <Field id={`${id}-every`} label={t('task.series.dlg.every')} error={errors.every} full>
            {(control) => (
              <div className="flex flex-nowrap gap-2">
                <input
                  {...control}
                  type="number"
                  min={1}
                  max={SERIES_EVERY_MAX}
                  step={1}
                  inputMode="numeric"
                  data-series-every=""
                  className={`${inputClass({ full: false })} w-[84px] flex-none`}
                  value={draft.every}
                  onChange={(e) => set({ every: e.target.value }, 'every')}
                />
                <select
                  aria-label={t('task.series.dlg.unit')}
                  data-series-unit=""
                  className={`${inputClass()} min-w-0 flex-1 cursor-pointer`}
                  value={draft.unit}
                  onChange={(e) => set({ unit: e.target.value as SeriesUnit })}
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {seriesUnitLabel(u, Number(draft.every))}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>
          {draft.unit === 'week' ? (
            <div data-field="" data-full="" className="col-span-full flex min-w-0 flex-col gap-[5px]">
              <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
                {t('task.series.dlg.days')}
              </span>
              <div
                role="group"
                aria-label={t('task.series.dlg.days')}
                className="flex flex-nowrap gap-1 max-md:justify-between md:gap-1.5"
              >
                {SERIES_WEEKDAY_LETTERS.map((letter, i) => {
                  const on = draft.weekDays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      data-series-day={i}
                      aria-pressed={on}
                      aria-label={SERIES_WEEKDAY_NAMES[i]}
                      title={SERIES_WEEKDAY_NAMES[i]}
                      className={`inline-flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-9 md:w-9 ${
                        on
                          ? 'border-accent bg-accent text-on-accent'
                          : 'border-line-strong bg-field text-ink hover:bg-hover'
                      }`}
                      onClick={() =>
                        set(
                          {
                            weekDays: on
                              ? draft.weekDays.filter((d) => d !== i)
                              : [...draft.weekDays, i].sort((a, b) => a - b),
                          },
                          'weekDays',
                        )
                      }
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              {errors.weekDays ? (
                <div role="alert" className="text-[12px] text-danger">
                  {errors.weekDays}
                </div>
              ) : null}
            </div>
          ) : null}
          {draft.unit === 'month' && !monthTerm ? (
            <Field id={`${id}-mm`} label={t('task.series.dlg.when')} error={errors.monthMode} full>
              {(control) => (
                <select
                  {...control}
                  data-series-month-mode=""
                  className={`${inputClass()} cursor-pointer`}
                  value={draft.monthMode}
                  onChange={(e) => set({ monthMode: e.target.value as SeriesMonthMode }, 'monthMode')}
                >
                  {modes.map((m) => (
                    <option key={m} value={m}>
                      {seriesMonthText(m, startDate)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {draft.unit === 'year' && !monthTerm ? (
            <div data-field="" data-full="" className="col-span-full">
              <Hint>
                {t('task.series.dlg.year', { date: seriesDayMonthText(startDate) })}
                {startDate.slice(5) === '02-29' ? t('task.series.dlg.year_leap') : ''}
              </Hint>
            </div>
          ) : null}
          <Field
            id={`${id}-start`}
            label={t('task.series.dlg.start')}
            required
            hint={t('task.series.dlg.start_hint')}
            error={errors.start}
          >
            {(control) => (
              <input
                {...control}
                type={monthTerm ? 'month' : 'date'}
                data-series-start=""
                className={inputClass()}
                value={monthTerm ? draft.start.slice(0, 7) : draft.start}
                onChange={(e) => set({ start: e.target.value }, 'start')}
              />
            )}
          </Field>
          <div />
          <div data-field="" data-full="" className="col-span-full flex min-w-0 flex-col gap-[5px]">
            <span className="text-[12px] font-semibold tracking-[.01em] text-muted">
              {t('task.series.dlg.end')}
            </span>
            <div role="radiogroup" aria-label={t('task.series.dlg.end')} className="flex flex-col gap-1.5">
              <label className="flex min-h-[38px] cursor-pointer flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-end`}
                  data-series-end="never"
                  className={CHECKBOX_CLASS}
                  checked={draft.endKind === 'never'}
                  onChange={() => set({ endKind: 'never' }, 'end')}
                />
                {t('task.series.dlg.never')}
              </label>
              <label className="flex min-h-[38px] cursor-pointer flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-end`}
                  data-series-end="date"
                  className={CHECKBOX_CLASS}
                  checked={draft.endKind === 'date'}
                  onChange={() => set({ endKind: 'date' }, 'end')}
                />
                {t('task.series.dlg.date')}
                <input
                  type="date"
                  aria-label={t('task.series.dlg.date_label')}
                  data-series-end-date=""
                  className={`${inputClass({ full: false })} w-[170px] flex-none`}
                  disabled={draft.endKind !== 'date'}
                  value={draft.endDate}
                  onChange={(e) => set({ endDate: e.target.value }, 'end')}
                />
              </label>
              <label className="flex min-h-[38px] cursor-pointer flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-end`}
                  data-series-end="count"
                  className={CHECKBOX_CLASS}
                  checked={draft.endKind === 'count'}
                  onChange={() => set({ endKind: 'count' }, 'end')}
                />
                {t('task.series.dlg.after')}
                <input
                  type="number"
                  min={1}
                  max={SERIES_COUNT_MAX}
                  step={1}
                  inputMode="numeric"
                  aria-label={t('task.series.dlg.count_label')}
                  data-series-end-count=""
                  className={`${inputClass({ full: false })} w-[84px] flex-none`}
                  disabled={draft.endKind !== 'count'}
                  value={draft.endCount}
                  onChange={(e) => set({ endCount: e.target.value }, 'end')}
                />
                {times(Number.isInteger(count) && count > 0 ? count : SERIES_COUNT_DEFAULT)}
              </label>
            </div>
            {errors.end ? (
              <div role="alert" className="text-[12px] text-danger">
                {errors.end}
              </div>
            ) : null}
          </div>
          <div data-field="" data-full="" className="col-span-full">
            <Note icon="repeat">
              <span data-series-preview="">{preview}</span>
            </Note>
          </div>
        </FormGrid>
      </div>
    </Modal>
  );
}

/**
 * «Только эту задачу» или «Эту и следующие» (прототип `tsAsk`, как в Google): при правке и отмене
 * задачи действующей серии. `oneWhy` — почему «Только эту задачу» нельзя (сменили правило повтора):
 * тогда выбрано «Эту и следующие».
 */
export function SeriesScopeDialog({
  open,
  onClose,
  title,
  ok,
  danger = false,
  oneWhy = '',
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  ok: string;
  danger?: boolean;
  oneWhy?: string;
  onPick: (scope: SeriesScope) => void;
}) {
  const t = useT();
  const id = useId();
  const [scope, setScope] = useState<SeriesScope>(oneWhy ? 'next' : 'one');
  const rows: { value: SeriesScope; label: string; why: string }[] = [
    { value: 'one', label: t('task.series.ask.one'), why: oneWhy },
    { value: 'next', label: t('task.series.ask.next'), why: '' },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="message"
      quick
      noMax
      title={title}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-series-scope-ok=""
            className={buttonClass(danger ? 'danger' : 'cta')}
            onClick={() => {
              onClose();
              onPick(scope);
            }}
          >
            {ok}
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('task.series.ask.group')} data-series-scope="">
        {rows.map((r) => (
          <label
            key={r.value}
            className={`flex items-center gap-2.5 border-b border-line py-2 last:border-b-0 ${r.why ? '' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name={`${id}-scope`}
              data-series-scope-pick={r.value}
              className={CHECKBOX_CLASS}
              checked={scope === r.value}
              disabled={!!r.why}
              onChange={() => setScope(r.value)}
            />
            <span className="min-w-0 flex-1">
              <b>{r.label}</b>
              {r.why ? (
                <span className="block">
                  <Hint>{r.why}</Hint>
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

/** Значок «↻» у названия задачи серии (прототип `tsIc`): подсказка — правило словами. */
export function SeriesIcon({ rule }: { rule: string }) {
  const t = useT();
  return (
    <span
      data-series-icon=""
      className="mr-[5px] inline-flex align-[-2px] text-muted"
      title={t('task.repeat.tip', { rule })}
      aria-label={t('task.repeat.icon', { rule })}
      role="img"
    >
      <Icon name="repeat" size="sm" />
    </span>
  );
}
