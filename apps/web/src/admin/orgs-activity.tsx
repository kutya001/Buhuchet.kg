'use client';

import {
  ACTIVITY_DEFAULT,
  bishkekDate,
  formatCount,
  type ActivityKind,
  type ActivityPeriod,
  type ListSort,
} from '@buhuchet/domain';
import {
  ListValues,
  OrgActivityList,
  OrgActivityOverview,
  type OrgActivityRow,
} from '@buhuchet/shared';
import {
  Box,
  DataGrid,
  EmptyState,
  linkButtonClass,
  Note,
  Pill,
  Plate,
  Plates,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { closeSlot, openSlot, type DialogSlot } from '../dialog-slot';
import { ActivityChart, Faint, momentText, num, PeriodBar } from '../home/home-activity';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useAdminCards } from './admin-cards';
import { NewOrganizationDialog } from './new-org-dialog';
import { ORG_ACTIVITY_KEY, useOrgsRefresh } from './org-actions';
import { useOrgsAddRequest } from './orgs-list';

const GRID_KEY = 'orgs.act';

/** По умолчанию — по «Действий», от больших (прототип `sort: {key: 'n', dir: -1}`). */
const SORT: ListSort = { key: 'n', dir: 'desc' };

const VISIBLE = ['name', 'st', 'last', 'users', 'staff', 'days', 'in', 'n', 'sub', 'cps'];

/**
 * Период вкладки (прототип `S.oact`): один на страницу до её перезагрузки — вернувшись на вкладку,
 * администратор видит тот же период.
 */
let chosen: ActivityPeriod | null = null;

/** Плашки и столбики за период. */
const overviewQuery = (p: ActivityPeriod) =>
  queryOptions({
    queryKey: [...ORG_ACTIVITY_KEY, p.k, p.off],
    queryFn: async () => {
      const res = await api.api.admin['org-activity'].summary.$get({
        query: { k: p.k, off: String(p.off) },
      });
      if (!res.ok) throw await apiFailure(res);
      return OrgActivityOverview.parse(await res.json());
    },
    staleTime: 0,
  });

/** Столбцы списка (прототип: сетка `adm-org-act`). */
function columnsOf(t: Translate): GridColumn<OrgActivityRow>[] {
  type NumKey = 'users' | 'staff' | 'days' | 'in' | 'n' | 'sub' | 'cps';
  const number = (key: NumKey, width: number): GridColumn<OrgActivityRow> => ({
    key,
    label: t(`orgs.act.col.${key}`),
    type: 'int',
    width,
    numeric: true,
    text: (r) => String(r[key]),
    cell: (r) => num(r[key]),
  });
  return [
    {
      key: 'name',
      label: t('orgs.act.col.name'),
      type: 'text',
      width: 270,
      text: (r) => r.name,
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      key: 'st',
      label: t('orgs.act.col.st'),
      type: 'enum',
      width: 140,
      text: (r) => t(r.active ? 'orgs.active' : 'orgs.blocked'),
      cell: (r) => (
        <Pill tone={r.active ? 'ok' : 'bad'} size="sm">
          {t(r.active ? 'orgs.active' : 'orgs.blocked')}
        </Pill>
      ),
    },
    {
      key: 'last',
      label: t('orgs.act.col.last'),
      type: 'datetime',
      width: 170,
      text: (r) => (r.last ? momentText(r.last) : t('home.act.never')),
      cell: (r) => (r.last ? momentText(r.last) : <Faint>{t('home.act.never')}</Faint>),
    },
    number('users', 180),
    number('staff', 146),
    number('days', 150),
    number('in', 90),
    number('n', 100),
    number('sub', 126),
    number('cps', 150),
  ];
}

/**
 * Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `renderOrgAct`):
 * выбор периода (день, неделя, месяц, год), плашки — организаций с активностью из стольких, работали
 * пользователей, входов, действий, сдано отчётов и новых контрагентов, столбики «Действия по дням»
 * (за год — по месяцам; за день их нет) и список организаций с числами за период. Данных организаций
 * здесь нет — только числа. Строка открывает карточку организации; «+ Добавить» — «Новая организация».
 * После создания, блокировки и разблокировки (кнопки шапки карточки) список и плашки перечитываются.
 */
