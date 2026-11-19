'use client';

import {
  formatMomentRu,
  RUN_PERIODS,
  type ListSort,
  type RunPeriod,
  type UiTextKey,
} from '@buhuchet/domain';
import type { AdminRunRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Segments,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useCallback, useMemo } from 'react';
import { api } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { usePresetFilters } from '../lists/preset';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { RunStatusPill, useRunCard } from './run-card';
import { fetchRuns, fetchRunValues } from './runs-data';
import { durationText, momentWithSeconds, tryText } from './runs-model';
import { setRunsView, useRunsView } from './runs-store';

/** Сначала новые (прототип `sort: {key: 'start', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'start', dir: 'desc' };
const DEFAULT_VISIBLE = ['start', 'title', 'st', 'dur', 'tr', 'done', 'err'];
const NUM = 'tabular-nums';
const DASH = <span className="text-faint">—</span>;
const moment = (iso: string) => formatMomentRu(new Date(iso));

/** Столбцы журнала запусков — как в прототипе (admin/runs.js, grid 'run-list'), ключи — как на сервере. */
export function runColumns(t: Translate): GridColumn<AdminRunRow>[] {
  return [
    {
      key: 'start',
      label: t('runs.col.start'),
      type: 'datetime',
      width: 140,
      text: (r) => moment(r.startedAt),
      className: NUM,
    },
    { key: 'title', label: t('runs.col.title'), type: 'enum', width: 280, text: (r) => r.title },
    {
      key: 'st',
      label: t('runs.col.st'),
      type: 'enum',
      width: 150,
      text: (r) => t(`runs.st.${r.status}`),
      cell: (r) => <RunStatusPill t={t} status={r.status} />,
    },
    {
      key: 'dur',
      label: t('runs.col.dur'),
      type: 'text',
      width: 120,
      text: (r) => durationText(t, r.ms),
    },
    {
      key: 'tr',
      label: t('runs.col.tr'),
      type: 'enum',
      width: 100,
      text: (r) => tryText(t, r.attempt),
    },
    {
      key: 'done',
      label: t('runs.col.done'),
      type: 'text',
      width: 280,
      text: (r) => r.doneText ?? '',
      cell: (r) => r.doneText ?? DASH,
    },
    {
      key: 'err',
      label: t('runs.col.err'),
      type: 'text',
      width: 320,
      text: (r) => r.error ?? '',
      className: MONO_CLASS,
    },
    {
      key: 'slot',
      label: t('runs.col.slot'),
      type: 'datetime',
      width: 140,
      text: (r) => moment(r.slot),
      className: NUM,
    },
    {
      key: 'end',
      label: t('runs.col.end'),
      type: 'datetime',
      width: 150,
      text: (r) => (r.finishedAt ? momentWithSeconds(r.finishedAt) : ''),
      cell: (r) => (r.finishedAt ? momentWithSeconds(r.finishedAt) : DASH),
      className: NUM,
    },
  ];
}

type Kind = 'imp' | 'all';

/**
 * Админка → «Запуски» → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js
 * `renderRunList`): журнал попыток запусков. «Важные» (по умолчанию) — ошибки, идущие сейчас и запуски,
 * которые что-то сделали; «Все» — и пустые успешные. Период — «Сегодня · 7 дней · 30 дней». Ошибки —
 * красным; нажатие на строку — окно «Запуск». Только просмотр.
 */
export function RunsList() {
  const t = useT();
  const labels = useGridLabels('runs.count');
  const columns = useMemo(() => runColumns(t), [t]);
  const view = useViewSettings('runs.list');
  const { search, clearSearch } = useShell();
  const chosen = useRunsView();
  const preset = usePresetFilters('runs', 'runs');
  const extra = useMemo(
    () => ({ days: String(chosen.per), all: chosen.imp ? '0' : '1' }),
    [chosen.per, chosen.imp],
  );
  const loadValues = useCallback(
    (col: string, q?: string) => fetchRunValues(extra, col, q),
    [extra],
  );
  const list = useListPage({
    gridKey: 'runs.list',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchRuns,
    extra,
    ...(preset ? { initialFilters: preset } : {}),
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.admin.runs.export.$get({
        query: { ...params, cols: visible.join(',') } as Record<string, string> & {
          cols: string;
          all?: '0' | '1';
        },
      }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const card = useRunCard();
  const actions = (r: AdminRunRow): ActionEntry[] => [
    { id: 'open', label: t('runs.menu.open'), icon: 'eye', run: () => card.open(r.id) },
  ];

  return (
    <div data-runs-list="" className="flex flex-col gap-3.5">
      <div data-runs-bar="" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segments<Kind>
          label={t('runs.seg.kind')}
          options={[
            { value: 'imp', label: t('runs.seg.imp'), title: t('runs.seg.imp_title') },
            { value: 'all', label: t('runs.seg.all') },
          ]}
          value={chosen.imp ? 'imp' : 'all'}
          onChange={(kind) => setRunsView({ imp: kind === 'imp' })}
        />
        <Segments<`${RunPeriod}`>
          label={t('runs.seg.period')}
          options={RUN_PERIODS.map((p) => ({
            value: `${p}` as const,
            label: t(`runs.per.${p}` as UiTextKey),
          }))}
          value={`${chosen.per}`}
          onChange={(p) => setRunsView({ per: Number(p) as RunPeriod })}
        />
        <div className="flex-1" />
        <span className="text-[12.5px] text-muted max-md:hidden">{t('runs.note')}</span>
      </div>
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
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="check"
            title={t('runs.empty')}
            text={t(chosen.imp ? 'runs.empty.imp' : 'runs.empty.all')}
          />
        }
        rowKey={(r) => r.id}
        titleKey="title"
        rowTone={(r) => (r.status === 'error' ? 'overdue' : undefined)}
        label={t('tab.runs.runs')}
        labels={labels}
        actions={actions}
        onOpen={(r) => card.open(r.id)}
      />
      {card.node}
    </div>
  );
}
