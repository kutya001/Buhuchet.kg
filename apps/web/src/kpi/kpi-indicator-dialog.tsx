'use client';

import {
  DUE_DAY_DEFAULT,
  formatMomentRu,
  INDICATOR_TOTALS,
  INDICATOR_TYPES,
  INDICATOR_UNITS,
  indicatorProblems,
  monthOf,
  type IndicatorField,
  type IndicatorScope,
  type IndicatorTotal,
  type IndicatorType,
} from '@buhuchet/domain';
import { Indicators, type IndicatorCard, type KpiWho } from '@buhuchet/shared';
import {
  buttonClass,
  CHECKBOX_CLASS,
  CheckList,
  Field,
  FormGrid,
  Hint,
  inputClass,
  MiniTable,
  Modal,
  RecordChangedNotice,
  Segments,
  useToast,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { api, callApi } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { useErrorText, useT } from '../l10n/provider';
import { indicatorQuery, indicatorsQuery, useKpiRefresh, whoQuery } from './kpi-data';
import { indicatorHistoryText } from './kpi-history';
import { todayBishkek } from './kpi-period-bar';
import { whoFilter, WhoFilters, type WhoFilter } from './kpi-who-filter';

/*
 * Окно «Новый показатель» / «Показатель «…»» (задача 2.27; ТЗ «Вкладка «Настройка показателей»»;
 * прототип modules/kpi.js: indDlg, kWhoApply): поля показателя, «Кому вести» — всем или выбранным с
 * фильтрами и «Выбрать все», обязательность, срок, «Вести с», история показателя. Право «Настраивать
 * показатели».
 */

const CUSTOM = '_';

interface DialogData {
  card: IndicatorCard | null;
  who: KpiWho;
  /** Названия всех показателей организации (в архиве тоже): «Такой показатель уже есть». */
  names: { id: string; name: string }[];
}

export function useIndicatorDialog() {
  const t = useT();
  const toast = useToast();
  const client = useQueryClient();
  const [slot, setSlot] = useState<DialogSlot<DialogData> | null>(null);

  // Данные загружаются до открытия: поля сразу на месте и фокус — в первом.
  const open = useCallback(
    async (id: string | null) => {
      try {
        const [card, who, list] = await Promise.all([
          id ? client.fetchQuery({ ...indicatorQuery(id), staleTime: 0 }) : null,
          client.fetchQuery({ ...whoQuery, staleTime: 0 }),
          client.fetchQuery(indicatorsQuery),
        ]);
        setSlot(
          openSlot({ card, who, names: list.items.map((i) => ({ id: i.id, name: i.name })) }),
        );
      } catch {
        toast(t('err.unknown'), { bad: true });
      }
    },
    [client, toast, t],
  );

  const dialog = slot ? (
    <IndicatorDialog
      key={`kpi-indicator-${slot.n}`}
      open={slot.open}
      onClose={() => setSlot(closeSlot)}
      data={slot.data}
    />
  ) : null;
  return { open, dialog };
}

interface State {
  name: string;
  unit: string;
  customUnit: string;
  type: IndicatorType;
  total: IndicatorTotal;
  description: string;
  dueDay: string;
  start: string;
  required: boolean;
  scope: IndicatorScope;
  autoNew: boolean;
  selected: readonly string[];
}

function stateOf(card: IndicatorCard | null, current: string): State {
  const preset = (INDICATOR_UNITS as readonly string[]).includes(card?.unit ?? INDICATOR_UNITS[0]);
  return {
    name: card?.name ?? '',
    unit: preset ? (card?.unit ?? INDICATOR_UNITS[0]) : CUSTOM,
    customUnit: preset ? '' : (card?.unit ?? ''),
    type: card?.type ?? 'som',
    total: card?.total ?? 'sum',
    description: card?.description ?? '',
    dueDay: String(card?.dueDay ?? DUE_DAY_DEFAULT),
    start: card?.start ?? current,
    required: card?.required ?? true,
    scope: card?.scope ?? 'all',
    autoNew: card?.autoNew ?? true,
    selected: card?.selected ?? [],
  };
}

const FOCUS: IndicatorField[] = ['name', 'unit', 'type', 'description', 'dueDay', 'start'];

function IndicatorDialog({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data: DialogData;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const id = useId();
  const current = monthOf(todayBishkek());
  const [card, setCard] = useState(data.card);
  const [start, setStart] = useState(() => stateOf(card, current));
  const [st, setSt] = useState(start);
  const [filter, setFilter] = useState<WhoFilter>({});
  const [errors, setErrors] = useState<Partial<Record<IndicatorField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const hasValues = (card?.valueCount ?? 0) > 0;
  const dirty = JSON.stringify(st) !== JSON.stringify(start);
  const all = data.who.contractors;
  const shown = whoFilter(all, filter);
  const set = (patch: Partial<State>, field?: IndicatorField) => {
    setSt((s) => ({ ...s, ...patch }));
    if (field) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const unit = st.unit === CUSTOM ? st.customUnit.trim() : st.unit;
  const offNow = card && card.scope === 'all' ? Math.max(0, all.length - card.on) : 0;

  const reload = async () => {
    if (!card) return;
    setReloading(true);
    const fresh = await client
      .fetchQuery({ ...indicatorQuery(card.id), staleTime: 0 })
      .catch(() => null);
    setReloading(false);
    if (!fresh) return onClose();
    const next = stateOf(fresh, current);
    setCard(fresh);
    setStart(next);
    setSt(next);
    setErrors({});
    setChanged(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = {
      name: st.name.trim(),
      unit,
      type: st.type,
      total: st.total,
      description: st.description.trim(),
      required: st.required,
      dueDay: Number(st.dueDay),
      start: st.start,
      scope: st.scope,
      autoNew: st.scope === 'all' ? true : st.autoNew,
    };
    const problems = indicatorProblems(input, {
      otherNames: data.names.filter((n) => n.id !== card?.id).map((n) => n.name),
      currentMonth: current,
      ...(card ? { before: { type: card.type, unit: card.unit, hasValues } } : {}),
      selected: st.selected.length,
    });
    const found: Partial<Record<IndicatorField, string>> = {};
    for (const p of problems) {
      if (p.field === 'scope') continue;
      found[p.field] ??= t(`err.${p.problem}`);
    }
    setErrors(found);
    const first = FOCUS.find((f) => found[f]);
    if (first) {
      return document
        .getElementById(`${id}-${first === 'unit' && st.unit === CUSTOM ? 'uc' : first}`)
        ?.focus();
    }
    if (problems.some((p) => p.problem === 'targets_required')) {
      return toast(t('err.targets_required'), { bad: true });
    }
    const json = { ...input, selected: st.scope === 'selected' ? [...st.selected] : [] };
    setBusy(true);
    const res = await callApi(() =>
      card
        ? api.api.kpi.indicators[':id'].$put({
            param: { id: card.id },
            json: { ...json, version: card.version },
          })
        : api.api.kpi.indicators.$post({ json }),
    );
    setBusy(false);
    if (res.ok) {
      client.setQueryData(indicatorsQuery.queryKey, Indicators.parse(res.data));
      void refresh();
      onClose();
      return toast(t(card ? 'kpi.indicator.saved' : 'kpi.indicator.created'), { icon: 'gauge' });
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const field = (res.error.details as { field?: IndicatorField } | undefined)?.field;
    if (field && field !== 'scope') {
      setErrors({ [field]: errorText(res.error) });
      return document.getElementById(`${id}-${field}`)?.focus();
    }
    toast(errorText(res.error), { bad: true });
  };

  const formId = `${id}-form`;
  const lockHint = hasValues ? t('err.type_locked') : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={card ? t('kpi.indicator.title', { name: card.name }) : t('kpi.indicator.new')}
      sub={t('kpi.indicator.sub')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={buttonClass('cta')}
            disabled={busy || changed}
          >
            {t(card ? 'btn.save' : 'kpi.indicator.create')}
          </button>
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form
        id={formId}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-3.5"
        data-kpi-indicator-form=""
      >
        <FormGrid>
          <Field id={`${id}-name`} label={t('kpi.field.name')} required full error={errors.name}>
            {(control) => (
              <input
                {...control}
                className={inputClass()}
                autoComplete="off"
                placeholder={t('kpi.indicator.name_hint')}
                value={st.name}
                onChange={(e) => set({ name: e.target.value }, 'name')}
              />
            )}
          </Field>
          <Field
            id={`${id}-unit`}
            label={t('kpi.field.unit')}
            hint={lockHint}
            error={st.unit === CUSTOM ? undefined : errors.unit}
          >
            {(control) => (
              <select
                {...control}
                className={`${inputClass()} cursor-pointer`}
                disabled={hasValues}
                value={st.unit}
                onChange={(e) => set({ unit: e.target.value }, 'unit')}
              >
                {INDICATOR_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
                <option value={CUSTOM}>{t('kpi.indicator.custom_unit')}</option>
              </select>
            )}
          </Field>
          {st.unit === CUSTOM ? (
            <Field id={`${id}-uc`} label={t('kpi.indicator.custom_label')} error={errors.unit}>
              {(control) => (
                <input
                  {...control}
                  className={inputClass()}
                  autoComplete="off"
                  disabled={hasValues}
                  placeholder={t('kpi.indicator.custom_hint')}
                  value={st.customUnit}
                  onChange={(e) => set({ customUnit: e.target.value }, 'unit')}
                />
              )}
            </Field>
          ) : (
            <div />
          )}
          <Field id={`${id}-type`} label={t('kpi.field.type')} hint={lockHint} error={errors.type}>
            {(control) => (
              <select
                {...control}
                className={`${inputClass()} cursor-pointer`}
                disabled={hasValues}
                value={st.type}
                onChange={(e) => set({ type: e.target.value as IndicatorType }, 'type')}
              >
                {INDICATOR_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`kpi.type.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-total`}
            label={t('kpi.field.total')}
            hint={t('kpi.indicator.total_hint')}
          >
            {(control) => (
              <select
                {...control}
                className={`${inputClass()} cursor-pointer`}
                value={st.total}
                onChange={(e) => set({ total: e.target.value as IndicatorTotal })}
              >
                {INDICATOR_TOTALS.map((x) => (
                  <option key={x} value={x}>
                    {t(`kpi.total.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-description`}
            label={t('kpi.field.description')}
            full
            error={errors.description}
          >
            {(control) => (
              <textarea
                {...control}
                className={`${inputClass({ multiline: true })} min-h-[60px]`}
                placeholder={t('kpi.indicator.description_hint')}
                value={st.description}
                onChange={(e) => set({ description: e.target.value }, 'description')}
              />
            )}
          </Field>
          <Field id={`${id}-dueDay`} label={t('kpi.indicator.due')} error={errors.dueDay}>
            {(control) => (
              <input
                {...control}
                type="number"
                min={1}
                max={28}
                className={`${inputClass({ full: false })} w-[110px]`}
                value={st.dueDay}
                onChange={(e) => set({ dueDay: e.target.value }, 'dueDay')}
              />
            )}
          </Field>
          <Field
            id={`${id}-start`}
            label={t('kpi.field.start_month')}
            hint={t('kpi.indicator.start_hint')}
            error={errors.start}
          >
            {(control) => (
              <input
                {...control}
                type="month"
                max={current}
                className={`${inputClass({ full: false })} w-auto`}
                value={st.start}
                onChange={(e) => set({ start: e.target.value || st.start }, 'start')}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] md:mt-[22px]">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={st.required}
                onChange={(e) => set({ required: e.target.checked })}
              />
              {t('kpi.indicator.required')}
            </label>
            <Hint>{t('kpi.indicator.required_hint')}</Hint>
          </div>
        </FormGrid>
        <section className="flex flex-col gap-2" data-kpi-scope="">
          <span className="text-[12.5px] font-semibold text-muted">{t('kpi.field.scope')}</span>
          <Segments<IndicatorScope>
            label={t('kpi.field.scope')}
            value={st.scope}
            options={[
              { value: 'all', label: t('kpi.scope.all') },
              { value: 'selected', label: t('kpi.scope.selected') },
            ]}
            onChange={(scope) =>
              set({
                scope,
                // Новый показатель «Выбранным» — сначала отмечены все (прототип `indDlg`).
                ...(scope === 'selected' && st.selected.length === 0 && !card
                  ? { selected: all.map((c) => c.id) }
                  : {}),
              })
            }
          />
          {st.scope === 'all' ? (
            offNow > 0 ? (
              <Hint>{t('kpi.indicator.off_now', { n: offNow })}</Hint>
            ) : null
          ) : (
            <>
              <WhoFilters contractors={all} value={filter} onChange={setFilter} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted">
                  {shown.length < all.length
                    ? t('kpi.indicator.selected_in_filter', {
                        n: st.selected.length,
                        of: all.length,
                        shown: shown.length,
                      })
                    : t('kpi.indicator.selected', { n: st.selected.length, of: all.length })}
                </span>
                <span className="flex-1" />
                {shown.length > 0 ? (
                  <button
                    type="button"
                    className={buttonClass('default', 'sm')}
                    onClick={() => {
                      const ids = new Set(shown.map((c) => c.id));
                      const allOn = shown.every((c) => st.selected.includes(c.id));
                      set({
                        selected: allOn
                          ? st.selected.filter((x) => !ids.has(x))
                          : [...new Set([...st.selected, ...ids])],
                      });
                    }}
                  >
                    {t(
                      shown.every((c) => st.selected.includes(c.id))
                        ? 'kpi.indicator.unselect_all'
                        : 'kpi.indicator.select_all',
                    )}
                  </button>
                ) : null}
              </div>
              {shown.length > 0 ? (
                <CheckList
                  label={t('kpi.field.scope')}
                  options={shown.map((c) => ({
                    value: c.id,
                    label: [c.name, c.regimeName, c.paused ? t('kpi.who.paused_lower') : '']
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  value={st.selected.filter((x) => shown.some((c) => c.id === x))}
                  onChange={(values) => {
                    const ids = new Set(shown.map((c) => c.id));
                    set({ selected: [...st.selected.filter((x) => !ids.has(x)), ...values] });
                  }}
                />
              ) : (
                <Hint>{t('kpi.who.nobody')}</Hint>
              )}
            </>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={st.scope === 'all' || st.autoNew}
              disabled={st.scope === 'all'}
              onChange={(e) => set({ autoNew: e.target.checked })}
            />
            {t('kpi.indicator.auto_new')}
          </label>
          <Hint>
            {st.scope === 'all' ? `${t('kpi.indicator.auto_all')} ` : ''}
            {t('kpi.indicator.not_required')}
          </Hint>
        </section>
        {card && card.history.length > 0 ? (
          <details className="min-w-0">
            <summary className="cursor-pointer text-[12.5px] font-semibold text-muted">
              {t('kpi.indicator.history', { n: card.history.length })}
            </summary>
            <div className="mt-2">
              <MiniTable
                label={t('kpi.indicator.history', { n: card.history.length })}
                empty=""
                columns={[
                  { key: 'at', label: t('kpi.col.when') },
                  { key: 'who', label: t('kpi.col.who') },
                  { key: 'what', label: t('kpi.col.what') },
                ]}
                rows={card.history.map((h, n) => ({
                  key: String(n),
                  wide: ['what'],
                  cells: {
                    at: formatMomentRu(new Date(h.at)),
                    who: h.actor ?? t('status.system'),
                    what: <span className="whitespace-normal">{indicatorHistoryText(t, h)}</span>,
                  },
                }))}
              />
            </div>
          </details>
        ) : null}
      </form>
    </Modal>
  );
}