export function OrgsActivity() {
  const t = useT();
  const { search, clearSearch } = useShell();
  const stats = useModuleStats('orgs');
  const labels = useGridLabels('orgs.count');
  const [p, setP] = useState<ActivityPeriod>(() => chosen ?? ACTIVITY_DEFAULT);
  const choose = (next: ActivityPeriod) => {
    chosen = next;
    setP(next);
  };
  const overview = useQuery({ ...overviewQuery(p), placeholderData: keepPreviousData });
  const v = overview.data;
  // «Сегодня» — по ответу сервера; пока ответа нет — по часам устройства.
  const today = v?.today ?? bishkekDate(new Date());

  const columns = useMemo(() => columnsOf(t), [t]);
  const view = useViewSettings(GRID_KEY);
  const extra = useMemo(() => ({ k: p.k, off: String(p.off) }), [p.k, p.off]);
  const fetchPage = useCallback<FetchListPage<OrgActivityRow>>(async (params) => {
    const res = await api.api.admin['org-activity'].$get({
      query: params as Record<string, string> & { k: ActivityKind; off: string },
    });
    if (!res.ok) throw await apiFailure(res);
    return OrgActivityList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.admin['org-activity'].values.$get({
        query: q ? { col, q, ...extra } : { col, ...extra },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [extra],
  );
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    audit: false,
    defaultVisible: VISIBLE,
    settings: view.settings,
    defaultSort: SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.admin['org-activity'].export.$get({
        query: { ...params, ...extra, cols: visible.join(',') },
      }),
    [params, visible, extra],
  );
  const exporter = useListExport(sendExport);

  const { openOrg, cards } = useAdminCards();
  const actions = (r: OrgActivityRow): ActionEntry[] => [
    { id: 'card', label: t('orgs.action.card'), icon: 'building', run: () => openOrg(r.id) },
  ];
  const [create, setCreate] = useState<DialogSlot<null> | null>(null);
  useOrgsAddRequest(() => setCreate(openSlot(null)));
  const refresh = useOrgsRefresh();

  return (
    <div data-orgs-activity="" className="flex flex-col gap-3.5">
      <PeriodBar t={t} p={p} today={today} note={t('orgs.act.note')} onChange={choose} />
      {overview.isError && !v ? (
        <Note tone="bad" icon="alert">
          {t('orgs.act.load_error')}{' '}
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => void overview.refetch()}
          >
            {t('grid.retry')}
          </button>
        </Note>
      ) : null}
      {v ? (
        <>
          <Plates shown={stats.shown}>
            <Plate
              id="o1"
              icon="building"
              color={v.active ? 'green' : 'yellow'}
              label={t('orgs.act.plate.orgs')}
              value={String(v.active)}
              unit={t('orgs.act.plate.orgs_of', { n: v.orgs })}
            />
            <Plate
              id="o2"
              icon="users"
              color="blue"
              label={t('orgs.act.plate.users')}
              value={String(v.users)}
              sub={t('orgs.act.plate.users_sub')}
            />
            <Plate
              id="o3"
              icon="key"
              color="blue"
              label={t('orgs.act.plate.in')}
              value={formatCount(v.in)}
            />
            <Plate
              id="o4"
              icon="chart"
              color="purple"
              label={t('orgs.act.plate.n')}
              value={formatCount(v.n)}
            />
            <Plate
              id="o5"
              icon="send"
              color="green"
              label={t('orgs.act.plate.sub')}
              value={formatCount(v.sub)}
              sub={t('orgs.act.plate.sub_cps', { n: v.cps })}
            />
          </Plates>
          {v.k === 'd' ? null : (
            <Box title={t(v.k === 'y' ? 'home.act.chart.months' : 'home.act.chart.days')}>
              <ActivityChart t={t} k={v.k} buckets={v.buckets} />
            </Box>
          )}
        </>
      ) : (
        <div data-orgs-activity-loading="" className="min-h-[120px]" aria-busy="true" />
      )}
      <div data-orgs-activity-list="">
        <DataGrid
          columns={columns}
          defaultVisible={VISIBLE}
          defaultSort={SORT}
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
          empty={<EmptyState icon="building" title={t('orgs.act.empty')} />}
          rowKey={(r) => r.id}
          rowTone={(r) => (r.active ? undefined : 'muted')}
          titleKey="name"
          label={t('tab.orgs.act')}
          labels={labels}
          actions={actions}
          onOpen={(r) => openOrg(r.id)}
        />
      </div>
      {cards}
      {create ? (
        <NewOrganizationDialog
          key={`create-${create.n}`}
          open={create.open}
          onClose={() => setCreate(closeSlot)}
          onDone={refresh}
        />
      ) : null}
    </div>
  );
}
