'use client';

import { formatMomentRu, monthOf, monthRange, monthText, type ListSort } from '@buhuchet/domain';
import { ListValues, listPageSchema, KpiPeriodRow } from '@buhuchet/shared';
import { DataGrid, EmptyState, Tag, type GridColumn } from '@buhuchet/ui';
import { useCallback, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useKpiEntry } from './kpi-entry';
import { monthGenName, monthShortName, numberText } from './kpi-format';
import { defaultPeriod, PeriodBar, todayBishkek, type Period } from './kpi-period-bar';
import { KpiPlates } from './kpi-plates';
import { setKpiChoice, useKpiChoice } from './kpi-state';

/*
 * Вкладка «За период» (задача 2.27; ТЗ «Вкладка «За период»»; прототип modules/kpi.js, kpiPeriod):
 * строки — контрагент и показатель, столбцы — месяцы периода и итоги «Сумма», «Среднее», «Максимум»,
 * «Минимум» только по заполненным месяцам; группировка, фильтры и «В Excel» — общий список. Ячейка месяца
 * открывает окно значения контрагента за месяц.
 */

const KpiPeriodList = listPageSchema(KpiPeriodRow);
const TOTALS = ['sum', 'avg', 'max', 'min'] as const;
/** По умолчанию — по контрагенту (ТЗ). */
const DEFAULT_SORT: ListSort = { key: 'cp', dir: 'asc' };
const monthKey = (m: string) => `m${m}`;

function periodColumns(
  t: Translate,
  months: readonly string[],
  current: string,
  onCell: (row: KpiPeriodRow, month: string) => void,
): GridColumn<KpiPeriodRow>[] {
  const off = (r: KpiPeriodRow) =>
    r.offSince ? t('kpi.off_since', { month: monthGenName(t, r.offSince) }) : '';
  return [
    {
      key: 'cp',
      label: t('kpi.col.contractor'),
      type: 'text',
      width: 230,
      text: (r) => r.contractorName,
      // Карточку контрагента на вкладке «Показатели» откроет её задача (2.11, #67).
      cell: (r) => <span className="truncate font-semibold">{r.contractorName}</span>,
    },
    {
      key: 'ind',
      label: t('kpi.col.indicator'),
      type: 'enum',
      width: 190,
      text: (r) => r.indicatorName,
      cell: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{r.indicatorName}</span>
          {r.indicatorArchived ? <Tag>{t('kpi.archived_tag')}</Tag> : null}
          {off(r) ? <Tag>{off(r)}</Tag> : null}
        </span>
      ),
    },
    ...months.map((m, j): GridColumn<KpiPeriodRow> => ({
      key: monthKey(m),
      label: monthShortName(t, m),
      type: 'money',
      width: 105,
      text: (r) => numberText(r.type, r.values[j] ?? null),
      cell: (r) => {
        const v = r.values[j] ?? null;
        const empty = v === null && r.needed[j] && m < current;
        return (
          <button
            type="button"
            data-kpi-cell={`${r.contractorId}|${m}`}
            title={t('kpi.cell_title', { ind: r.indicatorName, month: monthText(m) })}
            className={`cursor-pointer rounded-[5px] border-0 bg-transparent px-1 py-0.5 tabular-nums hover:bg-row-hover ${empty ? 'text-warn-label italic' : v === null ? 'text-faint' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onCell(r, m);
            }}
          >
            {v === null ? (r.needed[j] ? t('kpi.empty') : '—') : numberText(r.type, v)}
          </button>
        );
      },
    })),
    ...TOTALS.map((k): GridColumn<KpiPeriodRow> => ({
      key: k,
      label: t(`kpi.total.${k}`),
      type: 'money',
      width: k === 'avg' ? 170 : 130,
      text: (r) => numberText(r.type, r.totals[k]),
      cell: (r) =>
        r.totals[k] === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span>
            <b>{numberText(r.type, r.totals[k])}</b>
            {k === 'avg' ? (
              <small className="ml-1 text-faint">
                {t('kpi.avg_of', { n: r.count, of: r.need || months.length })}
              </small>
            ) : null}
          </span>
        ),
    })),
    {
      key: 'resp',
      label: t('kpi.col.responsible'),
      type: 'enum',
      width: 140,
      text: (r) => r.responsibleName ?? '',
    },
    { key: 'unit', label: t('kpi.col.unit'), type: 'enum', width: 90, text: (r) => r.unit },
    {
      key: 'nf',
      label: t('kpi.col.filled_months'),
      type: 'int',
      width: 120,
      text: (r) => t('kpi.filled_of', { n: r.count, of: r.need }),
    },
    {
      key: 'fs',
      label: t('kpi.col.fill_state'),
      type: 'enum',
      width: 150,
      text: (r) => t(r.count >= r.need ? 'kpi.fill_state.full' : 'kpi.fill_state.gaps'),
    },
    {
      key: 'ub',
      label: t('kpi.col.updated_by'),
      type: 'text',
      width: 170,
      text: (r) =>
        r.lastBy && r.lastAt ? `${r.lastBy} · ${formatMomentRu(new Date(r.lastAt))}` : '',
    },
  ];
}

const fetchPeriod: FetchListPage<KpiPeriodRow> = async (params) => {
  const res = await api.api.kpi.period.$get({
    query: { ...params, from: params.from!, to: params.to! },
  });
  if (!res.ok) throw await apiFailure(res);
  return KpiPeriodList.parse(await res.json());
};

export function KpiPeriodTab() {
  const t = useT();
  const labels = useGridLabels('kpi.period.count');
  const { search, clearSearch, access } = useShell();
  const choice = useKpiChoice();
  const period: Period = choice.period ?? defaultPeriod();
  const months = useMemo(() => monthRange(period.from, period.to), [period.from, period.to]);
  const entry = useKpiEntry();
  const current = monthOf(todayBishkek());
  const open = entry.open;
  const columns = useMemo(
    () => periodColumns(t, months, current, (r, m) => void open(r.contractorId, m)),
    [t, months, current, open],
  );
  const defaultVisible = useMemo(() => ['cp', 'ind', ...months.map(monthKey), ...TOTALS], [months]);
  const view = useViewSettings('kpi.period');
  const extra = useMemo(() => ({ from: period.from, to: period.to }), [period.from, period.to]);
  const list = useListPage({
    gridKey: 'kpi.period',
    columns,
    audit: false,
    defaultVisible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchPeriod,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.kpi.period.export.$get({
        query: { ...params, cols: visible.join(','), from: period.from, to: period.to },
      }),
    [params, visible, period.from, period.to],
  );
  const exporter = useListExport(sendExport);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.kpi.period.values.$get({
        query: { col, ...(q ? { q } : {}), from: period.from, to: period.to },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [period.from, period.to],
  );

  return (
    <div className="flex flex-col gap-3.5">
      <KpiPlates />
      <PeriodBar value={period} onChange={(p) => setKpiChoice({ period: p })} />
      <DataGrid
        columns={columns}
        defaultVisible={defaultVisible}
        defaultSort={DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={list.filters}
        onFiltersChange={list.setFilters}
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={<EmptyState icon="chart" title={t('kpi.period.empty')} />}
        rowKey={(r) => r.id}
        titleKey="cp"
        label={t('tab.kpi.period')}
        labels={labels}
      />
      {entry.dialog}
    </div>
  );
}
