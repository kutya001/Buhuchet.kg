'use client';

import { formatDateRu, formatMomentRu, type GridKey, type ListSort } from '@buhuchet/domain';
import { ListValues, SeriesList as SeriesListPage, type SeriesListRow } from '@buhuchet/shared';
import {
  DataGrid,
  EmptyState,
  Icon,
  Pill,
  type GridColumn,
  type GridRowTone,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { seriesById, useSeriesActions } from './series-actions';
import { useTaskActions } from './task-actions';
import { useTaskAddRequest } from './tasks-list';

/** «Повторы» — по ближайшей дате, остановленные и завершённые в конце (прототип `tsRender`). */
export const SERIES_DEFAULT_SORT: ListSort = { key: 'next', dir: 'asc' };

/** Видимые по умолчанию — как в прототипе: «Поставил», «Создано», «Поставлено задач» скрыты. */
export const SERIES_DEFAULT_VISIBLE = ['title', 'rule', 'exec', 'cp', 'next', 'end', 'state'];

const STATE_TONE = { active: 'ok', stopped: 'warn', finished: 'plain' } as const;

/** Столбцы вкладки «Повторы» (прототип `tsRender`), ключи — как на сервере. */
export function seriesColumns(t: Translate): GridColumn<SeriesListRow>[] {
  const state = (r: SeriesListRow) => t(`task.series.state.${r.state}`);
  return [
    {
      key: 'title',
      label: t('task.col.title'),
      type: 'text',
      width: 300,
      text: (r) => r.title,
      cell: (r) => (
        <>
          <span className="mr-[5px] inline-flex align-[-2px] text-muted">
            <Icon name="repeat" size="sm" />
          </span>
          <span className="font-semibold">{r.title}</span>
        </>
      ),
    },
    { key: 'rule', label: t('task.col.repeat'), type: 'text', width: 270, text: (r) => r.text },
    {
      key: 'exec',
      label: t('task.col.exec'),
      type: 'enum',
      width: 130,
      text: (r) => r.executor.shortName,
    },
    {
      key: 'cp',
      label: t('task.col.cp'),
      type: 'enum',
      width: 190,
      text: (r) => r.contractor?.name ?? t('task.cp.general'),
      cell: (r) =>
        r.contractor ? (
          r.contractor.name
        ) : (
          <span className="text-faint">{t('task.series.general')}</span>
        ),
    },
    {
      key: 'next',
      label: t('task.series.col.next'),
      type: 'date',
      width: 130,
      text: (r) => (r.next ? formatDateRu(r.next) : ''),
    },
    { key: 'end', label: t('task.series.col.end'), type: 'enum', width: 140, text: (r) => r.end },
    {
      key: 'state',
      label: t('task.series.col.state'),
      type: 'enum',
      width: 170,
      text: (r) => (r.stopText ? `${state(r)} ${r.stopText}` : state(r)),
      cell: (r) => (
        <span data-series-state={r.state}>
          <Pill tone={STATE_TONE[r.state]} size="sm">
            {state(r)}
          </Pill>
          {r.stopText ? <span className="ml-1.5 text-muted">{r.stopText}</span> : null}
        </span>
      ),
    },
    { key: 'by', label: t('task.col.by'), type: 'enum', width: 120, text: (r) => r.author.shortName },
    {
      key: 'created',
      label: t('task.series.col.created'),
      type: 'date',
      width: 120,
      text: (r) => formatMomentRu(new Date(r.createdAt)),
    },
    {
      key: 'made',
      label: t('task.series.col.made'),
      type: 'int',
      width: 120,
      text: (r) => String(r.made),
    },
  ];
}

/** Действующие — как есть, остановленные и завершённые — приглушённо (прототип `rowClass`). */
const seriesTone = (r: SeriesListRow): GridRowTone | undefined =>
  r.state === 'active' ? undefined : 'muted';

/**
 * «Задачи» → «Повторы» (доработки 28.11.2026, блок 4, пункт 3; прототип modules/task-series.js,
 * `tsRender`): одна строка на серию — свои серии, владельцу и «Видеть задачи всех» — все. Строка
 * открывает ближайшую задачу серии; меню — «Открыть ближайшую задачу», «Изменить повтор», «Остановить
 * повтор» или «Возобновить», «Все задачи серии». Пока серий нет — подсказка, где настраивается повтор.
 */
export function SeriesList() {
  const t = useT();
  const gridKey: GridKey = 'tasks.series';
  const labels = useGridLabels('task.series.count');
  const columns = useMemo(() => seriesColumns(t), [t]);
  const view = useViewSettings(gridKey);
  const { search, clearSearch, access } = useShell();
  const client = useQueryClient();
  const fetchPage = useCallback<FetchListPage<SeriesListRow>>(async (params) => {
    const res = await api.api['task-series'].$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return SeriesListPage.parse(await res.json());
  }, []);
  const loadValues = useCallback(async (col: string, q?: string) => {
    const res = await api.api['task-series'].values.$get({ query: q ? { col, q } : { col } });
    if (!res.ok) throw await apiFailure(res);
    return ListValues.parse(await res.json());
  }, []);
  const tasks = useTaskActions();
  const series = useSeriesActions((id) => tasks.openById(id));
  useTaskAddRequest(() => tasks.newTask());
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible: SERIES_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: SERIES_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api['task-series'].export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const nearest = (r: SeriesListRow) => (r.task ? () => tasks.openById(r.task!) : null);
  const actions = (r: SeriesListRow) =>
    series.menu(r, nearest(r), () => seriesById(client, r.id));

  return (
    <div className="flex flex-col gap-3.5" data-series-list="">
      <DataGrid
        columns={columns}
        defaultVisible={SERIES_DEFAULT_VISIBLE}
        defaultSort={SERIES_DEFAULT_SORT}
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
        empty={
          <EmptyState
            icon="repeat"
            title={t('task.series.empty.title')}
            text={t('task.series.empty.text')}
            actions={
              access.can('tasksCreate')
                ? [
                    {
                      id: 'add',
                      icon: 'plus',
                      label: t('task.empty.add'),
                      primary: true,
                      onClick: () => tasks.newTask(),
                    },
                  ]
                : []
            }
          />
        }
        rowKey={(r) => r.id}
        titleKey="title"
        rowTone={seriesTone}
        label={t('tab.tasks.series')}
        labels={labels}
        actions={actions}
        onOpen={(r) => {
          if (r.task) tasks.openById(r.task);
        }}
      />
      {tasks.dialogs}
      {series.node}
    </div>
  );
}
