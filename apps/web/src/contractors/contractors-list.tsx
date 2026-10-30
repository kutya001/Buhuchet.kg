'use client';

import { formatCount, type GridKey, type ListFilterValue } from '@buhuchet/domain';
import { ContractorList, ListValues, type ContractorRow } from '@buhuchet/shared';
import { DataGrid, EmptyState, Plate, Plates, type PlateProps } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, apiFailure } from '../api-client';
import { missingSummaryQuery } from '../kpi/kpi-data';
import { useT } from '../l10n/provider';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { openContractorCard } from './card-store';
import { useContractorActions } from './contractor-actions';
import { useContractorAddRequest } from './contractor-add';
import {
  CONTRACTOR_AUDIT,
  CONTRACTOR_DEFAULT_SORT,
  CONTRACTOR_DEFAULT_VISIBLE,
  contractorColumns,
  contractorTone,
} from './contractor-columns';
import { contractorSummaryQuery } from './contractor-data';

export type ContractorTab = 'all' | 'mine';

type Filters = Readonly<Record<string, ListFilterValue>>;

const enumIs = (f: Filters, key: string, val: string) => {
  const x = f[key];
  return x?.type === 'enum' && x.vals.length === 1 && x.vals[0] === val;
};

/**
 * Фильтры плашек (прототип renderCps, `pl.onclick`): плашка ставит один фильтр вместо прежних; нажатая
 * ещё раз — снимает. «С просроченными отчётами» — «Просрочено» от 1.
 */
const PLATE_FILTERS: Record<string, Filters> = {
  noresp: { responsible: { type: 'enum', vals: [''] } },
  over: { overdue: { type: 'num', from: 1, to: null } },
  nogk: { gkedSet: { type: 'enum', vals: ['no'] } },
  sfq: { socfundAsk: { type: 'enum', vals: ['yes'] } },
  kpin: { kpiMissing: { type: 'enum', vals: ['yes'] } },
  pau: { service: { type: 'enum', vals: ['paused'] } },
  one: { kind: { type: 'enum', vals: ['oneoff'] } },
  arc: { service: { type: 'enum', vals: ['archived'] } },
};

const plateOn = (f: Filters, id: string): boolean => {
  if (id === 'over') {
    const x = f.overdue;
    return x?.type === 'num' && x.from === 1 && x.to == null;
  }
  const want = PLATE_FILTERS[id];
  if (!want) return false;
  return Object.entries(want).every(([k, v]) => v.type === 'enum' && enumIs(f, k, v.vals[0]!));
};

/**
 * «Контрагенты» → «Все» или «Мои контрагенты» (ТЗ «Контрагенты»: вкладки, плашки, столбцы, «Без
 * ГКЭД», «Тариф под вопросом», закрепление; прототип modules/contractors.js, `renderCps`): плашки-итоги
 * (клик ставит фильтр), общий список с поиском, фильтрами, группировкой и «В Excel». Без ответственного
 * — оранжевым, приостановленные и архивные — приглушённо; архивные видны, только если фильтр
 * «Статус обслуживания» их включает (плашка «В архиве»). Строка открывает карточку; галочки —
 * «Назначить ответственного», «Включить страницу», «В архив». На телефоне — плитки; номер телефона —
 * ссылкой «Позвонить» и кнопкой WhatsApp.
 */
