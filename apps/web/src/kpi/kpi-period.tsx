'use client';

import { formatMomentRu, monthOf, monthRange, monthText, type ListSort } from '@buhuchet/domain';
import { ListValues, listPageSchema, KpiPeriodRow } from '@buhuchet/shared';
import {
  DataGrid,
  effectiveView,
  EmptyState,
  PHONE_QUERY,
  Tag,
  useMediaQuery,
  useToast,
  type GridColumn,
} from '@buhuchet/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { ContractorLink } from '../contractors/contractor-link';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { useKpiRefresh } from './kpi-data';
import { useKpiEntry } from './kpi-entry';
import { exCellOf, exKey, kxCell, type KxRef, numberCells, putCells } from './kpi-ex';
import { monthGenName, monthName, monthShortName, numberText } from './kpi-format';
import { defaultPeriod, PeriodBar, todayBishkek, type Period } from './kpi-period-bar';
import { KpiPlates } from './kpi-plates';
import { setKpiChoice, useKpiChoice } from './kpi-state';
import type { CellChange } from './kpi-table';
import { EX_WRAP, useExTable } from './use-ex-table';

/*
 * Вкладка «За период» (задача 2.27; ТЗ «Вкладка «За период»»; прототип v81 modules/kpi.js, kpiPeriod,
 * kGridEx): строки — контрагент и показатель, столбцы — месяцы периода и итоги «Сумма», «Среднее»,
 * «Максимум», «Минимум» только по заполненным месяцам; группировка, фильтры и «В Excel» — общий список.
 * В виде «Таблица» месяцы вносятся прямо в ячейках, как в Excel; в виде «Карточки» ячейка месяца
 * открывает окно значения контрагента за месяц.
 */

const KpiPeriodList = listPageSchema(KpiPeriodRow);
const TOTALS = ['sum', 'avg', 'max', 'min'] as const;
/** По умолчанию — по контрагенту (ТЗ). */
const DEFAULT_SORT: ListSort = { key: 'cp', dir: 'asc' };
const monthKey = (m: string) => `m${m}`;

/** Ячейка строки «За период» за месяц `j` периода. */
function periodRef(r: KpiPeriodRow, months: readonly string[], j: number): KxRef | null {
  const month = months[j];
  if (!month) return null;
  return {
    contractorId: r.contractorId,
    indicatorId: r.indicatorId,
    type: r.type,
    required: r.required,
    archived: r.indicatorArchived,
    month,
    state: r.needed[j] ? 'required' : r.early[j] ? 'early' : 'off',
    start: r.start,
    offSince: r.offSince,
    value: r.values[j] ?? null,
    editable: r.editable,
  };
}

/** Значения после правки — сразу в строках страницы, пока сервер не ответил. */
function patchedPeriod(
  page: { items: KpiPeriodRow[] } | undefined,
  months: readonly string[],
  changes: readonly CellChange[],
) {
  if (!page) return page;
  const by = new Map(
    changes.map((c) => [`${c.contractorId}|${c.indicatorId}|${c.month}`, c.value]),
  );
  return {
    ...page,
    items: page.items.map((r) => ({
      ...r,
      values: r.values.map((v, j) => {
        const key = `${r.contractorId}|${r.indicatorId}|${months[j]}`;
        return by.has(key) ? by.get(key)! : v;
      }),
    })),
  };
}

/**
 * `excel` — вид «Таблица»: ячейки месяцев — таблица как в Excel (`data-kx`), иначе — кнопка, которая
 * открывает окно значения.
 */
