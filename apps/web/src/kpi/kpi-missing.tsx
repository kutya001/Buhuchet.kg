'use client';

import { formatDateRu, type ListSort } from '@buhuchet/domain';
import { KpiMissingRow, ListValues, listPageSchema } from '@buhuchet/shared';
import { DataGrid, EmptyState, Note, type GridColumn } from '@buhuchet/ui';
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
import { monthName } from './kpi-format';
import { KpiPlates } from './kpi-plates';
import { MonthMini } from './kpi-status';

/*
 * Вкладка «Не заполнено» (задача 2.27; ТЗ «Вкладка «Не заполнено»»; прототип modules/kpi.js,
 * kpiMissingTab): контрагенты и месяцы, за которые не внесены обязательные показатели; после срока
 * заполнения строка красная. По умолчанию — по сроку заполнения, старые сверху. Строка открывает окно
 * значений контрагента за месяц.
 */

const KpiMissingList = listPageSchema(KpiMissingRow);
const DEFAULT_SORT: ListSort = { key: 'due', dir: 'asc' };
const DEFAULT_VISIBLE = ['cp', 'm', 'miss', 'resp', 'due', 'over', 'st'];

function missingColumns(t: Translate): GridColumn<KpiMissingRow>[] {
  return [
    {
      key: 'cp',
      label: t('kpi.col.contractor'),
      type: 'text',
      width: 230,
      text: (r) => r.contractorName,
      cell: (r) => <span className="truncate font-semibold">{r.contractorName}</span>,
    },
    {
      key: 'm',
      label: t('kpi.col.month'),
      type: 'enum',
      width: 140,
      text: (r) => monthName(t, r.month),
    },
    {
      key: 'miss',
      label: t('kpi.col.missing'),
      type: 'text',
      width: 260,
      text: (r) => r.missing.map((x) => x.name).join(', '),
    },
    {
      key: 'resp',
      label: t('kpi.col.responsible'),
      type: 'enum',
      width: 140,
      text: (r) => r.responsibleName ?? '',
    },
    {
      key: 'due',
      label: t('kpi.col.due'),
      type: 'date',
      width: 130,
      text: (r) => formatDateRu(r.due),
      cell: (r) => (
        <span className={r.overdueDays > 0 ? 'font-semibold text-danger-label' : ''}>
          {formatDateRu(r.due)}
        </span>
      ),
    },
    {
      key: 'over',
      label: t('kpi.col.overdue_days'),
      type: 'int',
      width: 120,
      text: (r) => (r.overdueDays > 0 ? String(r.overdueDays) : ''),
    },
    {
      key: 'st',
      label: t('kpi.col.month_status'),
      type: 'enum',
      width: 170,
      text: (r) => t(`status.indicator.${r.status}`),
      cell: (r) => (
        <MonthMini
          status={r.statusAt ? { code: r.status, at: r.statusAt, actor: null } : null}
          needed
        />
      ),
    },
  ];
}

const fetchMissing: FetchListPage<KpiMissingRow> = async (params) => {
  const res = await api.api.kpi.missing.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return KpiMissingList.parse(await res.json());
};

const fetchMissingValues = async (col: string, q?: string) => {
  const res = await api.api.kpi.missing.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export function KpiMissingTab() {
  const t = useT();
  const labels = useGridLabels('kpi.missing.count');
  const columns = useMemo(() => missingColumns(t), [t]);
  const view = useViewSettings('kpi.missing');
  const { search, clearSearch, access } = useShell();
  const entry = useKpiEntry();
  const list = useListPage({
    gridKey: 'kpi.missing',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchMissing,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.kpi.missing.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  return (
    <div className="flex flex-col gap-3.5">
      <KpiPlates />
      <Note>{t('kpi.missing.note')}</Note>
      <DataGrid
        columns={columns}
        defaultVisible={DEFAULT_VISIBLE}
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
        loadValues={fetchMissingValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="ok"
            title={t('kpi.missing.empty_title')}
            text={t('kpi.missing.empty_text')}
          />
        }
        rowKey={(r) => r.id}
        titleKey="cp"
        rowTone={(r) => (r.overdueDays > 0 ? 'overdue' : undefined)}
        label={t('tab.kpi.missing')}
        labels={labels}
        onOpen={(r) => void entry.open(r.contractorId, r.month)}
      />
      {entry.dialog}
    </div>
  );
}
