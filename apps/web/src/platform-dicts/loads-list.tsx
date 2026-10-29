'use client';

import { formatMomentRu, type ListSort, type StatusTone } from '@buhuchet/domain';
import type { AdminDictLoad } from '@buhuchet/shared';
import {
  ConfirmDialog,
  DataGrid,
  EmptyState,
  Note,
  StatusPill,
  useToast,
  type ActionEntry,
  type GridColumn,
  type IconName,
} from '@buhuchet/ui';
import { useCallback, useMemo, useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { fetchDictLoads, fetchDictLoadValues, usePdictsRefresh } from './pdicts-data';

const loads = api.api.admin['platform-dict-loads'];

/** Сначала новые загрузки (прототип renderLoads: `sort: {key: 'at', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'at', dir: 'desc' };

const DEFAULT_VISIBLE = [
  'at',
  'dict',
  'by',
  'rows',
  'added',
  'changed',
  'disabled',
  'errors',
  'status',
];

type LoadStatus = 'last' | 'applied' | 'rolled';

const statusOf = (x: AdminDictLoad): LoadStatus =>
  x.rolledBackAt ? 'rolled' : x.last ? 'last' : 'applied';

/** Метка статуса — как в прототипе: «Последняя» синяя, «Применена» зелёная, «Откачена» бледная. */
const STATUS_LOOK: Record<LoadStatus, { tone: StatusTone; icon: IconName }> = {
  last: { tone: 'blue', icon: 'check' },
  applied: { tone: 'green', icon: 'check' },
  rolled: { tone: 'faint', icon: 'history' },
};

const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Столбцы «Загрузок» — как в прототипе (renderLoads); ключи — как на сервере. */
export function loadColumns(t: Translate): GridColumn<AdminDictLoad>[] {
  const count = (key: 'rows' | 'added' | 'changed' | 'disabled' | 'errors', width: number) => ({
    key,
    label: t(`pdicts.loads.col.${key}`),
    type: 'int' as const,
    width,
    text: (x: AdminDictLoad) => String(x[key]),
  });
  return [
    {
      key: 'at',
      label: t('pdicts.loads.col.at'),
      type: 'datetime',
      width: 150,
      text: (x) => moment(x.at),
    },
    {
      key: 'dict',
      label: t('pdicts.loads.col.dict'),
      type: 'enum',
      width: 220,
      text: (x) => t(`pdicts.title.${x.dict}`),
    },
    {
      key: 'by',
      label: t('pdicts.loads.col.by'),
      type: 'enum',
      width: 170,
      text: (x) => x.by ?? '',
    },
    count('rows', 80),
    count('added', 100),
    count('changed', 100),
    count('disabled', 100),
    count('errors', 90),
    {
      key: 'status',
      label: t('pdicts.loads.col.status'),
      type: 'enum',
      width: 150,
      text: (x) => t(`pdicts.loads.status.${statusOf(x)}`),
      cell: (x) => (
        <StatusPill
          {...STATUS_LOOK[statusOf(x)]}
          label={t(`pdicts.loads.status.${statusOf(x)}`)}
          size="sm"
        />
      ),
    },
  ];
}

/**
 * Админка → «Справочники платформы» → «Загрузки» (задача 2.37; ТЗ «Каждая загрузка — отдельная запись в
 * истории (кто, когда, сколько строк); последнюю загрузку можно откатить»; прототип renderLoads,
 * rollbackLoad): загрузки всех справочников, сначала новые; «Откатить» — только у последней, после
 * вопроса.
 */
export function LoadsList() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = usePdictsRefresh();
  const labels = useGridLabels('pdicts.loads.count');
  const columns = useMemo(() => loadColumns(t), [t]);
  const view = useViewSettings('pdicts.loads');
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: 'pdicts.loads',
    columns,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchDictLoads,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => loads.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const [asking, setAsking] = useState<AdminDictLoad | null>(null);

  const rollback = async (x: AdminDictLoad) => {
    const res = await callApi(() => loads[':id'].rollback.$post({ param: { id: x.id } }));
    refresh('loads');
    refresh(x.dict);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('pdicts.loads.rollback.done'), { icon: 'history' });
  };

  const actions = (x: AdminDictLoad): ActionEntry[] => [
    {
      id: 'rollback',
      label: t('pdicts.loads.action.rollback'),
      icon: 'history',
      danger: true,
      disabled: !x.last,
      ...(x.last
        ? {}
        : {
            reason: t(
              x.rolledBackAt ? 'pdicts.loads.reason.rolled' : 'pdicts.loads.reason.not_last',
            ),
          }),
      run: () => setAsking(x),
    },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Note icon="info">{t('pdicts.loads.note')}</Note>
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
        loadValues={fetchDictLoadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="upload"
            title={t('pdicts.loads.empty.title')}
            text={t('pdicts.loads.empty.text')}
          />
        }
        rowKey={(x) => x.id}
        titleKey="dict"
        label={t('tab.pdicts.loads')}
        labels={labels}
        rowTone={(x) => (x.rolledBackAt ? 'muted' : undefined)}
        actions={actions}
      />
      <ConfirmDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={t('pdicts.loads.rollback.title')}
        text={
          asking
            ? t('pdicts.loads.rollback.text', {
                dict: t(`pdicts.title.${asking.dict}`),
                at: moment(asking.at),
                added: asking.added,
                changed: asking.changed + asking.disabled,
              })
            : ''
        }
        ok={t('pdicts.loads.action.rollback')}
        danger
        onConfirm={() => asking && void rollback(asking)}
      />
    </div>
  );
}
