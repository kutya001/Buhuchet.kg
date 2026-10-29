'use client';

import {
  formatCount,
  formatDateRu,
  formatSom,
  type GridKey,
  type UiTextKey,
} from '@buhuchet/domain';
import { ListValues, ReportList, type ReportQuick, type ReportRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  PHONE_QUERY,
  Plate,
  Plates,
  useMediaQuery,
  type PlateProps,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { moduleHref, tabHref } from '../shell/modules';
import { useReportActions, useReportAddRequest } from './report-actions';
import { isPlateFilter, plateFilters, type PlateFilter } from './report-plates';
import {
  REPORT_AUDIT,
  REPORT_DEFAULT_SORT,
  reportColumns,
  reportDefaultVisible,
  reportTone,
} from './report-columns';
import { reportSummaryQuery, type ReportListTab } from './reports-data';

/**
 * Быстрый фильтр «Все / Сдать / Уплатить» (прототип `S.repAct`): один на все вкладки модуля, до
 * перезагрузки страницы — соседняя вкладка при свайпе показывает тот же выбор.
 */
let quickNow: ReportQuick = 'all';
const quickListeners = new Set<() => void>();
const quickStore = {
  subscribe: (listener: () => void) => {
    quickListeners.add(listener);
    return () => void quickListeners.delete(listener);
  },
  get: () => quickNow,
  set: (q: ReportQuick) => {
    quickNow = q;
    for (const listener of quickListeners) listener();
  },
};

const QUICK: readonly ReportQuick[] = ['all', 'sub', 'pay'];

/** «октябрь 2026», «за октябрь» — название месяца строчными (прототип ymLabel, MONTHS). */
function monthName(t: Translate, month: string): string {
  return t(`report.month.${Number(month.slice(5, 7))}` as UiTextKey).toLowerCase();
}

/**
 * «Отчеты для сдачи» → вкладка «На неделе», «Просрочено», «Ожидают подтверждения» или «Все отчёты»
 * (ТЗ «Отчеты для сдачи» → «Вкладки модуля», плашки, столбцы, «Метка «Что нужно сделать»»; прототип
 * modules/reports.js, `renderReports`): плашки-итоги (клик ставит вкладку или фильтр), быстрый фильтр
 * «Все / Сдать / Уплатить» с числами, общий список с поиском, фильтрами, группировкой, итогом сумм и «В
 * Excel». Просроченные строки — красным со значком, «Не требуется» — приглушённо. Карточки отчёта пока
 * нет (задача 2.14): строка открывает меню действий. Пока отчётов в организации нет — подсказка первого
 * входа.
 */
export function ReportsList({ tab }: { tab: ReportListTab }) {
  const t = useT();
  const router = useRouter();
  const plateParam = useSearchParams().get('plate');
  const gridKey: GridKey = `reports.${tab}`;
  const labels = useGridLabels('report.count');
  const phone = useMediaQuery(PHONE_QUERY);
  const { search, clearSearch, access } = useShell();
  const summary = useQuery(reportSummaryQuery);
  const s = summary.data;
  const waiting = tab === 'waiting';
  const columns = useMemo(
    () =>
      reportColumns(t, {
        waiting,
        confirm: access.reportConfirm,
        waitDays: s?.waitDays ?? 3,
        phone,
      }),
    [t, waiting, access.reportConfirm, s?.waitDays, phone],
  );
  const defaultVisible = useMemo(() => reportDefaultVisible(waiting), [waiting]);
  const view = useViewSettings(gridKey);
  const stats = useModuleStats('reports');
  const quick = useSyncExternalStore(quickStore.subscribe, quickStore.get, () => 'all' as const);
  const extra = useMemo(() => ({ tab, quick }), [tab, quick]);
  const fetchPage = useCallback<FetchListPage<ReportRow>>(async (params) => {
    const res = await api.api.reports.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return ReportList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.reports.values.$get({
        query: q ? { col, q, tab, quick } : { col, tab, quick },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [tab, quick],
  );
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible,
    settings: view.settings,
    defaultSort: REPORT_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible, setFilters } = list;
  const sendExport = useCallback(
    () => api.api.reports.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const reports = useReportActions();
  useReportAddRequest(reports.newReport);

  // Плашка с другой вкладки: фильтр на «Все отчёты» и адрес без `?plate=`.
  useEffect(() => {
    if (tab !== 'all' || !s || !isPlateFilter(plateParam)) return;
    setFilters(plateFilters(plateParam, s.month));
    router.replace(tabHref('reports', 'all'), { scroll: false });
  }, [tab, s, plateParam, setFilters, router]);

  const goPlate = (plate: PlateFilter) => {
    if (!s) return;
    if (tab === 'all') setFilters(plateFilters(plate, s.month));
    else router.push(`${tabHref('reports', 'all')}?plate=${plate}`);
  };
  const goTab = (to: ReportListTab) => {
    if (to !== tab) router.push(tabHref('reports', to));
  };

  const plates: PlateProps[] = s
    ? [
        {
          id: 'overdue',
          icon: 'alert',
          color: s.overdue ? 'red' : 'green',
          label: t('report.plate.overdue'),
          value: formatCount(s.overdue),
          sub: t('report.plate.overdue_sub'),
          on: tab === 'overdue',
          onClick: () => goTab('overdue'),
        },
        {
          id: 'week',
          icon: 'calendar',
          color: 'yellow',
          label: t('report.plate.week'),
          value: formatCount(s.week),
          sub: t('report.plate.week_sub', {
            from: formatDateRu(s.weekFrom).slice(0, 5),
            to: formatDateRu(s.weekTo).slice(0, 5),
          }),
          on: tab === 'week',
          onClick: () => goTab('week'),
        },
        ...(access.reportConfirm
          ? [
              {
                id: 'waiting',
                icon: 'hourglass',
                color: 'blue',
                label: t('report.plate.waiting'),
                value: formatCount(s.waiting),
                sub: t('report.plate.waiting_sub'),
                on: tab === 'waiting',
                onClick: () => goTab('waiting'),
              } satisfies PlateProps,
            ]
          : []),
        {
          id: 'subm',
          icon: 'ok',
          color: 'green',
          label: t('report.plate.submitted'),
          value: formatCount(s.submittedMonth),
          sub: t('report.plate.month', {
            month: monthName(t, s.month),
            y: s.month.slice(0, 4),
          }),
          onClick: () => goPlate('submitted'),
        },
        {
          // «оплачено N» под суммой добавит задача 2.19 вместе с оплатами.
          id: 'sum',
          icon: 'coins',
          color: 'purple',
          label: t('report.plate.to_pay', { month: monthName(t, s.month) }),
          value: formatSom(Math.round(s.toPayMonth / 100) * 100, 'auto'),
          unit: t('report.plate.som'),
          onClick: () => goPlate('to_pay'),
        },
      ]
    : [];

  const quickCounts = s?.quick[tab];
  const empty = s?.empty ? (
    <EmptyState
      icon="file"
      title={t('report.empty.first')}
      text={t('report.empty.first_text')}
      actions={[
        {
          id: 'cps',
          icon: 'building',
          label: t('report.empty.go_cps'),
          primary: true,
          onClick: () => router.push(moduleHref('cps', access)),
        },
      ]}
    />
  ) : (
    <EmptyState
      icon="ok"
      title={t(
        tab === 'week'
          ? 'report.empty.week'
          : tab === 'overdue'
            ? 'report.empty.overdue'
            : tab === 'waiting'
              ? 'report.empty.waiting'
              : 'report.empty',
      )}
      {...(tab === 'overdue' ? { text: t('report.empty.overdue_text') } : {})}
    />
  );

  return (
    <div className="flex flex-col gap-3.5">
      {plates.length ? (
        <Plates shown={stats.shown}>
          {plates.map((p) => (
            <Plate key={p.id} {...p} />
          ))}
        </Plates>
      ) : null}
      <div
        role="group"
        aria-label={t('report.quick.label')}
        data-report-quick=""
        className="flex flex-wrap gap-1.5"
      >
        {QUICK.map((q) => {
          const on = q === quick;
          return (
            <button
              key={q}
              type="button"
              data-quick={q}
              aria-pressed={on}
              onClick={() => quickStore.set(q)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-[550] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? 'border-transparent bg-accent text-on-accent shadow-cta' : 'border-line bg-raised text-muted'}`}
            >
              {t(`report.quick.${q}`)}
              {quickCounts ? (
                <span className="ml-1 tabular-nums opacity-70">{formatCount(quickCounts[q])}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <DataGrid
        columns={columns}
        audit={REPORT_AUDIT}
        defaultVisible={defaultVisible}
        defaultSort={REPORT_DEFAULT_SORT}
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
        empty={empty}
        rowKey={(r) => r.id}
        titleKey="cp"
        rowTone={reportTone}
        label={t('nav.reports')}
        labels={labels}
        actions={reports.actions}
        openMenu
      />
      {reports.dialogs}
    </div>
  );
}
