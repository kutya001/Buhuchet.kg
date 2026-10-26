'use client';

import {
  LIST_PAGE_SIZES,
  pageCount,
  shownRange,
  toggleGroupLevel,
  type GridViewSettings,
  type ListFilterValue,
  type ListPageSize,
  type ListSort,
} from '@buhuchet/domain';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActionMenu, type ActionEntry, type MenuPlace } from '../action-menu';
import { iconButtonClass, linkButtonClass, TOUCH_AREA } from '../button';
import { EmptyState, NothingFound } from '../empty-state';
import { FloatingPanel } from '../floating';
import { Icon } from '../icon';
import { useToast } from '../toast';
import { PHONE_QUERY, useMediaQuery } from '../use-media';
import { auditColumns } from './audit';
import { FilterPanel, type ValueLabels } from './grid-filter';
import { activeFilterKeys, chipText, unlabeledEnumFilters } from './grid-filters';
import { effectiveGroup, groupAggs, groupPaths, groupTree, withGroup } from './grid-groups';
import {
  effectiveSort,
  effectiveView,
  pageSizeOf,
  screenVisibleKeys,
  toggleSort,
} from './grid-state';
import { GridCards } from './grid-cards';
import { GridTable, type GridTableGroups } from './grid-table';
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
  GridValues,
} from './types';

