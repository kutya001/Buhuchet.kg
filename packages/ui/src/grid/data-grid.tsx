'use client';

import {
  LIST_PAGE_SIZES,
  pageCount,
  shownRange,
  type GridViewSettings,
  type ListPageSize,
  type ListSort,
} from '@buhuchet/domain';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActionMenu, type ActionEntry, type MenuPlace } from '../action-menu';
import { iconButtonClass } from '../button';
import { EmptyState } from '../empty-state';
import { Icon } from '../icon';
import { PHONE_QUERY, useMediaQuery } from '../use-media';
import { auditColumns } from './audit';
import { effectiveSort, effectiveView, pageSizeOf, toggleSort, visibleKeys } from './grid-state';
import { GridCards } from './grid-cards';
import { GridTable } from './grid-table';
import { GridToolbar } from './grid-toolbar';
import { useRowEvents } from './row-events';
import type {
  GridAudit,
  GridBulkAction,
  GridColumn,
  GridLabels,
  GridPage,
  GridRowSelection,
  GridRowTone,
} from './types';

export interface DataGridProps<Row> {
  /** Столбцы модуля; служебные «Создал», «Изменил», «Создано», «Изменено» список добавит сам. */
  columns: readonly GridColumn<Row>[];
  /** Значения служебных столбцов строкой; без них служебных столбцов нет. */
  audit?: GridAudit<Row>;
  /** Столбцы, видимые по умолчанию (ТЗ «Столбцы, видимые по умолчанию»); остальные — в «Столбцы». */
  defaultVisible: readonly string[];
  /** Сортировка по умолчанию — «Создано», от новых к старым. */
  defaultSort: ListSort | null;
  /** Настройки вида пользователя (хранит сервер); `onSettingsChange` получает новые целиком. */
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  /** «Сбросить вид»: экран удаляет сохранённые настройки. */
  onResetView: () => void;
  /** Текущая страница с сервера; нет — ещё не загружена. */
  data: GridPage<Row> | undefined;
  onPageChange: (page: number) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Что показать, если записей нет: `EmptyState` или `NothingFound` (при поиске и фильтрах). */
  empty: ReactNode;
  rowKey: (row: Row) => string;
  /** Столбец-заголовок карточки (`title` прототипа); по умолчанию — первый видимый. */
  titleKey?: string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  /** Действия записи: меню «⋯», правый клик, долгое нажатие. */
  actions?: (row: Row) => readonly ActionEntry[];
  /** Открыть запись (карточку) нажатием на строку или Enter. */
  onOpen?: (row: Row) => void;
  /** Массовые действия: есть — у строк галочки, при выборе — панель «Выбрано: N». */
  bulk?: readonly GridBulkAction<Row>[];
  /** Вид закреплён модулем: переключателя «Таблица / Карточки» нет. */
  fixedView?: 'table' | 'cards';
  /** Название списка для экранного диктора, например «Сотрудники». */
  label: string;
  labels: GridLabels;
}

/**
 * Единый компонент списка — UnifiedDataGrid (ТЗ «Списки», прототип ui/grid.js `grid()`): панель с
 * числом записей, видом и «Столбцами», таблица или карточки, страницы внизу, меню действий записи,
 * выбор строк галочками с массовыми действиями, служебные столбцы «Создал… Изменено», заготовка при
 * загрузке, ошибка с «Повторить» и пустое состояние. Сортировка, страницы и фильтры
 * считает сервер: в браузер приходит только текущая страница разрешённых записей. Настройки вида —
 * пропсом, экран сохраняет их на сервере для пользователя.
 */
