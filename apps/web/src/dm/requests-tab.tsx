'use client';

import { formatCount, formatMomentRu, type ListFilterValue, type ListSort } from '@buhuchet/domain';
import type { DmRequestRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  Plate,
  Plates,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import {
  DM_REQUEST_GRID,
  exportRequests,
  fetchRequests,
  fetchRequestValues,
  requestSummaryQuery,
} from './requests-data';
import { useTokenActions } from './token-dialogs';

/** Сначала новые (прототип `sort: {key: 'at', dir: -1}`). */
const DEFAULT_SORT: ListSort = { key: 'at', dir: 'desc' };
const NUM = 'tabular-nums';
const DASH = <span className="text-faint">—</span>;
const num = (n: number | null) => (n === null ? '' : String(n));

/** «Итог: Ошибка» — плашка «Ошибок сегодня» (значение фильтра — как на сервере). */
const ERRORS_FILTER: Record<string, ListFilterValue> = { res: { type: 'enum', vals: ['err'] } };

/** Столбцы журнала — как в прототипе (`renderDmLog`, grid `dm-log`), ключи — как на сервере. */
export function requestColumns(t: Translate): GridColumn<DmRequestRow>[] {
  return [
    {
      key: 'at',
      label: t('dm.log.col.at'),
      type: 'datetime',
      width: 145,
      text: (x) => formatMomentRu(new Date(x.at)),
      className: NUM,
    },
    {
      key: 'res',
      label: t('dm.log.col.res'),
      type: 'enum',
      width: 120,
      text: (x) => t(x.ok ? 'dm.res.ok' : 'dm.res.error'),
      cell: (x) => (
        <Pill tone={x.ok ? 'ok' : 'bad'} icon={x.ok ? 'check' : 'alert'}>
          {t(x.ok ? 'dm.res.ok' : 'dm.res.error')}
        </Pill>
      ),
    },
    { key: 'org', label: t('dm.log.col.org'), type: 'enum', width: 210, text: (x) => x.orgName },
    {
      key: 'tok',
      label: t('dm.log.col.tok'),
      type: 'text',
      width: 220,
      text: (x) => x.tokenName ?? '',
      cell: (x) =>
        x.tokenName ? (
          <>
            {x.tokenName}
            {x.prefix ? <div className={`${MONO_CLASS} text-faint`}>{`${x.prefix}…`}</div> : null}
          </>
        ) : (
          DASH
        ),
    },
    {
      key: 'tpl',
      label: t('dm.log.col.tpl'),
      type: 'enum',
      width: 220,
      text: (x) => x.tplName ?? '',
    },
    {
      key: 'params',
      label: t('dm.log.col.params'),
      type: 'text',
      width: 250,
      text: (x) => x.params,
      className: MONO_CLASS,
    },
    {
      key: 'rows',
      label: t('dm.log.col.rows'),
      type: 'int',
      width: 90,
      text: (x) => num(x.rows),
    },
    { key: 'ms', label: t('dm.log.col.ms'), type: 'int', width: 100, text: (x) => num(x.ms) },
    {
      key: 'err',
      label: t('dm.log.col.err'),
      type: 'text',
      width: 260,
      text: (x) => x.error ?? '',
    },
    {
      key: 'ip',
      label: t('dm.log.col.ip'),
      type: 'text',
      width: 140,
      text: (x) => x.ip ?? '',
      className: MONO_CLASS,
    },
  ];
}

/**
 * Админка → «Витрина данных» → «Журнал запросов» (доработки 20.11.2026: Витрина данных, блок 6,
 * пункт 7; поток Т, этап 2, П11; прототип v155 `renderDmLog`): плашки «Запросов сегодня» (нажатие —
 * без фильтров), «Ошибок сегодня» (фильтр «Итог: Ошибка»), «Действующих токенов» (вкладка «API
 * Токены»); все запросы внешних программ по токенам за 90 дней, сначала новые. Строка открывает окно
 * токена. Только просмотр.
 */
export function RequestsTab() {
  const t = useT();
  const router = useRouter();
  const labels = useGridLabels('dm.log.count');
  const columns = useMemo(() => requestColumns(t), [t]);
  const visible = useMemo(() => columns.map((c) => c.key), [columns]);
  const view = useViewSettings(DM_REQUEST_GRID);
  const stats = useModuleStats('dm');
  const summary = useQuery(requestSummaryQuery);
  const tokens = useTokenActions('admin');
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: DM_REQUEST_GRID,
    columns,
    audit: false,
    defaultVisible: visible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchRequests,
  });
  const { params } = list;
  const sendExport = useCallback(
    () => exportRequests({ ...(params as Record<string, string>), cols: list.visible.join(',') }),
    [params, list.visible],
  );
  const exporter = useListExport(sendExport);

  const s = summary.data;
  const count = (n: number | undefined) => (n === undefined ? '' : formatCount(n));

  return (
    <div data-dm-log="" className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        <Plate
          id="all"
          icon="history"
          color="blue"
          label={t('dm.log.plate.today')}
          value={count(s?.today)}
          onClick={() => list.setFilters({})}
        />
        <Plate
          id="err"
          icon="alert"
          color={s?.errors ? 'red' : 'green'}
          label={t('dm.log.plate.errors')}
          value={count(s?.errors)}
          onClick={() => list.setFilters(ERRORS_FILTER)}
        />
        <Plate
          id="tok"
          icon="key"
          color="purple"
          label={t('dm.log.plate.tokens')}
          value={count(s?.tokens)}
          onClick={() => router.push(tabHref('dm', 'tok'))}
        />
      </Plates>
      <DataGrid
        columns={columns}
        defaultVisible={visible}
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
        loadValues={fetchRequestValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={
          <EmptyState
            icon="history"
            title={t('dm.log.empty_title')}
            text={t('dm.log.empty_text')}
          />
        }
        rowKey={(x) => String(x.id)}
        titleKey="tok"
        label={t('tab.dm.log')}
        labels={labels}
        onOpen={(x) => {
          if (x.tokenId) tokens.open(x.tokenId);
        }}
      />
      {tokens.node}
    </div>
  );
}
