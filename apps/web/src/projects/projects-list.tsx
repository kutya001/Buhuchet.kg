'use client';

import {
  addDays,
  bishkekDate,
  formatCount,
  formatSom,
  type GridKey,
  type ListFilterValue,
} from '@buhuchet/domain';
import { ListValues, ProjectList, type ProjectRow } from '@buhuchet/shared';
import { DataGrid, EmptyState, Plate, Plates, useToast } from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useEffectEvent, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { useT } from '../l10n/provider';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { tabHref } from '../shell/modules';
import { useProjectActions } from './project-actions';
import {
  PROJECT_AUDIT,
  PROJECT_DEFAULT_SORT,
  PROJECT_DEFAULT_VISIBLE,
  projectColumns,
  projectTone,
} from './project-columns';
import { projectFormQuery, projectSummaryQuery } from './projects-data';

export type ProjectTab = 'active' | 'all' | 'mine';

type Filters = Readonly<Record<string, ListFilterValue>>;
type PlateId = 'run' | 'plan' | 'over' | 'left';

/**
 * Фильтры плашек (прототип `renderProjects`, `.plates.onclick`): плашка ставит свой фильтр вместо
 * прежних, нажатая ещё раз — снимает. «Срок прошёл» — «В работе» с окончанием до вчера; «Осталось
 * получить» — остаток от 1 сома.
 */
function plateFilters(id: PlateId, today: string): Filters {
  if (id === 'run') return { status: { type: 'enum', vals: ['in_progress'] } };
  if (id === 'plan') return { status: { type: 'enum', vals: ['planned'] } };
  if (id === 'over')
    return {
      status: { type: 'enum', vals: ['in_progress'] },
      to: { type: 'date', from: null, to: addDays(today, -1) },
    };
  return { left: { type: 'num', from: 100, to: null } };
}

const sameFilters = (a: Filters, b: Filters) => JSON.stringify(a) === JSON.stringify(b);

/** «+ Добавить» → «Проект» в модуле «Проекты контрагентов» (прототип `projAdd`). */
function useProjectAddRequest(run: () => void) {
  const { addRequest, clearAddRequest } = useShell();
  const request = addRequest?.moduleId === 'projects' ? addRequest : null;
  const start = useEffectEvent((actionId: string) => {
    if (actionId === 'project') run();
  });
  useEffect(() => {
    if (!request) return;
    start(request.actionId);
    clearAddRequest();
  }, [request, clearAddRequest]);
}

/**
 * «Проекты контрагентов» → вкладка (ТЗ «Модуль Проекты контрагентов»; прототип modules/projects.js,
 * `renderProjects`): плашки «В работе», «Планируются», «Срок прошёл», «Осталось получить» (тому, кто
 * видит деньги) — нажатие ставит фильтр списка; общий список с поиском, фильтрами, группировкой и «В
 * Excel». Срок прошёл — строка красным, завершённые и отменённые — приглушённо. Строка открывает
 * карточку проекта; действия — «⋯», долгим нажатием и правым кликом. Пока проектов в организации нет —
 * подсказка первого входа.
 */