export function DataGrid<Row>({
  columns: moduleColumns,
  audit,
  defaultVisible,
  defaultSort,
  settings,
  onSettingsChange,
  onResetView,
  data,
  onPageChange,
  loading = false,
  error = false,
  onRetry,
  empty,
  rowKey,
  titleKey,
  rowTone,
  actions,
  onOpen,
  bulk,
  fixedView,
  label,
  labels,
}: DataGridProps<Row>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const columns = useMemo(
    () => (audit ? [...moduleColumns, ...auditColumns(audit, labels)] : moduleColumns),
    [moduleColumns, audit, labels],
  );
  // Отмеченные строки — по ключу записи; выбор переживает переход по страницам до «Снять выбор».
  const [picked, setPicked] = useState<ReadonlyMap<string, Row>>(() => new Map());
  const [menu, setMenu] = useState<{ row: Row; place: MenuPlace } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const events = useRowEvents<Row>({
    onOpen,
    onMenu: actions ? (row, place) => setMenu({ row, place }) : undefined,
  });

  const keys = columns.map((c) => c.key);
  const shown = visibleKeys(keys, settings, defaultVisible);
  const visible = shown.map((k) => columns.find((c) => c.key === k)!);
  const view = effectiveView(settings, phone, fixedView);
  const sort = effectiveSort(settings, defaultSort, keys);
  const size = pageSizeOf(settings);
  const total = data?.total ?? null;
  const pageRows = data?.items ?? [];
  const selection: GridRowSelection<Row> | undefined = bulk?.length
    ? {
        has: (row) => picked.has(rowKey(row)),
        toggle: (row, on) => setPicked((prev) => pickRows(prev, [row], on, rowKey)),
        allOnPage: pageRows.length > 0 && pageRows.every((r) => picked.has(rowKey(r))),
        togglePage: (on) => setPicked((prev) => pickRows(prev, pageRows, on, rowKey)),
      }
    : undefined;
  const clearPicked = () => setPicked(new Map());

  let body: ReactNode;
  if (error) {
    body = (
      <EmptyState
        icon="alert"
        title={labels.loadError}
        text={labels.loadErrorText}
        actions={
          onRetry
            ? [
                {
                  id: 'retry',
                  label: labels.retry,
                  icon: 'refresh',
                  primary: true,
                  onClick: onRetry,
                },
              ]
            : []
        }
      />
    );
  } else if (!data || loading) {
    body = <GridSkeleton />;
  } else if (data.total === 0) {
    body = empty;
  } else if (view === 'table') {
    body = (
      <GridTable
        columns={visible}
        allKeys={keys}
        rows={data.items}
        rowKey={rowKey}
        rowTone={rowTone}
        settings={settings}
        onSettingsChange={onSettingsChange}
        sort={sort}
        onSort={(key) => onSettingsChange(toggleSort(settings, defaultSort, keys, key))}
        totals={data.totals}
        total={data.total}
        hasActions={!!actions}
        clickable={!!onOpen}
        events={events}
        selection={selection}
        label={label}
        labels={labels}
      />
    );
  } else {
    body = (
      <GridCards
        columns={visible}
        titleKey={titleKey}
        rows={data.items}
        rowKey={rowKey}
        rowTone={rowTone}
        hasActions={!!actions}
        clickable={!!onOpen}
        events={events}
        selection={selection}
        totals={data.totals}
        total={data.total}
        labels={labels}
      />
    );
  }

  return (
    <div
      data-grid
      data-density={settings.density ?? 'normal'}
      data-view={view}
      className={`flex min-w-0 flex-col gap-2.5 ${settings.width === 'center' ? 'mx-auto w-full max-w-[1180px]' : ''}`}
    >
      <GridToolbar
        columns={columns}
        defaultVisible={defaultVisible}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onResetView={onResetView}
        view={view}
        fixedView={fixedView}
        phone={phone}
        total={error ? null : total}
        selection={
          bulk?.length
            ? {
                count: picked.size,
                actions: bulk,
                onRun: (action) => action.run([...picked.values()], clearPicked),
                onClear: clearPicked,
              }
            : undefined
        }
        labels={labels}
      />
      {body}
      {!error && !loading && data && data.total > 0 && (
        <GridFooter
          page={data.page}
          total={data.total}
          size={size}
          onPageChange={onPageChange}
          onSizeChange={(next) => {
            onSettingsChange({ ...settings, size: next });
            onPageChange(1);
          }}
          labels={labels}
        />
      )}
      {menu && actions && (
        <ActionMenu
          items={actions(menu.row)}
          place={menu.place}
          label={labels.actions}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

/** Отметить или снять строки (галочка строки или «Выбрать все на странице»). */
export function pickRows<Row>(
  prev: ReadonlyMap<string, Row>,
  rows: readonly Row[],
  on: boolean,
  rowKey: (row: Row) => string,
): ReadonlyMap<string, Row> {
  const next = new Map(prev);
  for (const row of rows) {
    if (on) next.set(rowKey(row), row);
    else next.delete(rowKey(row));
  }
  return next;
}

/**
 * Низ списка (прототип `.gfoot`): «Показано 1 – 25 из 250», «На странице» 25 / 50 / 100 / «Все записи»,
 * «Назад» и «Вперёд» с номером страницы.
 */
export function GridFooter({
  page,
  total,
  size,
  onPageChange,
  onSizeChange,
  labels,
}: {
  page: number;
  total: number;
  size: ListPageSize;
  onPageChange: (page: number) => void;
  onSizeChange: (size: ListPageSize) => void;
  labels: GridLabels;
}) {
  const pages = pageCount(total, size);
  const { from, to } = shownRange(page, size, total);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted" data-grid-footer>
      <span>{labels.shown(from, to, total)}</span>
      <div className="flex-1" />
      <label className="inline-flex items-center gap-1.5">
        {labels.perPage}
        <select
          value={String(size)}
          onChange={(e) =>
            onSizeChange(
              e.target.value === 'all' ? 'all' : (Number(e.target.value) as ListPageSize),
            )
          }
          className="min-h-[29px] w-auto rounded-lg border border-line bg-field px-1.5 py-0.5 text-[12.5px] text-ink"
        >
          {LIST_PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="all">{labels.allRows}</option>
        </select>
      </label>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={labels.prev}
        title={labels.prev}
        className={`${iconButtonClass('sm')} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Icon name="left" />
      </button>
      <span className="tabular-nums" data-grid-page>
        {page} / {pages}
      </span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => onPageChange(page + 1)}
        aria-label={labels.next}
        title={labels.next}
        className={`${iconButtonClass('sm')} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Icon name="right" />
      </button>
    </div>
  );
}

/** Заготовка строк при загрузке (прототип `skel()`, `.skel`): шесть строк по пять полосок. */
export function GridSkeleton() {
  return (
    <div
      data-grid-scroll
      aria-busy="true"
      className="flex min-h-[120px] flex-col gap-3.5 rounded-xl border border-line bg-raised p-3.5"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-4">
          {[30, 18, 14, 16, 12].map((w, j) => (
            <div
              key={j}
              style={{ width: `${w + ((i * 7) % 9)}%` }}
              className="h-3.5 animate-shimmer rounded bg-[linear-gradient(90deg,var(--bu-pane-alt)_0,var(--bu-raised)_50%,var(--bu-pane-alt)_100%)] bg-[length:800px_100%]"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