export function ContractorsList({ tab }: { tab: ContractorTab }) {
  const t = useT();
  const gridKey: GridKey = `cps.${tab}`;
  const labels = useGridLabels('cp.count');
  const { search, clearSearch, access } = useShell();
  const fee = access.feature('fee') && access.can('fee');
  const kpi = access.feature('indicators') && access.can('kpiView');
  const columns = useMemo(() => contractorColumns(t, { fee, kpi }), [t, fee, kpi]);
  const view = useViewSettings(gridKey);
  const stats = useModuleStats('cps');
  const summary = useQuery(contractorSummaryQuery);
  const kpiSummary = useQuery({ ...missingSummaryQuery, enabled: kpi });
  const s = summary.data;
  const extra = useMemo(() => ({ tab }), [tab]);
  const fetchPage = useCallback<FetchListPage<ContractorRow>>(async (params) => {
    const res = await api.api.contractors.$get({ query: params });
    if (!res.ok) throw await apiFailure(res);
    return ContractorList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.contractors.values.$get({
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
    defaultVisible: CONTRACTOR_DEFAULT_VISIBLE,
    settings: view.settings,
    defaultSort: CONTRACTOR_DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible, filters, setFilters } = list;
  const sendExport = useCallback(
    () => api.api.contractors.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);
  const cps = useContractorActions();
  useContractorAddRequest({ contractor: cps.newContractor });

  const goPlate = (id: string) => {
    const want = PLATE_FILTERS[id];
    if (!want) return;
    setFilters(plateOn(filters, id) ? {} : want);
  };
  const plate = (p: Omit<PlateProps, 'on' | 'onClick'>): PlateProps => ({
    ...p,
    on: plateOn(filters, p.id),
    onClick: () => goPlate(p.id),
  });

  const plates: PlateProps[] = s
    ? [
        {
          id: 'all',
          icon: 'building',
          color: 'blue',
          label: t('cp.plate.active'),
          value: formatCount(s.active),
          sub: t(s.scopeAll ? 'cp.plate.active_all' : 'cp.plate.active_mine'),
          onClick: () => setFilters({}),
        },
        plate({
          id: 'noresp',
          icon: 'alert',
          color: s.noResponsible ? 'orange' : 'green',
          label: t('cp.plate.no_resp'),
          value: formatCount(s.noResponsible),
          sub: t(s.noResponsible ? 'cp.plate.no_resp_sub' : 'cp.plate.no_resp_ok'),
        }),
        plate({
          id: 'over',
          icon: 'clock',
          color: s.withOverdue ? 'red' : 'green',
          label: t('cp.plate.overdue'),
          value: formatCount(s.withOverdue),
        }),
        plate({
          id: 'nogk',
          icon: 'alert',
          color: s.noGked ? 'yellow' : 'green',
          label: t('cp.plate.no_gked'),
          value: formatCount(s.noGked),
          sub: t(s.noGked ? 'cp.plate.no_gked_sub' : 'cp.plate.no_gked_ok'),
        }),
        plate({
          id: 'sfq',
          icon: 'shield',
          color: s.socfundAsk ? 'yellow' : 'green',
          label: t('cp.plate.socfund'),
          value: formatCount(s.socfundAsk),
          sub: t(s.socfundAsk ? 'cp.plate.socfund_sub' : 'cp.plate.socfund_ok'),
        }),
        ...(s.kpiMissing !== null
          ? [
              plate({
                id: 'kpin',
                icon: 'gauge',
                color: s.kpiMissing ? (kpiSummary.data?.overdue ? 'red' : 'yellow') : 'green',
                label: t('cp.plate.kpi'),
                value: formatCount(s.kpiMissing),
                sub: t(s.kpiMissing ? 'cp.plate.kpi_sub' : 'cp.plate.kpi_ok'),
              }),
            ]
          : []),
        plate({
          id: 'pau',
          icon: 'pause',
          color: 'yellow',
          label: t('cp.plate.paused'),
          value: formatCount(s.paused),
        }),
        plate({
          id: 'one',
          icon: 'briefcase',
          color: 'purple',
          label: t('cp.plate.oneoff'),
          value: formatCount(s.oneoff),
        }),
        plate({
          id: 'arc',
          icon: 'archive',
          color: 'gray',
          label: t('cp.plate.archived'),
          value: formatCount(s.archived),
          sub: t('cp.plate.archived_sub'),
        }),
      ]
    : [];

  const canAdd = access.can('createCp');
  // Контрагентов нет совсем — пустое состояние первого входа (ТЗ «Пустые состояния», прототип
  // ui/empty.js `firstEmpty`); «Загрузить из Excel» рядом подключит задача загрузки (2.16).
  const first = tab === 'all' && !!s && s.active + s.archived === 0;
  const empty =
    tab === 'mine' ? (
      <EmptyState icon="building" title={t('cp.empty.mine')} />
    ) : (
      <EmptyState
        icon="building"
        title={t(first ? 'cp.empty.first' : 'cp.empty.all')}
        text={t(first ? 'cp.empty.first_text' : 'cp.empty.all_text')}
        {...(canAdd
          ? {
              actions: [
                {
                  id: 'add',
                  icon: 'plus',
                  label: t('cp.empty.add'),
                  primary: true,
                  onClick: () => cps.newContractor(),
                },
              ],
            }
          : {})}
      />
    );

  return (
    <div className="flex flex-col gap-3.5" data-cps-list={tab}>
      {plates.length ? (
        <Plates shown={stats.shown}>
          {plates.map((p) => (
            <Plate key={p.id} {...p} />
          ))}
        </Plates>
      ) : null}
      <DataGrid
        columns={columns}
        audit={CONTRACTOR_AUDIT}
        defaultVisible={CONTRACTOR_DEFAULT_VISIBLE}
        defaultSort={CONTRACTOR_DEFAULT_SORT}
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
        rowTone={contractorTone}
        label={t('nav.counterparties')}
        labels={labels}
        actions={cps.actions}
        onOpen={(r) => openContractorCard(r)}
        bulk={cps.bulk}
      />
      {cps.dialogs}
    </div>
  );
}
