'use client';

import { dmShownColumns, formatCount, type DmOutTexts } from '@buhuchet/domain';
import { DataGrid, EmptyState, Note, PHONE_QUERY, useMediaQuery } from '@buhuchet/ui';
import { useCallback, useMemo, useRef } from 'react';
import { EX_WRAP, useExTable } from '../kpi/use-ex-table';
import { useT } from '../l10n/provider';
import { useListExport } from '../lists/export';
import { useGridLabels } from '../lists/grid-labels';
import { useListPage } from '../lists/use-list-page';
import { useViewSettings } from '../lists/view-settings';
import { useShell } from '../shell/context';
import { exportOut, type DmExportRun } from './out-data';
import {
  numberOutCells,
  outColumns,
  outExCell,
  outPageOf,
  outValuesOf,
  type DmOutResult,
  type OutCellRef,
} from './out-model';

const GRID_KEY = 'dm.out';

/** «В Excel» таблицы: тот же запуск, что на экране; нет — нет кнопки (нет права «Выгружать в Excel»). */
export type OutExport = DmExportRun;

/**
 * Таблица результата «Вывода» (доработки 20.11.2026: Витрина данных, блок 4, пункты 2–5; прототип v155
 * `dmDraw`, `dmCol`, `dmEx`): общий список в виде «Таблица» (сортировка, фильтры, поиск, группы и
 * итоги — по всему результату, `outPageOf`), по умолчанию «Все записи» (по 5 000 на странице), сверху
 * — «Строк: N · выполнено за X мс» и строка состояния таблицы как в Excel только для просмотра:
 * выделение, количество, сумма и среднее, Ctrl+C для вставки в Excel. Строк больше 50 000 — первые и
 * уведомление.
 */
export function OutTable({
  result,
  run,
  exportRun,
}: {
  result: DmOutResult;
  /** Номер показа: новый результат — новый запрос страницы. */
  run: string;
  exportRun?: OutExport;
}) {
  const t = useT();
  const phone = useMediaQuery(PHONE_QUERY);
  const { search, clearSearch } = useShell();
  const labels = useGridLabels('dm.out.count');
  const texts: DmOutTexts = useMemo(() => ({ yes: t('dm.out.yes'), no: t('dm.out.no') }), [t]);
  const columns = useMemo(() => outColumns(result.columns, texts), [result.columns, texts]);
  const shown = useMemo(() => dmShownColumns(result.columns), [result.columns]);
  const visible = useMemo(() => columns.map((c) => c.key), [columns]);
  const view = useViewSettings(GRID_KEY);
  // По умолчанию — все строки (прототип `size: 'all'`); выбор пользователя сохраняется в виде списка.
  const settings = useMemo(
    () => (view.settings.size ? view.settings : { ...view.settings, size: 'all' as const }),
    [view.settings],
  );
  const { rows } = result;
  const fetchPage = useCallback(
    (params: Record<string, string>) =>
      Promise.resolve(outPageOf(rows, result.columns, params, texts)),
    [rows, result.columns, texts],
  );
  const loadValues = useCallback(
    (key: string, q?: string) => Promise.resolve(outValuesOf(rows, result.columns, key, texts, q)),
    [rows, result.columns, texts],
  );
  const list = useListPage({
    gridKey: GRID_KEY,
    columns,
    audit: false,
    defaultVisible: visible,
    settings,
    defaultSort: null,
    search,
    enabled: view.ready,
    fetchPage,
    extra: { run },
  });
  const { params } = list;
  const sendExport = useCallback(
    () =>
      exportOut(exportRun!, {
        // Номер показа — только ключ страницы на экране, серверу он не нужен.
        ...Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'run')),
        cols: list.visible.join(','),
      }),
    [exportRun, params, list.visible],
  );
  const exporter = useListExport(sendExport);

  // Ячейки страницы по координатам таблицы как в Excel (прототип `dmEx`).
  const cells = useRef<OutCellRef[][]>([]);
  const at = (r: number, c: number) => cells.current[r]?.[c];
  const why = t('dm.out.ro');
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable(
    {
      number: (wrap) => {
        cells.current = numberOutCells(wrap);
        return {
          rows: cells.current.length,
          cols: Math.max(0, ...cells.current.map((r) => r.length)),
        };
      },
      get: (r, c) => {
        const x = at(r, c);
        return outExCell(shown, x ? rows[x.row] : undefined, x?.col ?? -1, texts, why);
      },
      key: (r, c) => {
        const x = at(r, c);
        return x ? `${x.row}:${x.col}` : null;
      },
      put: () => Promise.resolve({ bad: [], changed: [] }),
      label: (r, c) => {
        const x = at(r, c);
        const s = x ? shown[x.col] : undefined;
        return s ? s.col.name : t('kpi.ex.cell');
      },
    },
    { ro: true, hint: [[t(phone ? 'dm.out.hint_phone' : 'dm.out.hint')]] },
  );

  const meta = result.orgName
    ? t('dm.out.meta_org', { n: formatCount(rows.length), ms: result.ms, org: result.orgName })
    : t('dm.out.meta', { n: formatCount(rows.length), ms: result.ms });

  return (
    <div className="flex flex-col gap-2" data-dm-out-result="">
      <div className="text-[12.5px] text-muted" data-dm-out-meta="">
        {meta}
      </div>
      {result.more ? (
        <Note tone="warn" icon="alert">
          <span data-dm-out-more="">{t('dm.out.more', { max: formatCount(result.max) })}</span>
        </Note>
      ) : null}
      {rows.length ? exStat : null}
      <div ref={exRef} className={EX_WRAP}>
        {exLayer}
        <DataGrid
          columns={columns}
          defaultVisible={visible}
          defaultSort={null}
          settings={settings}
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
          onExport={exportRun ? () => void exporter.run() : undefined}
          exporting={exporter.exporting}
          fixedView="table"
          empty={
            <EmptyState
              icon="search"
              title={t('dm.out.empty_title')}
              text={t('dm.out.empty_text')}
            />
          }
          rowKey={(r) => String(r.i)}
          label={t('tab.dm.out')}
          labels={labels}
        />
      </div>
      {exMenu}
    </div>
  );
}