type Filters = Readonly<Record<string, ListFilterValue>>;
const NO_FILTERS: Filters = {};

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
  /**
   * Фильтры столбцов (ТЗ «Поиск и фильтры»): живут на экране и уходят на сервер вместе со страницей;
   * без `onFiltersChange` кнопок фильтра у заголовков нет.
   */
  filters?: Filters;
  onFiltersChange?: (filters: Record<string, ListFilterValue>) => void;
  /** Значения столбца для фильтра-галочек (справочник, статус) с числом записей — с сервера. */
  loadValues?: (key: string) => Promise<GridValues>;
  /** Текст общего поиска: чип «Поиск: «…»» и «Ничего не найдено»; `onClearSearch` очищает поиск. */
  search?: string;
  onClearSearch?: () => void;
  /** «В Excel» (по праву «Выгружать в Excel»): файл со всеми отфильтрованными записями собирает сервер. */
  onExport?: () => void;
  exporting?: boolean;
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
  filters = NO_FILTERS,
  onFiltersChange,
  loadValues,
  search = '',
  onClearSearch,
  onExport,
  exporting,
  label,
  labels,
}: DataGridProps<Row>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const toast = useToast();
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
    hasMenu: actions ? (row) => actions(row).length > 0 : undefined,
  });

  const keys = columns.map((c) => c.key);
  const shown = screenVisibleKeys(columns, settings, defaultVisible, phone);
  const visible = shown.map((k) => columns.find((c) => c.key === k)!);
  const group = effectiveGroup(keys, settings);
  const groupKey = group.join('|');
  // Свёрнутые группы — пока группировка та же (прототип `s.closed`, сбрасывается при смене уровней).
  const [closed, setClosed] = useState<{ key: string; paths: ReadonlySet<string> }>(() => ({
    key: groupKey,
    paths: new Set(),
  }));
  const closedPaths = closed.key === groupKey ? closed.paths : new Set<string>();
  const setClosedPaths = (paths: ReadonlySet<string>) => setClosed({ key: groupKey, paths });
  // Меню столбца у кнопки фильтра и подписи значений галочек для чипов.
  const [filterAt, setFilterAt] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const closeFilter = useCallback(() => setFilterAt(null), []);
  const [valueLabels, setValueLabels] = useState<Readonly<Record<string, ValueLabels>>>({});
  const filterKeys = activeFilterKeys(filters, keys);
  // Фильтр-галочки, поставленный не из меню столбца (плашкой статистики): подписи значений для чипа
  // подгружаются тем же методом значений столбца — один раз на столбец.
  const unlabeled = unlabeledEnumFilters(filters, keys, valueLabels).join('|');
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!loadValues || !unlabeled) return;
    for (const key of unlabeled.split('|')) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      loadValues(key).then(
        (res) => {
          const names = Object.fromEntries(res.items.map((i) => [i.value, i.label]));
          setValueLabels((prev) => ({ ...prev, [key]: { ...names, ...prev[key] } }));
        },
        () => {},
      );
    }
  }, [unlabeled, loadValues]);
  const searching = search.trim() !== '';
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

  const tree =
    group.length && data?.groups ? groupTree(data.groups, data.items, data.rowGroups ?? []) : null;
  const groups: GridTableGroups<Row> | undefined = tree
    ? {
        tree,
        closed: closedPaths,
        onToggle: (path) => {
          const next = new Set(closedPaths);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          setClosedPaths(next);
        },
        aggs: groupAggs(columns, shown, settings),
      }
    : undefined;

  const setFilter = (key: string, filter: ListFilterValue | null) => {
    if (!onFiltersChange) return;
    const next = { ...filters };
    if (filter) next[key] = filter;
    else delete next[key];
    onFiltersChange(next);
  };
  const resetAll = () => {
    onFiltersChange?.({});
    onClearSearch?.();
  };
  const toggleGroupBy = (key: string) => {
    const { group: next, replaced } = toggleGroupLevel(group, key);
    onSettingsChange(withGroup(settings, next));
    if (replaced) toast(labels.groupReplaced, { icon: 'layers' });
  };

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
    body =
      filterKeys.length || searching ? (
        <NothingFound
          title={labels.notFound}
          text={labels.notFoundText}
          resetLabel={labels.resetFilters}
          onReset={resetAll}
        />
      ) : (
        empty
      );
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
        filter={
          onFiltersChange
            ? {
                filtered: (key) => key in filters,
                open: filterAt?.key ?? null,
                onOpen: (key, anchor) =>
                  setFilterAt((at) => (at?.key === key ? null : { key, anchor })),
              }
            : undefined
        }
        groups={groups}
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
        clickable={!!onOpen}
        events={events}
        selection={selection}
        totals={data.totals}
        total={data.total}
        groups={groups}
        labels={labels}
      />
    );
  }
  const filterColumn = filterAt ? columns.find((c) => c.key === filterAt.key) : undefined;

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
        group={group}
        onGroupChange={() => setClosedPaths(new Set())}
        onExport={onExport}
        exporting={exporting}
        labels={labels}
      />
      {(filterKeys.length > 0 || group.length > 0 || searching) && (
        <GridChips
          group={group.map((k) => columns.find((c) => c.key === k)!.label)}
          onUngroup={() => onSettingsChange(withGroup(settings, []))}
          search={searching ? search : null}
          onClearSearch={onClearSearch}
          filters={filterKeys.map((key) => {
            const column = columns.find((c) => c.key === key)!;
            const names = valueLabels[key] ?? {};
            return {
              key,
              label: column.label,
              text: chipText(column.type, filters[key]!, labels, (v) => names[v] ?? v),
            };
          })}
          onRemove={(key) => setFilter(key, null)}
          onResetAll={resetAll}
          labels={labels}
        />
      )}
      {body}
      {!error && !loading && data && data.total > 0 && tree && (
        <div
          className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"
          data-grid-footer
        >
          <span>{labels.groupsShown(tree.length, data.total)}</span>
          <div className="flex-1" />
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => setClosedPaths(new Set())}
          >
            {labels.expandAll}
          </button>
          <button
            type="button"
            className={linkButtonClass()}
            onClick={() => setClosedPaths(new Set(groupPaths(tree)))}
          >
            {labels.collapseAll}
          </button>
        </div>
      )}
      {!error &&
        !loading &&
        data &&
        data.total > 0 &&
        (!tree || pageCount(data.total, 'all') > 1) && (
          <GridFooter
            page={data.page}
            total={data.total}
            size={tree ? 'all' : size}
            onPageChange={onPageChange}
            onSizeChange={(next) => {
              onSettingsChange({ ...settings, size: next });
              onPageChange(1);
            }}
            labels={labels}
          />
        )}
      {filterAt && filterColumn && onFiltersChange && (
        <FloatingPanel anchor={filterAt.anchor} label={filterColumn.label} onClose={closeFilter}>
          <FilterPanel
            column={filterColumn}
            filter={filters[filterColumn.key]}
            grouped={group.includes(filterColumn.key)}
            loadValues={loadValues}
            onApply={(filter, names) => {
              if (names) setValueLabels((prev) => ({ ...prev, [filterColumn.key]: names }));
              setFilter(filterColumn.key, filter);
              closeFilter();
            }}
            onToggleGroup={() => {
              toggleGroupBy(filterColumn.key);
              closeFilter();
            }}
            labels={labels}
          />
        </FloatingPanel>
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
 * Чипы над списком (прототип ui/grid.js, `.chips`; ТЗ «Активные фильтры видны «чипами» над таблицей с
 * кнопкой «Сбросить всё»»): группировка «A → B», поиск «…» и фильтры столбцов, у каждого — крестик;
 * «Сбросить всё» убирает фильтры и поиск (группировка остаётся — она часть вида).
 */
export function GridChips({
  group,
  onUngroup,
  search,
  onClearSearch,
  filters,
  onRemove,
  onResetAll,
  labels,
}: {
  group: readonly string[];
  onUngroup: () => void;
  search: string | null;
  onClearSearch?: () => void;
  filters: readonly { key: string; label: string; text: string }[];
  onRemove: (key: string) => void;
  onResetAll: () => void;
  labels: GridLabels;
}) {
  const chip = (key: string, name: string, text: string, clear: string, onClear?: () => void) => (
    <span
      key={key}
      data-chip={key}
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-bg py-0.5 pr-1 pl-2.5 text-[12.5px] font-[550] text-info"
    >
      <span className="truncate">
        <b className="font-[650]">{name}</b> {text}
      </span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clear}
          title={clear}
          className={`${TOUCH_AREA} grid h-5 w-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-inherit hover:bg-info-bg`}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-grid-chips>
      {group.length > 0 &&
        chip('group', labels.chipGroup, group.join(' → '), labels.ungroup, onUngroup)}
      {search !== null &&
        chip('search', labels.chipSearch, `«${search}»`, labels.clearSearch, onClearSearch)}
      {filters.map((f) =>
        chip(f.key, `${f.label}:`, f.text, labels.removeFilter, () => onRemove(f.key)),
      )}
      <button
        type="button"
        onClick={onResetAll}
        className={`${linkButtonClass()} text-[12.5px]`}
        data-grid-reset
      >
        {labels.resetAll}
      </button>
    </div>
  );
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
        className={`${iconButtonClass('sm')} ${TOUCH_AREA} disabled:cursor-not-allowed disabled:opacity-40`}
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
        className={`${iconButtonClass('sm')} ${TOUCH_AREA} disabled:cursor-not-allowed disabled:opacity-40`}
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
