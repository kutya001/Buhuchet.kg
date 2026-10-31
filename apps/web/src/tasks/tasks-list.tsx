'use client';

import { formatCount, type GridKey, type ListFilterValue, type UiTextKey } from '@buhuchet/domain';
import { ListValues, TaskList, type TaskListRow, type TaskSummary } from '@buhuchet/shared';
import { DataGrid, EmptyState, Plate, Plates, Tag } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useTaskActions } from './task-actions';
import {
  TASK_AUDIT,
  TASK_DEFAULT_SORT,
  TASK_DEFAULT_VISIBLE,
  taskColumns,
  taskStripe,
  taskTone,
} from './task-columns';
import { taskSummaryQuery } from './tasks-data';

export type TaskTab = 'mine' | 'byme' | 'all' | 'overdue';

/** Фильтр плашки «На подтверждении» (прототип `renderTasks`: `status: ['На подтверждении']`). */
const PENDING_FILTER: Record<string, ListFilterValue> = {
  status: { type: 'enum', vals: ['on_confirm'] },
};

const pendingOn = (filters: Record<string, ListFilterValue>) => {
  const f = filters.status;
  return f?.type === 'enum' && f.vals.includes('on_confirm');
};

/** «С октября 2026, вперёд и всё просроченное» (прототип `ymG`). */
function rangeText(t: Translate, tab: TaskTab, monthStart: string | undefined): string | null {
  if (tab === 'overdue') return t('task.range.overdue');
  if (!monthStart) return null;
  const [year, month] = monthStart.split('-');
  const name = t(`rule.month_gen.${Number(month)}` as UiTextKey);
  return t('task.range.from', { month: `${name} ${year}` });
}

/**
 * «Отчёты мои / всех за месяц: сдано N из M» с полосой (прототип `renderTasks`): регулярные задачи
 * текущего месяца; на «Поставленных мной» и без регулярных задач месяца строки нет.
 */
function MonthProgress({ t, tab, summary }: { t: Translate; tab: TaskTab; summary?: TaskSummary }) {
  if (!summary || tab === 'byme') return null;
  const p = tab === 'mine' ? summary.progress.mine : summary.progress.all;
  if (!p.total) return null;
  const pct = Math.round((p.done / p.total) * 100);
  return (
    <div data-task-progress="" className="flex min-w-[260px] flex-col gap-1 max-md:w-full">
      <span className="text-[11.5px] leading-[1.4] text-faint">
        {t(tab === 'mine' ? 'task.reg.progress.mine' : 'task.reg.progress.all')}{' '}
        <b>{t('task.reg.progress.done', { done: p.done, total: p.total })}</b>
      </span>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-pane-alt shadow-[inset_0_0_0_1px_var(--bu-border)]"
      >
        <i className="block h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** «+ Добавить» → «Задача» в модуле «Задачи» (прототип `taskAdd`) — на любой вкладке. */
function useTaskAddRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'tasks' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'task') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * «Задачи» → вкладка (ТЗ «Модуль Задачи»; прототип modules/tasks.js, `renderTasks`): плашка-фильтр «На
 * подтверждении» (тем, кто ставит или подтверждает задачи; «можете подтвердить: N»), над списком —
 * метки «День» и «Месяц» и «С <месяц>, вперёд и всё просроченное»; общий список с поиском, фильтрами,
 * группировкой и «В Excel» (в файле всегда есть «Вид задачи»). Полоска слева у строки — вид срока,
 * просроченные — красным, закрытые — приглушённо. Строка открывает карточку задачи; действия — «⋯»,
 * долгим нажатием и правым кликом. Пока задач в организации нет — подсказка первого входа. Регулярные
 * задачи по отчётам — в том же списке, справа над ним — «Отчёты за месяц: сдано N из M» (задача 2.24).
 */
export function TasksList({ tab }: { tab: TaskTab }) {
  const t = useT();
  const gridKey: GridKey = `tasks.${tab}`;
  const labels = useGridLabels('task.count');
  const columns = useMemo(() => taskColumns(t), [t]);
  const view = useViewSettings(gridKey);
  const stats = useModuleStats('tasks');
  const summary = useQuery(taskSummaryQuery);
  const { search, clearSearch, access } = useShell();
  const fetchPage = useCallback<FetchListPage<TaskListRow>>(
    async (params) => {
      const res = await api.api.tasks.$get({ query: { ...params, tab } });
      if (!res.ok) throw await apiFailure(res);
      return TaskList.parse(await res.json());
    },
    [tab],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.tasks.values.$get({ query: q ? { col, q, tab } : { col, tab } });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [tab],
  );
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible: TASK_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: TASK_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.tasks.export.$get({ query: { ...params, tab, cols: visible.join(',') } }),
    [params, visible, tab],
  );
  const exporter = useListExport(sendExport);
  const tasks = useTaskActions();
  const canCreate = access.can('tasksCreate');
  useTaskAddRequest(() => tasks.newTask());

  const s = summary.data;
  const pending = pendingOn(list.filters);
  const plates = canCreate || access.can('tasksConfirm');
  const range = rangeText(t, tab, s?.monthStart);
  const empty =
    s?.empty && tab !== 'overdue' ? (
      <EmptyState
        icon="task"
        title={t('task.empty.first')}
        actions={
          canCreate
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
    ) : (
      <EmptyState
        icon="ok"
        title={t(tab === 'overdue' ? 'task.empty.overdue' : 'task.empty')}
        actions={
          canCreate && tab !== 'overdue'
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
    );

  return (
    <div className="flex flex-col gap-3.5">
      {plates ? (
        <Plates shown={stats.shown}>
          <Plate
            id="pend"
            icon="hourglass"
            color={s?.pending ? 'purple' : 'green'}
            label={t('task.plate.pending')}
            value={s ? formatCount(s.pending) : ''}
            sub={
              s?.pending
                ? t('task.plate.pending_sub', { n: s.canConfirm })
                : t('task.plate.pending_none')
            }
            on={pending}
            onClick={() => list.setFilters(pending ? {} : PENDING_FILTER)}
          />
        </Plates>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span
          data-task-legend=""
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"
        >
          <Tag tone="info">{t('task.kind.day')}</Tag> {t('task.legend.day')}
          <span className="ml-2">
            <Tag tone="violet">{t('task.kind.month')}</Tag>
          </span>{' '}
          {t('task.legend.month')}
        </span>
        {range ? (
          <span data-task-range="" className="text-[13px] text-muted">
            {range}
          </span>
        ) : null}
        <div className="flex-1" />
        <MonthProgress t={t} tab={tab} summary={s} />
      </div>
      <DataGrid
        columns={columns}
        audit={TASK_AUDIT}
        defaultVisible={TASK_DEFAULT_VISIBLE}
        defaultSort={TASK_DEFAULT_SORT}
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
        titleKey="title"
        rowTone={taskTone}
        rowStripe={taskStripe}
        label={t('nav.tasks')}
        labels={labels}
        actions={tasks.actions}
        onOpen={tasks.openCard}
      />
      {tasks.dialogs}
    </div>
  );
}
