'use client';

import {
  bishkekDate,
  formatCount,
  formatSom,
  formatSomWithUnit,
  pluralForm,
  type ListSort,
} from '@buhuchet/domain';
import { ListValues, RevenueList, type RevenueOverview, type RevenueRow } from '@buhuchet/shared';
import {
  Box,
  CHECKBOX_CLASS,
  DataGrid,
  EmptyState,
  Hint,
  inputClass,
  KeyValues,
  linkButtonClass,
  Note,
  Plate,
  Plates,
  type ActionEntry,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import { api, apiFailure } from '../api-client';
import { openContractorCard } from '../contractors/card-store';
import { useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { presetHref } from '../lists/preset';
import { useModuleStats } from '../lists/stats';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { revenueOverviewQuery, useHomeRefreshOnSave } from './home-data';
import { ChartLegend, EmptyChart, MonthChart, TopChart } from './revenue-chart';

const GRID_KEY = 'home.analytics';

/** По умолчанию — по «Итого получено», от больших (прототип `sort: {key: 'total', dir: -1}`). */
const REVENUE_SORT: ListSort = { key: 'total', dir: 'desc' };

/**
 * Видимые по умолчанию — все, кроме «Тип» (прототип: `hide: true`); прошлый год и «Изменение» — при
 * «Сравнить с …», без него скрыты и включаются в «Столбцах» (прототип: `hide: !a.cmp`).
 */
const REVENUE_VISIBLE = [
  'cp',
  'resp',
  'feeCh',
  'fee',
  'proj',
  'svc',
  'total',
  'debt',
  'share',
  'prev',
  'change',
];
const REVENUE_VISIBLE_ALONE = REVENUE_VISIBLE.filter((k) => k !== 'prev' && k !== 'change');

/**
 * Год «Аналитики» и «Сравнить с …» (прототип `S.an`): один на страницу до её перезагрузки — вернувшись
 * на вкладку, сотрудник видит тот же год.
 */
let chosen: { year: number; compare: boolean } | null = null;

/** Доля — «52,6 %», изменение — «+150 %» (прототип `share`, `ch`). */
const shareText = (v: number) => `${String(v).replace('.', ',')} %`;

/** Столбцы списка (прототип: сетка `an-cps`). */
function revenueColumns(t: Translate, year: number): GridColumn<RevenueRow>[] {
  const som = (v: number) => formatSom(v);
  const money = (key: 'feeCh' | 'fee' | 'proj' | 'svc', label: Parameters<Translate>[0]) => ({
    key,
    label: t(label),
    type: 'money' as const,
    width: key === 'feeCh' || key === 'fee' ? 190 : key === 'proj' ? 130 : 140,
    text: (r: RevenueRow) => som(r[key]),
    total: som,
  });
  return [
    {
      key: 'cp',
      label: t('home.an.col.cp'),
      type: 'text',
      width: 240,
      text: (r) => r.name,
      cell: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      key: 'resp',
      label: t('home.an.col.resp'),
      type: 'enum',
      width: 130,
      text: (r) => r.responsible ?? '',
    },
    {
      key: 'kind',
      label: t('home.an.col.kind'),
      type: 'enum',
      width: 120,
      text: (r) => t(r.oneOff ? 'home.an.kind.oneoff' : 'home.an.kind.regular'),
    },
    money('feeCh', 'home.an.col.fee_ch'),
    money('fee', 'home.an.col.fee'),
    money('proj', 'home.an.col.proj'),
    money('svc', 'home.an.col.svc'),
    {
      key: 'total',
      label: t('home.an.col.total'),
      type: 'money',
      width: 150,
      text: (r) => som(r.total),
      cell: (r) => <b>{som(r.total)}</b>,
      total: som,
    },
    {
      key: 'debt',
      label: t('home.an.col.debt'),
      type: 'money',
      width: 130,
      text: (r) => som(r.debt),
      cell: (r) =>
        r.debt > 0 ? (
          <span className="font-semibold text-danger">{som(r.debt)}</span>
        ) : (
          <span className="text-faint">{som(0)}</span>
        ),
      total: som,
    },
    {
      key: 'share',
      label: t('home.an.col.share'),
      // Процент с десятыми: фильтр «от … до …» — целыми процентами.
      type: 'int',
      width: 90,
      text: (r) => shareText(r.share),
    },
    {
      key: 'prev',
      label: t('home.an.year', { y: year - 1 }),
      type: 'money',
      width: 130,
      text: (r) => som(r.prev),
      total: som,
    },
    {
      key: 'change',
      label: t('home.an.col.change'),
      type: 'int',
      width: 120,
      text: (r) => (r.change === null ? '' : `${r.change > 0 ? '+' : ''}${r.change} %`),
      cell: (r) =>
        r.change === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className={r.change < 0 ? 'text-danger' : 'text-ok'}>
            {`${r.change > 0 ? '+' : ''}${r.change} %`}
          </span>
        ),
    },
  ];
}

/** Плашки «Аналитики» (прототип `renderAnalytics`): только итоги, не нажимаются. */
function RevenuePlates({ t, v, shown }: { t: Translate; v: RevenueOverview; shown: boolean }) {
  const som = t('home.an.som');
  // Целые сомы (прототип `fmtM(v, false)`).
  const value = (x: number) => formatSom(Math.round(x / 100) * 100, 'auto');
  const change =
    v.change === null
      ? undefined
      : t('home.an.plate.change', { ch: `${v.change >= 0 ? '+' : ''}${v.change}`, y: v.year - 1 });
  const kinds = [
    ['fee', 'coins', 'blue'],
    ['proj', 'briefcase', 'purple'],
    ['svc', 'gift', 'orange'],
  ] as const;
  return (
    <Plates shown={shown}>
      <Plate
        id="ch"
        icon="list"
        color="blue"
        label={t('home.an.plate.ch')}
        value={value(v.feeCh)}
        unit={som}
        sub={t('home.an.plate.ch_sub', { p: v.feePaidPercent })}
      />
      <Plate
        id="t"
        icon="chart"
        color="green"
        label={t(v.current ? 'home.an.plate.total_ytd' : 'home.an.plate.total', { y: v.year })}
        value={value(v.total)}
        unit={som}
        sub={change}
      />
      {kinds.map(([k, icon, color]) => (
        <Plate
          key={k}
          id={k}
          icon={icon}
          color={color}
          label={t(`home.an.kind.${k}`)}
          value={value(v[k])}
          unit={som}
          sub={v.shares ? t('home.an.plate.share', { p: v.shares[k] }) : undefined}
        />
      ))}
      <Plate
        id="debt"
        icon="alert"
        color={v.debt ? 'red' : 'green'}
        label={t('home.an.plate.debt')}
        value={value(v.debt)}
        unit={som}
        sub={t('home.an.plate.debt_sub')}
      />
    </Plates>
  );
}

/** «Концентрация» (прототип: `.kv` — платили, доля топ-5, средний чек, долг за обслуживание). */
function Concentration({ t, v }: { t: Translate; v: RevenueOverview }) {
  return (
    <Box title={t('home.an.conc')}>
      <KeyValues
        items={[
          {
            id: 'paid',
            label: t('home.an.conc.paid', { y: v.year }),
            value: t(`cp.count.${pluralForm(v.paid)}`, { n: formatCount(v.paid) }),
          },
          {
            id: 'top5',
            label: t('home.an.conc.top5'),
            value: <span className="tabular-nums">{`${v.top5Percent} %`}</span>,
          },
          {
            id: 'avg',
            label: t('home.an.conc.avg'),
            value: <span className="tabular-nums">{formatSomWithUnit(v.average)}</span>,
          },
          {
            id: 'debt',
            label: t('home.an.conc.debt'),
            value: (
              <span className={`tabular-nums ${v.feeDebt > 0 ? 'font-semibold text-danger' : ''}`}>
                {formatSomWithUnit(v.feeDebt)}
              </span>
            ),
          },
        ]}
      />
    </Box>
  );
}

/** Список контрагентов с выручкой за год (прототип: сетка `an-cps`). */
function RevenueGrid({
  t,
  year,
  compare,
  onOps,
}: {
  t: Translate;
  year: number;
  compare: boolean;
  onOps: (r: { id: string }) => void;
}) {
  const { search, clearSearch, access } = useShell();
  const labels = useGridLabels('cp.count');
  const columns = useMemo(() => revenueColumns(t, year), [t, year]);
  const defaultVisible = compare ? REVENUE_VISIBLE : REVENUE_VISIBLE_ALONE;
  const view = useViewSettings(GRID_KEY);
  const extra = useMemo(() => ({ year: String(year) }), [year]);
  const fetchPage = useCallback<FetchListPage<RevenueRow>>(async (params) => {
    const res = await api.api.home.analytics.$get({
      query: params as Record<string, string> & { year: string },
    });
    if (!res.ok) throw await apiFailure(res);
    return RevenueList.parse(await res.json());
  }, []);
  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.home.analytics.values.$get({
        query: q ? { col, q, year: String(year) } : { col, year: String(year) },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [year],
  );
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    audit: false,
    defaultVisible,
    settings: view.settings,
    defaultSort: REVENUE_SORT,
    search,
    enabled: view.ready,
    fetchPage,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.home.analytics.export.$get({
        query: { ...params, year: String(year), cols: visible.join(',') },
      }),
    [params, visible, year],
  );
  const exporter = useListExport(sendExport);
  const actions = (r: RevenueRow): ActionEntry[] => [
    { id: 'ops', label: t('home.an.ops'), icon: 'list', run: () => onOps(r) },
    {
      id: 'card',
      label: t('home.an.card'),
      icon: 'building',
      run: () => openContractorCard({ id: r.id }),
    },
  ];
  return (
    <div data-home-revenue="">
      <DataGrid
        columns={columns}
        defaultVisible={defaultVisible}
        defaultSort={REVENUE_SORT}
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
        empty={<EmptyState icon="list" title={t('grid.empty')} />}
        rowKey={(r) => r.id}
        titleKey="name"
        label={t('tab.home.analytics')}
        labels={labels}
        actions={actions}
        onOpen={onOps}
      />
    </div>
  );
}

/**
 * «Главная» → «Аналитика» (ТЗ «Главная» → «Вкладка «Аналитика»»; прототип modules/analytics.js,
 * `renderAnalytics`): выручка организации от контрагентов за год — плашки, график по месяцам со
 * сравнением с прошлым годом, «Топ-10», «Концентрация» и список контрагентов. Контрагент открывает свои
 * операции в «Финансовых операциях» (прототип `cpOps`), без них — карточку. В организации без
 * контрагентов — пустой график с подсказкой.
 */
export function HomeAnalyticsTab() {
  const t = useT();
  const router = useRouter();
  const { access } = useShell();
  const stats = useModuleStats('home');
  const id = useId();
  const [state, setState] = useState(
    () => chosen ?? { year: Number(bishkekDate(new Date()).slice(0, 4)), compare: true },
  );
  const choose = (next: typeof state) => {
    chosen = next;
    setState(next);
  };
  const overview = useQuery(revenueOverviewQuery(state.year));
  useHomeRefreshOnSave();
  const v = overview.data;

  /** Прототип `cpOps`: «Финансовые операции» → «Все» с фильтром по контрагенту, без них — карточка. */
  // ОТКЛОНЕНИЕ: docs/deviations.md#Г-12 — «Финансовые операции» только с правом их просмотра.
  const openOps = (cp: { id: string }) => {
    if (access.feature('finops') && access.can('finView')) {
      router.push(presetHref('fin', 'all', { cp: { type: 'enum', vals: [cp.id] } }));
    } else {
      openContractorCard({ id: cp.id });
    }
  };

  if (overview.isError) {
    return (
      <Note tone="bad" icon="alert">
        {t('home.an.load_error')}{' '}
        <button type="button" className={linkButtonClass()} onClick={() => void overview.refetch()}>
          {t('grid.retry')}
        </button>
      </Note>
    );
  }
  if (!v) return <div data-home-loading="" className="min-h-[200px]" aria-busy="true" />;
  if (v.empty) {
    return (
      <div data-home-analytics="" data-empty="">
        <Box title={t('home.an.months')}>
          <EmptyChart t={t} />
        </Box>
      </div>
    );
  }
  return (
    <div data-home-analytics="" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span className="min-w-0 text-[13.5px] text-muted">{t('home.an.intro')}</span>
        <div className="flex-1" />
        <select
          id={`${id}-year`}
          aria-label={t('home.an.year_label')}
          className={`${inputClass({ full: false })} min-h-[30px] w-auto cursor-pointer px-2 py-[3px]`}
          value={state.year}
          onChange={(e) => choose({ ...state, year: Number(e.target.value) })}
        >
          {v.years.map((y) => (
            <option key={y} value={y}>
              {t('home.an.year', { y })}
            </option>
          ))}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[13.5px]">
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={state.compare}
            onChange={(e) => choose({ ...state, compare: e.target.checked })}
          />
          {t('home.an.compare', { y: state.year - 1 })}
        </label>
      </div>
      <RevenuePlates t={t} v={v} shown={stats.shown} />
      <Box
        title={t('home.an.months')}
        actions={<ChartLegend t={t} prevYear={state.compare ? state.year - 1 : null} />}
      >
        <MonthChart t={t} v={v} compare={state.compare} />
      </Box>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5 max-[900px]:grid-cols-1">
        <Box title={t('home.an.top')}>
          <TopChart t={t} top={v.top} onOpen={(cp) => openOps({ id: cp })} />
          <Hint>{t('home.an.top_hint')}</Hint>
        </Box>
        <Concentration t={t} v={v} />
      </div>
      <RevenueGrid t={t} year={state.year} compare={state.compare} onOps={openOps} />
    </div>
  );
}