function periodColumns(
  t: Translate,
  months: readonly string[],
  current: string,
  onCell: (row: KpiPeriodRow, month: string) => void,
  excel: boolean,
): GridColumn<KpiPeriodRow>[] {
  const off = (r: KpiPeriodRow) =>
    r.offSince ? t('kpi.off_since', { month: monthGenName(t, r.offSince) }) : '';
  return [
    {
      key: 'cp',
      label: t('kpi.col.contractor'),
      type: 'text',
      width: 230,
      text: (r) => r.contractorName,
      cell: (r) => (
        <ContractorLink
          id={r.contractorId}
          name={r.contractorName}
          tab="kpi"
          className="truncate font-semibold"
        />
      ),
    },
    {
      key: 'ind',
      label: t('kpi.col.indicator'),
      type: 'enum',
      width: 190,
      text: (r) => r.indicatorName,
      cell: (r) => (
        <span
          className="inline-flex min-w-0 items-center gap-1.5"
          title={off(r) ? `${r.indicatorName} · ${off(r)}` : undefined}
        >
          <span className="truncate">{r.indicatorName}</span>
          {r.indicatorArchived ? <Tag>{t('kpi.archived_tag')}</Tag> : null}
          {off(r) ? <Tag>{off(r)}</Tag> : null}
        </span>
      ),
    },
    ...months.map((m, j): GridColumn<KpiPeriodRow> => ({
      key: monthKey(m),
      label: monthShortName(t, m),
      type: 'money',
      width: 105,
      // «пусто» и в тексте: на телефоне карточка показывает ячейку только с непустым текстом.
      text: (r) => {
        const v = r.values[j] ?? null;
        return v === null && r.needed[j] ? t('kpi.empty') : numberText(r.type, v);
      },
      ...(excel
        ? {
            td: (r: KpiPeriodRow) => kxCell(t, periodRef(r, months, j)!, current, true).props,
          }
        : {}),
      cell: (r) => {
        if (excel) return kxCell(t, periodRef(r, months, j)!, current).content;
        const v = r.values[j] ?? null;
        const empty = v === null && r.needed[j] && m < current;
        return (
          <button
            type="button"
            data-kpi-cell={`${r.contractorId}|${m}`}
            title={t('kpi.cell_title', { ind: r.indicatorName, month: monthText(m) })}
            className={`cursor-pointer rounded-[5px] border-0 bg-transparent px-1 py-0.5 tabular-nums hover:bg-row-hover ${empty ? 'text-warn-label italic' : v === null ? 'text-faint' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onCell(r, m);
            }}
          >
            {v === null ? (r.needed[j] ? t('kpi.empty') : '—') : numberText(r.type, v)}
          </button>
        );
      },
    })),
    ...TOTALS.map((k): GridColumn<KpiPeriodRow> => ({
      key: k,
      label: t(`kpi.total.${k}`),
      type: 'money',
      width: k === 'avg' ? 170 : 130,
      text: (r) => numberText(r.type, r.totals[k]),
      cell: (r) =>
        r.totals[k] === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span>
            <b>{numberText(r.type, r.totals[k])}</b>
            {k === 'avg' ? (
              <small className="ml-1 text-faint">
                {t('kpi.avg_of', { n: r.count, of: r.need || months.length })}
              </small>
            ) : null}
          </span>
        ),
    })),
    {
      key: 'resp',
      label: t('kpi.col.responsible'),
      type: 'enum',
      width: 140,
      text: (r) => r.responsibleName ?? '',
    },
    { key: 'unit', label: t('kpi.col.unit'), type: 'enum', width: 90, text: (r) => r.unit },
    {
      key: 'nf',
      label: t('kpi.col.filled_months'),
      type: 'int',
      width: 120,
      text: (r) => t('kpi.filled_of', { n: r.count, of: r.need }),
    },
    {
      key: 'fs',
      label: t('kpi.col.fill_state'),
      type: 'enum',
      width: 150,
      text: (r) => t(r.count >= r.need ? 'kpi.fill_state.full' : 'kpi.fill_state.gaps'),
    },
    {
      key: 'ub',
      label: t('kpi.col.updated_by'),
      type: 'text',
      width: 170,
      text: (r) =>
        r.lastBy && r.lastAt ? `${r.lastBy} · ${formatMomentRu(new Date(r.lastAt))}` : '',
    },
  ];
}

const fetchPeriod: FetchListPage<KpiPeriodRow> = async (params) => {
  const res = await api.api.kpi.period.$get({
    query: { ...params, from: params.from!, to: params.to! },
  });
  if (!res.ok) throw await apiFailure(res);
  return KpiPeriodList.parse(await res.json());
};

export function KpiPeriodTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const phone = useMediaQuery(PHONE_QUERY);
  const labels = useGridLabels('kpi.period.count');
  const { search, clearSearch, access } = useShell();
  const choice = useKpiChoice();
  const period: Period = choice.period ?? defaultPeriod();
  const months = useMemo(() => monthRange(period.from, period.to), [period.from, period.to]);
  const entry = useKpiEntry();
  const current = monthOf(todayBishkek());
  const open = entry.open;
  const view = useViewSettings('kpi.period');
  // Вид «Таблица» — ввод как в Excel; в «Карточках» ячеек нет (прототип `kGridEx`).
  const excel = effectiveView(view.settings, phone) === 'table';
  const columns = useMemo(
    () => periodColumns(t, months, current, (r, m) => void open(r.contractorId, m), excel),
    [t, months, current, open, excel],
  );
  const defaultVisible = useMemo(() => ['cp', 'ind', ...months.map(monthKey), ...TOTALS], [months]);
  const extra = useMemo(() => ({ from: period.from, to: period.to }), [period.from, period.to]);
  const list = useListPage({
    gridKey: 'kpi.period',
    columns,
    audit: false,
    defaultVisible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready,
    fetchPage: fetchPeriod,
    extra,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () =>
      api.api.kpi.period.export.$get({
        query: { ...params, cols: visible.join(','), from: period.from, to: period.to },
      }),
    [params, visible, period.from, period.to],
  );
  const exporter = useListExport(sendExport);

  // Таблица как в Excel: ячейки — по порядку строк страницы, ключ ячейки — `data-kx`.
  const keys = useRef<string[][]>([]);
  const rowsById = new Map((list.data?.items ?? []).map((r) => [r.id, r]));
  const at = (r: number, c: number): KxRef | null => {
    const [cid, ind, m] = (keys.current[r]?.[c] ?? '').split('|');
    const row = rowsById.get(`${cid}|${ind}`);
    return row && m ? periodRef(row, months, months.indexOf(m)) : null;
  };
  const save = async (changes: CellChange[]) => {
    client.setQueriesData<{ items: KpiPeriodRow[] }>({ queryKey: ['list', 'kpi.period'] }, (old) =>
      patchedPeriod(old, months, changes),
    );
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: changes } }));
    void refresh();
    if (!res.ok) toast(errorText(res.error), { bad: true });
    return res.ok;
  };
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable(
    {
      number: (wrap) => {
        keys.current = numberCells(wrap);
        return {
          rows: keys.current.length,
          cols: Math.max(0, ...keys.current.map((r) => r.length)),
        };
      },
      get: (r, c) => exCellOf(t, at(r, c), current),
      key: (r, c) => exKey(at(r, c)),
      put: (writes) => putCells(writes, at, save),
      label: (r, c) => {
        const x = at(r, c);
        const row = x && rowsById.get(`${x.contractorId}|${x.indicatorId}`);
        return row
          ? t('kpi.ex.cell_label', {
              name: row.contractorName,
              ind: row.indicatorName,
              month: monthName(t, x.month),
            })
          : t('kpi.ex.cell');
      },
      menu: (r, c) => {
        const x = at(r, c);
        const row = x && rowsById.get(`${x.contractorId}|${x.indicatorId}`);
        return x && row
          ? [
              {
                id: 'entry',
                label: t('kpi.ex.menu.entry'),
                icon: 'clip',
                sub: `${row.contractorName} · ${monthName(t, x.month)}`,
                run: () => void open(x.contractorId, x.month),
              },
            ]
          : [];
      },
    },
    { enabled: excel },
  );

  const loadValues = useCallback(
    async (col: string, q?: string) => {
      const res = await api.api.kpi.period.values.$get({
        query: { col, ...(q ? { q } : {}), from: period.from, to: period.to },
      });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json());
    },
    [period.from, period.to],
  );

  return (
    <div className="flex flex-col gap-3.5">
      <KpiPlates />
      <PeriodBar value={period} onChange={(p) => setKpiChoice({ period: p })} />
      {exStat}
      <div ref={exRef} className={EX_WRAP}>
        {exLayer}
        <DataGrid
          columns={columns}
          defaultVisible={defaultVisible}
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
          onExport={access.can('export') ? () => void exporter.run() : undefined}
          exporting={exporter.exporting}
          empty={<EmptyState icon="chart" title={t('kpi.period.empty')} />}
          rowKey={(r) => r.id}
          titleKey="cp"
          label={t('tab.kpi.period')}
          labels={labels}
        />
      </div>
      {exMenu}
      {entry.dialog}
    </div>
  );
}
