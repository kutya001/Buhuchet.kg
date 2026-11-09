'use client';

import { formatDateRu, monthOf, type ListSort } from '@buhuchet/domain';
import {
  KpiMissingRow,
  KpiValuesSaved,
  ListValues,
  listPageSchema,
  type Indicator,
} from '@buhuchet/shared';
import {
  DataGrid,
  effectiveView,
  EmptyState,
  Icon,
  Note,
  PHONE_QUERY,
  useMediaQuery,
  useToast,
  type GridColumn,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage, type FetchListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { indicatorsQuery } from './kpi-data';
import { useKpiEntry } from './kpi-entry';
import { exCellOf, exKey, kxCell, type KxRef, numberCells, putCells } from './kpi-ex';
import { monthName, numberText } from './kpi-format';
import { todayBishkek } from './kpi-period-bar';
import { KpiPlates } from './kpi-plates';
import { MonthMini } from './kpi-status';
import type { CellChange } from './kpi-table';
import { EX_WRAP, useExTable } from './use-ex-table';

/*
 * Вкладка «Не заполнено» (задача 2.27; ТЗ «Вкладка «Не заполнено»»; прототип v81 modules/kpi.js,
 * kpiMissingTab, kGridEx): контрагенты и месяцы, за которые не внесены обязательные показатели; после
 * срока заполнения строка красная. По умолчанию — по сроку заполнения, старые сверху. Столбцы значений
 * показателей (необязательные — скрыты, включаются в «Столбцах»): в виде «Таблица» недостающее вносится
 * прямо в ячейках, как в Excel; «Не внесено» и статус месяца пересчитываются сразу, заполненная строка
 * остаётся до обновления списка. Строка открывает окно значений контрагента за месяц.
 */

const KpiMissingList = listPageSchema(KpiMissingRow);
const DEFAULT_SORT: ListSort = { key: 'due', dir: 'asc' };

/** Ключ столбца значений показателя: `v` и код без дефисов (как на сервере). */
const valueKey = (id: string) => `v${id.replace(/-/g, '')}`;

type Column = Pick<Indicator, 'id' | 'name' | 'type' | 'required'>;

/** Ячейка строки за её месяц по показателю столбца. */
function missingRef(r: KpiMissingRow, col: Column): KxRef | null {
  const cell = r.cells.find((c) => c.indicatorId === col.id);
  if (!cell) return null;
  return {
    contractorId: r.contractorId,
    indicatorId: col.id,
    type: col.type,
    required: col.required,
    archived: false,
    month: r.month,
    state: cell.state,
    start: cell.start,
    offSince: cell.offSince,
    value: cell.value,
    editable: r.editable,
  };
}

/** Невнесённые обязательные показатели строки после правки (прототип `after` в `kpiMissingTab`). */
function stillMissing(r: KpiMissingRow, cols: readonly Column[]) {
  return cols
    .filter((col) => {
      const cell = r.cells.find((c) => c.indicatorId === col.id);
      return col.required && cell?.state === 'required' && cell.value === null;
    })
    .map((col) => ({ id: col.id, name: col.name }));
}

/** Значения и статусы после правки — в строках страницы; заполненная строка остаётся. */
function patchedMissing(
  page: { items: KpiMissingRow[] } | undefined,
  cols: readonly Column[],
  changes: readonly CellChange[],
  statuses: KpiValuesSaved['statuses'],
) {
  if (!page) return page;
  const by = new Map(
    changes.map((c) => [`${c.contractorId}|${c.indicatorId}|${c.month}`, c.value]),
  );
  const st = new Map(statuses.map((s) => [`${s.contractorId}|${s.month}`, s.status]));
  const at = new Date().toISOString();
  return {
    ...page,
    items: page.items.map((r) => {
      const cells = r.cells.map((c) => {
        const key = `${r.contractorId}|${c.indicatorId}|${r.month}`;
        return by.has(key) ? { ...c, value: by.get(key)! } : c;
      });
      const next = { ...r, cells };
      const status = st.get(r.id);
      return {
        ...next,
        missing: stillMissing(next, cols),
        ...(status ? { status, statusAt: at } : {}),
      };
    }),
  };
}

function missingColumns(
  t: Translate,
  cols: readonly Column[],
  current: string,
  excel: boolean,
): GridColumn<KpiMissingRow>[] {
  return [
    {
      key: 'cp',
      label: t('kpi.col.contractor'),
      type: 'text',
      width: 230,
      text: (r) => r.contractorName,
      cell: (r) => <span className="truncate font-semibold">{r.contractorName}</span>,
    },
    {
      key: 'm',
      label: t('kpi.col.month'),
      type: 'enum',
      width: 140,
      text: (r) => monthName(t, r.month),
    },
    ...cols.map((col): GridColumn<KpiMissingRow> => ({
      key: valueKey(col.id),
      label: col.name,
      type: 'money',
      width: 130,
      text: (r) => {
        const x = missingRef(r, col);
        if (x?.value != null) return numberText(col.type, x.value);
        return x?.state === 'required' ? t('kpi.empty') : '—';
      },
      ...(excel
        ? {
            td: (r: KpiMissingRow) => {
              const x = missingRef(r, col);
              return x ? kxCell(t, x, current, true).props : {};
            },
            cell: (r: KpiMissingRow) => {
              const x = missingRef(r, col);
              return x ? kxCell(t, x, current).content : '—';
            },
          }
        : {}),
    })),
    {
      key: 'miss',
      label: t('kpi.col.missing'),
      type: 'text',
      width: 260,
      text: (r) => r.missing.map((x) => x.name).join(', '),
      cell: (r) =>
        r.missing.length ? (
          r.missing.map((x) => x.name).join(', ')
        ) : (
          <span className="inline-flex items-center gap-1 text-ok" data-kpi-row-done="">
            <Icon name="ok" size="sm" />
            {t('kpi.missing.row_done')}
          </span>
        ),
    },
    {
      key: 'resp',
      label: t('kpi.col.responsible'),
      type: 'enum',
      width: 140,
      text: (r) => r.responsibleName ?? '',
    },
    {
      key: 'due',
      label: t('kpi.col.due'),
      type: 'date',
      width: 130,
      text: (r) => formatDateRu(r.due),
      cell: (r) => (
        <span className={r.overdueDays > 0 ? 'font-semibold text-danger-label' : ''}>
          {formatDateRu(r.due)}
        </span>
      ),
    },
    {
      key: 'over',
      label: t('kpi.col.overdue_days'),
      type: 'int',
      width: 120,
      text: (r) => (r.overdueDays > 0 ? String(r.overdueDays) : ''),
    },
    {
      key: 'st',
      label: t('kpi.col.month_status'),
      type: 'enum',
      width: 170,
      text: (r) => t(`status.indicator.${r.status}`),
      cell: (r) => (
        <MonthMini
          status={r.statusAt ? { code: r.status, at: r.statusAt, actor: null } : null}
          needed
        />
      ),
    },
  ];
}

const fetchMissing: FetchListPage<KpiMissingRow> = async (params) => {
  const res = await api.api.kpi.missing.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return KpiMissingList.parse(await res.json());
};

const fetchMissingValues = async (col: string, q?: string) => {
  const res = await api.api.kpi.missing.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

export function KpiMissingTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const phone = useMediaQuery(PHONE_QUERY);
  const labels = useGridLabels('kpi.missing.count');
  const indicators = useQuery(indicatorsQuery);
  const cols = useMemo(
    () => (indicators.data?.items ?? []).filter((i) => !i.archived),
    [indicators.data],
  );
  const view = useViewSettings('kpi.missing');
  // Вид «Таблица» — ввод как в Excel; в «Карточках» ячеек нет (прототип `kGridEx`).
  const excel = effectiveView(view.settings, phone) === 'table';
  const current = monthOf(todayBishkek());
  const columns = useMemo(() => missingColumns(t, cols, current, excel), [t, cols, current, excel]);
  // Необязательные показатели скрыты, включаются в «Столбцах» (прототип `vcol(i, !i.req)`).
  const defaultVisible = useMemo(
    () => [
      'cp',
      'm',
      ...cols.filter((c) => c.required).map((c) => valueKey(c.id)),
      'miss',
      'resp',
      'due',
      'over',
      'st',
    ],
    [cols],
  );
  const { search, clearSearch, access } = useShell();
  const entry = useKpiEntry();
  const list = useListPage({
    gridKey: 'kpi.missing',
    columns,
    audit: false,
    defaultVisible,
    settings: view.settings,
    defaultSort: DEFAULT_SORT,
    search,
    enabled: view.ready && indicators.isSuccess,
    fetchPage: fetchMissing,
  });
  const { params, visible } = list;
  const sendExport = useCallback(
    () => api.api.kpi.missing.export.$get({ query: { ...params, cols: visible.join(',') } }),
    [params, visible],
  );
  const exporter = useListExport(sendExport);

  // Таблица как в Excel: ячейки — по порядку строк страницы, ключ ячейки — `data-kx`.
  const keys = useRef<string[][]>([]);
  const rowsById = new Map((list.data?.items ?? []).map((r) => [r.id, r]));
  const colsById = new Map(cols.map((c) => [c.id, c]));
  const at = (r: number, c: number): KxRef | null => {
    const [cid, ind, m] = (keys.current[r]?.[c] ?? '').split('|');
    const row = rowsById.get(`${cid}|${m}`);
    const col = ind ? colsById.get(ind) : undefined;
    return row && col ? missingRef(row, col) : null;
  };
  /**
   * Сохранить: сразу в строках, потом на сервере. Список не перечитывается — заполненная строка
   * остаётся до обновления (прототип); счётчики, плашки и «За период» — перечитываются.
   */
  const save = async (changes: CellChange[]) => {
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: changes } }));
    void Promise.all([
      client.invalidateQueries({ queryKey: ['kpi'] }),
      client.invalidateQueries({ queryKey: ['list', 'kpi.period'] }),
    ]);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      void client.invalidateQueries({ queryKey: ['list', 'kpi.missing'] });
      return false;
    }
    const done = KpiValuesSaved.parse(res.data);
    client.setQueriesData<{ items: KpiMissingRow[] }>(
      { queryKey: ['list', 'kpi.missing'] },
      (old) => patchedMissing(old, cols, changes, done.statuses),
    );
    return true;
  };
  const rowOf = (r: number, c: number) => {
    const x = at(r, c);
    return x ? { x, row: rowsById.get(`${x.contractorId}|${x.month}`)! } : null;
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
        const p = rowOf(r, c);
        return p
          ? t('kpi.ex.cell_label', {
              name: p.row.contractorName,
              ind: colsById.get(p.x.indicatorId)?.name ?? '',
              month: monthName(t, p.x.month),
            })
          : t('kpi.ex.cell');
      },
      menu: (r, c) => {
        const p = rowOf(r, c);
        return p
          ? [
              {
                id: 'entry',
                label: t('kpi.ex.menu.entry'),
                icon: 'clip',
                sub: `${p.row.contractorName} · ${monthName(t, p.x.month)}`,
                run: () => void entry.open(p.x.contractorId, p.x.month),
              },
            ]
          : [];
      },
    },
    { enabled: excel },
  );

  return (
    <div className="flex flex-col gap-3.5">
      <KpiPlates />
      <Note>{t('kpi.missing.note')}</Note>
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
          data={view.ready && indicators.isSuccess ? list.data : undefined}
          onPageChange={list.setPage}
          error={list.error}
          errorText={list.errorText}
          errorTextOf={list.errorTextOf}
          onRetry={list.retry}
          filters={list.filters}
          onFiltersChange={list.setFilters}
          loadValues={fetchMissingValues}
          search={search}
          onClearSearch={clearSearch}
          onExport={access.can('export') ? () => void exporter.run() : undefined}
          exporting={exporter.exporting}
          empty={
            <EmptyState
              icon="ok"
              title={t('kpi.missing.empty_title')}
              text={t('kpi.missing.empty_text')}
            />
          }
          rowKey={(r) => r.id}
          titleKey="cp"
          // Всё внесено — строка больше не красная (прототип `after`), до обновления списка.
          rowTone={(r) => (r.overdueDays > 0 && r.missing.length > 0 ? 'overdue' : undefined)}
          label={t('tab.kpi.missing')}
          labels={labels}
          onOpen={(r) => void entry.open(r.contractorId, r.month)}
        />
      </div>
      {exMenu}
      {entry.dialog}
    </div>
  );
}
