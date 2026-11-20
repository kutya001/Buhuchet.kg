'use client';

import type { AdminStorageFile } from '@buhuchet/shared';
import { DataGrid, EmptyState } from '@buhuchet/ui';
import { useCallback, useMemo } from 'react';
import { useAdminCards } from '../admin/admin-cards';
import { useT } from '../l10n/provider';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { usePresetFilters } from '../lists/preset';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useStorageFileActions } from './afiles-actions';
import { STORAGE_SORT, STORAGE_VISIBLE, storageColumns } from './afiles-columns';
import {
  AFILES_GRID_KEY,
  fetchStorageFiles,
  fetchStorageFileValues,
  sendStorageFilesExport,
} from './afiles-data';
import { viewerIdOf } from './afiles-model';

const fetchPage = fetchStorageFiles();
const loadValues = fetchStorageFileValues();

/**
 * Админка → «Файлы» → «Все файлы» (пакет 2, блок 3, пункт 4; прототип `renderAFAll`, `afGrid`): что
 * лежит в хранилище, чьё и откуда — файлы организаций, от контрагентов, документы заявок, чеки
 * подписок, удалённые до стирания. Поиск — по названию, организации, контрагенту и его ИНН; плашка
 * «Хранилища» или строка «По организациям» открывают список с фильтром.
 */
export function AdminFilesAll() {
  const t = useT();
  const labels = useGridLabels('afiles.count');
  const columns = useMemo(() => storageColumns(t), [t]);
  const view = useViewSettings(AFILES_GRID_KEY);
  const preset = usePresetFilters('afiles', 'all');
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: AFILES_GRID_KEY,
    columns,
    audit: false,
    defaultVisible: STORAGE_VISIBLE,
    settings: view.settings,
    defaultSort: STORAGE_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    ...(preset ? { initialFilters: preset } : {}),
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => sendStorageFilesExport(undefined, { ...params, cols: visible.join(',') }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const { openOrg, cards } = useAdminCards();
  const files = useStorageFileActions({ onOrg: (id) => openOrg(id, null, 'files') });
  const rows = list.data?.items ?? [];
  return (
    <div data-afiles-all="">
      <DataGrid<AdminStorageFile>
        columns={columns}
        defaultVisible={STORAGE_VISIBLE}
        defaultSort={STORAGE_SORT}
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
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="folder" title={t('afiles.empty')} />}
        rowKey={viewerIdOf}
        titleKey="name"
        label={t('tab.afiles.all')}
        labels={labels}
        actions={(r) => files.actions(r, rows)}
        onOpen={(r) => files.open(r, rows)}
      />
      {files.node}
      {cards}
    </div>
  );
}
