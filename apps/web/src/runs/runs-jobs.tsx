'use client';

import { formatCount, formatMomentRu, type ListSort } from '@buhuchet/domain';
import type { AdminJobRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  MONO_CLASS,
  Pill,
  Plate,
  Plates,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { api } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { presetHref } from '../lists/preset';
import { useModuleStats } from '../lists/stats';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { RunStatusPill } from './run-card';
import { fetchJobs, fetchJobValues, jobSummaryQuery } from './runs-data';
import {
  JOB_PILL,
  jobPlateColors,
  jobStateFilter,
  RUN_ERRORS_FILTER,
  runsOfJobFilter,
} from './runs-model';
import { setRunsView } from './runs-store';

/** Сначала «Падает» и «Не запускалась» (прототип `sort: {key: 'st', dir: 1}`). */
const DEFAULT_SORT: ListSort = { key: 'st', dir: 'asc' };
const DEFAULT_VISIBLE = ['title', 'every', 'last', 'ok', 'fails', 'st'];
const NUM = 'tabular-nums';
const DASH = <span className="text-faint">—</span>;
const moment = (iso: string | null) => (iso ? formatMomentRu(new Date(iso)) : '');

/** Столбцы задач — как в прототипе (admin/runs.js, grid 'run-jobs'), ключи — как на сервере. */
export function jobColumns(t: Translate): GridColumn<AdminJobRow>[] {
  return [
    {
      key: 'title',
      label: t('runs.col.title'),
      type: 'text',
      width: 250,
      text: (j) => j.title,
      cell: (j) => <span className="font-semibold">{j.title}</span>,
    },
    { key: 'every', label: t('runs.col.every'), type: 'enum', width: 170, text: (j) => j.every },
    {
      key: 'last',
      label: t('runs.col.last'),
      type: 'datetime',
      width: 225,
      text: (j) =>
        j.lastAt && j.lastStatus ? `${moment(j.lastAt)} ${t(`runs.st.${j.lastStatus}`)}` : '',
      cell: (j) =>
        j.lastAt && j.lastStatus ? (
          <>
            <span className={NUM}>{moment(j.lastAt)}</span>{' '}
            <RunStatusPill t={t} status={j.lastStatus} />
          </>
        ) : (
          DASH
        ),
    },
    {
      key: 'ok',
      label: t('runs.col.ok'),
      type: 'datetime',
      width: 140,
      text: (j) => moment(j.okAt),
      cell: (j) => (j.okAt ? moment(j.okAt) : DASH),
      className: NUM,
    },
    {
      key: 'fails',
      label: t('runs.col.fails'),
      type: 'int',
      width: 110,
      numeric: true,
      text: (j) => formatCount(j.fails),
    },
    {
      key: 'st',
      label: t('runs.col.state'),
      type: 'enum',
      width: 160,
      text: (j) => t(`runs.state.${j.state}`),
      cell: (j) => (
        <Pill tone={JOB_PILL[j.state].tone} icon={JOB_PILL[j.state].icon}>
          {t(`runs.state.${j.state}`)}
        </Pill>
      ),
    },
    { key: 'what', label: t('runs.col.what'), type: 'text', width: 360, text: (j) => j.what },
    {
      key: 'name',
      label: t('runs.col.name'),
      type: 'text',
      width: 250,
      text: (j) => j.name,
      className: MONO_CLASS,
    },
  ];
}

/**
 * Админка → «Запуски» → «Задачи» (решение заказчика 17.11.2026; прототип v132 admin/runs.js
 * `renderRuns`): плашки «Работают N из M», «Падают», «Не запускались» (нажатие — фильтр по состоянию)
 * и «Ошибок за сутки» (нажатие — журнал запусков с ошибками за сегодня); список задач по расписанию,
 * падающие — красным и первыми. Нажатие на задачу — её запуски. Только просмотр.
 */
export function RunsJobs() {
  const t = useT();
  const router = useRouter();
  const labels = useGridLabels('runs.jobs.count');
  const columns = useMemo(() => jobColumns(t), [t]);
  const view = useViewSettings('runs.jobs');
  const stats = useModuleStats('runs');
  const summary = useQuery(jobSummaryQuery);
  const { search, clearSearch } = useShell();
  const list = useListPage({
    gridKey: 'runs.jobs',
    columns,
    audit: false,
    defaultVisible: DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchJobs,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.admin.runs.jobs.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  // Запуски задачи — «Все»: у ежеминутных задач почти все запуски пустые, в «Важных» их не видно.
  const toRuns = (job: AdminJobRow, week: boolean) => {
    setRunsView(week ? { imp: false, per: 7 } : { imp: false });
    router.push(presetHref('runs', 'runs', runsOfJobFilter(job.name)));
  };
  const actions = (job: AdminJobRow): ActionEntry[] => [
    { id: 'runs', label: t('runs.menu.runs'), icon: 'history', run: () => toRuns(job, false) },
  ];

  const s = summary.data;
  const colors = jobPlateColors(s);
  const count = (n: number | undefined) => (n === undefined ? '' : formatCount(n));

  return (
    <div data-runs-jobs="" className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        <Plate
          id="ok"
          icon="check"
          color={colors.ok}
          label={t('runs.plate.ok')}
          value={s ? t('runs.plate.ok_value', { n: s.ok, total: s.total }) : ''}
          onClick={() => list.setFilters(jobStateFilter('ok'))}
        />
        <Plate
          id="fail"
          icon="alert"
          color={colors.fail}
          label={t('runs.plate.fail')}
          value={count(s?.failing)}
          sub={t('runs.plate.fail_sub')}
          onClick={() => list.setFilters(jobStateFilter('failing'))}
        />
        <Plate
          id="miss"
          icon="clock"
          color={colors.miss}
          label={t('runs.plate.miss')}
          value={count(s?.missed)}
          sub={t('runs.plate.miss_sub')}
          onClick={() => list.setFilters(jobStateFilter('missed'))}
        />
        <Plate
          id="err"
          icon="alert"
          color={colors.err}
          label={t('runs.plate.err')}
          value={count(s?.dayErrors)}
          onClick={() => {
            setRunsView({ imp: true, per: 1 });
            router.push(presetHref('runs', 'runs', RUN_ERRORS_FILTER));
          }}
        />
      </Plates>
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
        loadValues={fetchJobValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={() => void exporter.run()}
        exporting={exporter.exporting}
        empty={<EmptyState icon="clock" title={t('grid.empty')} />}
        rowKey={(j) => j.name}
        titleKey="title"
        rowTone={(j) => (j.state === 'failing' ? 'overdue' : undefined)}
        label={t('tab.runs.jobs')}
        labels={labels}
        actions={actions}
        onOpen={(j) => toRuns(j, true)}
      />
    </div>
  );
}
