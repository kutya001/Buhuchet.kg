'use client';

import { searchText } from '@buhuchet/domain';
import type { WhoContractor } from '@buhuchet/shared';
import { inputClass, MONO_CLASS } from '@buhuchet/ui';
import { useT } from '../l10n/provider';

/*
 * Фильтры контрагентов «Кому вести» и списка «Выбранным» окна показателя (ТЗ: режим, ответственный,
 * статус контрагента, ГКЭД, поиск; прототип modules/kpi.js: kWhoFiltHtml, kWhoFilter).
 */

export interface WhoFilter {
  q?: string;
  /** Код режима. */
  regime?: string;
  /** Сотрудник; «-» — без ответственного. */
  resp?: string;
  status?: 'active' | 'paused' | '';
  /** Начало кода ГКЭД. */
  gked?: string;
}

/** Контрагенты под фильтром (поиск — по названию и ИНН, ГКЭД — по началу любого кода). */
export function whoFilter(list: readonly WhoContractor[], f: WhoFilter): WhoContractor[] {
  const q = searchText((f.q ?? '').trim());
  const g = (f.gked ?? '').trim();
  return list.filter(
    (c) =>
      (!q || searchText(c.name).includes(q) || c.inn.includes(q)) &&
      (!f.regime || c.regimeCode === f.regime) &&
      (!f.resp ||
        (f.resp === '-' ? c.responsibleEmployeeId === null : c.responsibleEmployeeId === f.resp)) &&
      (!f.status || (f.status === 'paused') === c.paused) &&
      (!g || c.gked.some((k) => k.startsWith(g))),
  );
}

export function WhoFilters({
  contractors,
  value,
  onChange,
}: {
  contractors: readonly WhoContractor[];
  value: WhoFilter;
  onChange: (f: WhoFilter) => void;
}) {
  const t = useT();
  const regimes = new Map<string, string>();
  const people = new Map<string, string>();
  let nobody = false;
  for (const c of contractors) {
    if (c.regimeCode) regimes.set(c.regimeCode, c.regimeName ?? c.regimeCode);
    if (c.responsibleEmployeeId) people.set(c.responsibleEmployeeId, c.responsibleName ?? '');
    else nobody = true;
  }
  const sorted = (m: Map<string, string>) =>
    [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  const select = `${inputClass()} cursor-pointer`;

  return (
    <div
      className="grid grid-cols-[minmax(180px,1.6fr)_repeat(3,minmax(130px,1fr))_minmax(120px,0.8fr)] gap-2 max-md:grid-cols-2"
      data-kpi-who-filter=""
    >
      <input
        type="search"
        className={`${inputClass()} max-md:col-span-2`}
        value={value.q ?? ''}
        placeholder={t('kpi.who.search')}
        aria-label={t('kpi.who.search_label')}
        onChange={(e) => onChange({ ...value, q: e.target.value })}
      />
      <select
        className={select}
        value={value.regime ?? ''}
        aria-label={t('kpi.who.regime')}
        onChange={(e) => onChange({ ...value, regime: e.target.value })}
      >
        <option value="">{t('kpi.who.all_regimes')}</option>
        {sorted(regimes).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
      <select
        className={select}
        value={value.resp ?? ''}
        aria-label={t('kpi.col.responsible')}
        onChange={(e) => onChange({ ...value, resp: e.target.value })}
      >
        <option value="">{t('kpi.who.all_responsible')}</option>
        {sorted(people).map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
        {nobody ? <option value="-">{t('kpi.who.no_responsible')}</option> : null}
      </select>
      <select
        className={select}
        value={value.status ?? ''}
        aria-label={t('kpi.who.status')}
        onChange={(e) => onChange({ ...value, status: e.target.value as WhoFilter['status'] })}
      >
        <option value="">{t('kpi.who.all_statuses')}</option>
        <option value="active">{t('kpi.who.active')}</option>
        <option value="paused">{t('kpi.who.paused')}</option>
      </select>
      <input
        className={`${inputClass()} ${MONO_CLASS}`}
        value={value.gked ?? ''}
        placeholder={t('kpi.who.gked')}
        aria-label={t('kpi.who.gked')}
        onChange={(e) => onChange({ ...value, gked: e.target.value })}
      />
    </div>
  );
}

/** «ОНР · Тилекова А. · приостановлен» под названием контрагента. */
export function whoSub(
  t: ReturnType<typeof useT>,
  c: WhoContractor,
  off: string | null = null,
): string {
  return [
    c.regimeName ?? '—',
    c.responsibleName ?? t('kpi.who.no_responsible_lower'),
    c.paused ? t('kpi.who.paused_lower') : '',
    off ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}
