'use client';

import { bishkekDate, fillMonth, periodPresets, type PeriodPreset } from '@buhuchet/domain';
import { inputClass, Segments } from '@buhuchet/ui';
import { useId } from 'react';
import { useT } from '../l10n/provider';

export interface Period {
  from: string;
  to: string;
}

/** Сегодня по Бишкеку (подписи периода и месяцев на устройстве; данные считает сервер). */
export const todayBishkek = () => bishkekDate(new Date());

/** «За период» по умолчанию — последние 12 месяцев до текущего месяца заполнения (прототип `S.kpiP`). */
export function defaultPeriod(): Period {
  const preset = periodPresets(todayBishkek()).find((p) => p.preset === 'last_12')!;
  return { from: preset.from, to: preset.to };
}

/** Текущий месяц заполнения по Бишкеку. */
export const currentFillMonth = () => fillMonth(todayBishkek());

/**
 * Выбор периода (прототип `kPeriodBar`, `kBindPeriod`): «С … по …» и быстрые варианты «Этот год»,
 * «Прошлый год», «Последние 12 месяцев», «Квартал»; «с» позже «по» — меняются местами.
 */
export function PeriodBar({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useT();
  const id = useId();
  const presets = periodPresets(todayBishkek());
  const chosen = presets.find((p) => p.from === value.from && p.to === value.to)?.preset;
  const set = (from: string, to: string) => {
    if (!from || !to) return;
    onChange(from > to ? { from: to, to: from } : { from, to });
  };
  const field = `${inputClass({ full: false })} min-h-8 w-auto px-2 py-[3px]`;

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5" data-kpi-period="">
      <label className="inline-flex items-center gap-1.5" htmlFor={`${id}-f`}>
        <span className="text-muted">{t('kpi.period.from')}</span>
        <input
          id={`${id}-f`}
          type="month"
          className={field}
          value={value.from}
          onChange={(e) => set(e.target.value, value.to)}
        />
      </label>
      <label className="inline-flex items-center gap-1.5" htmlFor={`${id}-t`}>
        <span className="text-muted">{t('kpi.period.to')}</span>
        <input
          id={`${id}-t`}
          type="month"
          className={field}
          value={value.to}
          onChange={(e) => set(value.from, e.target.value)}
        />
      </label>
      <Segments<PeriodPreset | ''>
        label={t('kpi.period.quick')}
        size="sm"
        value={chosen ?? ''}
        options={presets.map((p) => ({ value: p.preset, label: t(`kpi.period.${p.preset}`) }))}
        onChange={(preset) => {
          const p = presets.find((x) => x.preset === preset);
          if (p) set(p.from, p.to);
        }}
      />
    </div>
  );
}