export function ProjectsList({ tab }: { tab: ProjectTab }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const gridKey: GridKey = `projects.${tab}`;
  const labels = useGridLabels('proj.count');
  const summary = useQuery(projectSummaryQuery);
  const s = summary.data;
  const money = !!s?.can.money;
  const columns = useMemo(() => projectColumns(t, money), [t, money]);
  const view = useViewSettings(gridKey);
  const stats = useModuleStats('projects');
  const { search, clearSearch, access } = useShell();
  const fetchPage = useCallback<FetchListPage<ProjectRow>>(
    async (params) => {
      const res = await api.api.projects.$get({ query: { ...params, tab } });
      if (!res.ok) throw await apiFailure(res);
      return ProjectList.parse(await res.json());
    },
    [tab],
  );
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.projects.values.$get({
        query: q ? { col, q, tab } : { col, tab },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [tab],
  );
  const list = useListPage({
    gridKey,
    columns,
    defaultVisible: PROJECT_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: PROJECT_DEFAULT_SORT,
    search,
    enabled: view.ready && !!s,
    fetchPage,
  });
  const { params, visible, filters, setFilters } = list;
  const sendExport = useCallback(
    () => api.api.projects.export.$get({ query: { ...params, tab, cols: visible.join(',') } }),
    [params, visible, tab],
  );
  const exporter = useListExport(sendExport);
  const projects = useProjectActions();
  const canCreate = access.can('projects');
  useProjectAddRequest(() => projects.newProject());

  const today = bishkekDate(new Date());
  const plateOn = (id: PlateId) => sameFilters(filters, plateFilters(id, today));
  const goPlate = (id: PlateId) => setFilters(plateOn(id) ? {} : plateFilters(id, today));

  /** Прототип `needCp`: без контрагентов — подсказка и переход в «Контрагенты». */
  const firstAdd = async () => {
    const form = await client.fetchQuery(projectFormQuery(null)).catch(() => null);
    if (form && !form.contractors.length) {
      toast(t('proj.empty.need_cp'), { icon: 'info' });
      return router.push(tabHref('cps', 'all'));
    }
    projects.newProject();
  };

  const addAction = (onClick: () => void) => ({
    id: 'add',
    icon: 'plus' as const,
    label: t('proj.empty.add'),
    primary: true,
    onClick,
  });
  // Прототип (`grid` → `firstEmpty`): в организации ещё нет проектов — подсказка первого входа на
  // любой вкладке.
  const empty =
    s && !s.any ? (
      <EmptyState
        icon="briefcase"
        title={t('proj.empty.first')}
        text={t('proj.empty.first_text')}
        actions={canCreate ? [addAction(() => void firstAdd())] : []}
      />
    ) : (
      <EmptyState
        icon="briefcase"
        title={t(tab === 'mine' ? 'proj.empty.mine' : 'proj.empty')}
        text={t('proj.empty.text')}
        actions={canCreate && tab !== 'mine' ? [addAction(() => projects.newProject())] : []}
      />
    );

  return (
    <div className="flex flex-col gap-3.5">
      <Plates shown={stats.shown}>
        <Plate
          id="run"
          icon="hourglass"
          color="yellow"
          label={t('proj.plate.run')}
          value={s ? formatCount(s.inProgress) : ''}
          on={plateOn('run')}
          onClick={() => goPlate('run')}
        />
        <Plate
          id="plan"
          icon="clock"
          color="blue"
          label={t('proj.plate.plan')}
          value={s ? formatCount(s.planned) : ''}
          on={plateOn('plan')}
          onClick={() => goPlate('plan')}
        />
        <Plate
          id="over"
          icon="alert"
          color={s?.overdue ? 'red' : 'green'}
          label={t('proj.plate.over')}
          value={s ? formatCount(s.overdue) : ''}
          sub={t(s?.overdue ? 'proj.plate.over_sub' : 'proj.plate.over_none')}
          on={plateOn('over')}
          onClick={() => goPlate('over')}
        />
        {money && s?.left != null ? (
          <Plate
            id="left"
            icon="wallet"
            color="purple"
            label={t('proj.plate.left')}
            value={formatSom(s.left, 'auto')}
            unit={t('report.plate.som')}
            sub={t('proj.plate.left_sub')}
            on={plateOn('left')}
            onClick={() => goPlate('left')}
          />
        ) : null}
      </Plates>
      <DataGrid
        columns={columns}
        audit={PROJECT_AUDIT}
        defaultVisible={PROJECT_DEFAULT_VISIBLE}
        defaultSort={PROJECT_DEFAULT_SORT}
        settings={view.settings}
        onSettingsChange={view.save}
        onResetView={() => void view.reset()}
        data={view.ready ? list.data : undefined}
        onPageChange={list.setPage}
        error={list.error}
        errorText={list.errorText}
        errorTextOf={list.errorTextOf}
        onRetry={list.retry}
        filters={filters}
        onFiltersChange={setFilters}
        loadValues={loadValues}
        search={search}
        onClearSearch={clearSearch}
        onExport={access.can('export') ? () => void exporter.run() : undefined}
        exporting={exporter.exporting}
        empty={empty}
        rowKey={(r) => r.id}
        titleKey="name"
        rowTone={projectTone}
        label={t('nav.projects')}
        labels={labels}
        actions={projects.actions}
        onOpen={(r) => projects.openCard(r.id)}
      />
      {projects.dialogs}
    </div>
  );
}
