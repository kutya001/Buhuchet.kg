'use client';

import {
  enumChecked,
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
import { Chip } from '../chip';
import { iconButtonClass, linkButtonClass, TOUCH_AREA } from '../button';
import { EmptyState, NothingFound } from '../empty-state';
import { FloatingPanel } from '../floating';
import { Icon } from '../icon';
import { useToast } from '../toast';
import { PHONE_QUERY, useMediaQuery } from '../use-media';
import { auditColumns } from './audit';
import { FilterPanel, type ValueLabels } from './grid-filter';
import {
  boardColumns,
  boardKey,
  boardKeys,
  boardTargets,
  type BoardColumn,
  type GridKanban,
} from './grid-board';
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
import { GridKanban as GridBoard } from './grid-kanban';
import { GridTable, type GridTableGroups } from './grid-table';
import { GridFoldButton, GridToolbar, type GridFold } from './grid-toolbar';
import { useRowEvents } from './row-events';
import type {
  GridAudit,
  GridBulkAction,
  GridColumn,
  GridLabels,
  GridPage,
  GridRowSelection,
  GridRowStripe,
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
  // ОТКЛОНЕНИЕ: docs/deviations.md#42 — в прототипе сервера нет, ошибка всегда про подключение.
  /** Причина ошибки из ответа сервера вместо «Проверьте подключение к интернету…»; нет — общий текст. */
  errorText?: string | null;
  /** Причина ошибки загрузки значений фильтра-галочек тем же правилом; null — общий текст. */
  errorTextOf?: (error: unknown) => string | null;
  onRetry?: () => void;
  /** Что показать, если записей нет: `EmptyState` или `NothingFound` (при поиске и фильтрах). */
  empty: ReactNode;
  rowKey: (row: Row) => string;
  /** Столбец-заголовок карточки (`title` прототипа); по умолчанию — первый видимый. */
  titleKey?: string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  /** Цветная полоска слева: поверх полоски тона, фон тона остаётся. */
  rowStripe?: (row: Row) => GridRowStripe | undefined;
  /** Действия записи: меню «⋯», правый клик, долгое нажатие. */
  actions?: (row: Row) => readonly ActionEntry[];
  /** Открыть запись (карточку) нажатием на строку или Enter. */
  onOpen?: (row: Row) => void;
  /** Карточки нет: нажатие на строку и Enter открывают меню действий у строки (прототип: `open` — `menu`). */
  openMenu?: boolean;
  /** Массовые действия: есть — у строк галочки, при выборе — панель «Выбрано: N». */
  bulk?: readonly GridBulkAction<Row>[];
  /** Вид закреплён модулем: переключателя «Таблица / Карточки» нет. */
  fixedView?: 'table' | 'cards';
  /**
   * Вид «Доска» (канбан): есть — третий вид списка. Экран в этом виде просит у сервера записи,
   * сгруппированные по столбцу доски (`useListPage` с тем же `kanban`).
   */
  kanban?: GridKanban<Row>;
  /**
   * Своя карточка записи в виде «Карточки» (прототип `cardHtml`: видео — обложкой во всю ширину);
   * нет — заголовок и пары «подпись — значение» видимых столбцов.
   */
  cardRender?: (row: Row) => ReactNode;
  /** Своя строка на панели вместо числа записей (прототип `caption`). */
  caption?: ReactNode;
  /**
   * Фильтры столбцов (ТЗ «Поиск и фильтры»): живут на экране и уходят на сервер вместе со страницей;
   * без `onFiltersChange` кнопок фильтра у заголовков нет.
   */
  filters?: Filters;
  onFiltersChange?: (filters: Record<string, ListFilterValue>) => void;
  /**
   * Значения столбца для фильтра-галочек (справочник, статус) с числом записей — с сервера; `q` —
   * «Найти значение» по всем значениям столбца.
   */
  loadValues?: (key: string, q?: string) => Promise<GridValues>;
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
  errorText,
  errorTextOf,
  onRetry,
  empty,
  rowKey,
  titleKey,
  rowTone,
  rowStripe,
  actions,
  onOpen,
  openMenu = false,
  bulk,
  fixedView,
  kanban,
  cardRender,
  caption,
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
  // `move` — второй шаг меню карточки доски: «Перенести в столбец…» → список столбцов.
  const [menu, setMenu] = useState<{ row: Row; place: MenuPlace; move?: boolean } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const keys = columns.map((c) => c.key);
  // Доска: её столбец — значение столбца списка; записи приходят сгруппированными по нему.
  const kbKey = kanban ? boardKey(kanban, keys, settings) : null;
  const view = effectiveView(settings, phone, fixedView, kbKey !== null);
  const onBoard = view === 'kanban' && kanban !== undefined && kbKey !== null;
  const canMove = onBoard && !!kanban.drop;
  const events = useRowEvents<Row>({
    onOpen,
    onMenu: actions || canMove ? (row, place) => setMenu({ row, place }) : undefined,
    hasMenu:
      actions || canMove
        ? (row) => canMove || (actions ? actions(row).length > 0 : false)
        : undefined,
    openMenu,
  });

  const shown = screenVisibleKeys(columns, settings, defaultVisible, phone);
  const visible = shown.map((k) => columns.find((c) => c.key === k)!);
  // На доске группировки нет: вместо неё — столбец доски.
  const group = onBoard ? [] : effectiveGroup(keys, settings);
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
  // Столбцы доски: группы с сервера и столбцы, которые видны и пустыми.
  const boardFilter = onBoard ? filters[kbKey] : undefined;
  const board =
    onBoard && data?.groups
      ? boardColumns({
          groups: data.groups,
          rows: data.items,
          rowGroups: data.rowGroups ?? [],
          order: kanban.order?.[kbKey],
          show: kanban.show?.[kbKey],
          merge: kanban.merge?.[kbKey],
          searching,
          allowed:
            boardFilter?.type === 'enum'
              ? (v) => enumChecked(boardFilter, v.key, v.label)
              : undefined,
        })
      : null;
  const boardOf = (row: Row): BoardColumn<Row> | undefined => {
    const id = rowKey(row);
    return board?.columns.find((c) => c.rows.some((r) => rowKey(r) === id));
  };
  const moveTo = (row: Row, to: BoardColumn<Row>) => {
    if (!onBoard || !kanban.drop) return;
    kanban.drop(row, kbKey, { key: to.key, label: to.label ?? labels.empty });
  };
  /** Пункты меню записи; на доске с переносом — ещё «Перенести в столбец…» (телефон и клавиатура). */
  const menuItems = (row: Row): readonly ActionEntry[] => {
    const own = actions ? actions(row) : [];
    if (!canMove || !board || board.columns.length < 2) return own;
    const move: ActionEntry = {
      id: 'board-move',
      label: labels.boardMove,
      icon: 'board',
      sub: columns.find((c) => c.key === kbKey)?.label,
      // Меню записи закрывается до действия пункта — следом у той же карточки открывается список столбцов.
      run: () => {
        if (menu) setMenu({ ...menu, move: true });
      },
    };
    return own.length ? [...own, { id: 'board-sep', separator: true }, move] : [move];
  };
  const moveItems = (row: Row): readonly ActionEntry[] =>
    boardTargets(board?.columns ?? [], boardOf(row)?.key ?? '\u0000').map((c) => ({
      id: `to-${c.key}`,
      label: c.label ?? labels.empty,
      run: () => moveTo(row, c),
    }));
  // Группы есть — одна кнопка над списком сворачивает их все или, если все свёрнуты, разворачивает.
  const allPaths = tree ? groupPaths(tree) : [];
  const fold: GridFold | undefined = allPaths.length
    ? {
        shut: allPaths.every((p) => closedPaths.has(p)),
        onToggle: () =>
          setClosedPaths(allPaths.every((p) => closedPaths.has(p)) ? new Set() : new Set(allPaths)),
      }
    : undefined;
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
        text={errorText ?? labels.loadErrorText}
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
  } else if (onBoard) {
    body = board ? (
      <GridBoard
        columns={visible}
        allColumns={columns}
        titleKey={titleKey}
        boardKey={kbKey}
        sumKey={visible.find((c) => c.total)?.key}
        board={board.columns}
        cut={board.cut}
        rowKey={rowKey}
        rowTone={rowTone}
        rowStripe={rowStripe}
        clickable={!!onOpen || (openMenu && !!actions)}
        events={events}
        hasMenu={(row) => menuItems(row).length > 0}
        draggable={canMove && !phone}
        onMove={moveTo}
        labels={labels}
      />
    ) : (
      // Вид только что сменили: прежняя страница пришла без столбцов доски.
      <GridSkeleton />
    );
  } else if (view === 'table') {
    body = (
      <GridTable
        columns={visible}
        allKeys={keys}
        rows={data.items}
        rowKey={rowKey}
        rowTone={rowTone}
        rowStripe={rowStripe}
        settings={settings}
        onSettingsChange={onSettingsChange}
        sort={sort}
        onSort={(key) => onSettingsChange(toggleSort(settings, defaultSort, keys, key))}
        totals={data.totals}
        total={data.total}
        hasActions={!!actions}
        clickable={!!onOpen || (openMenu && !!actions)}
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
        rowStripe={rowStripe}
        clickable={!!onOpen || (openMenu && !!actions)}
        events={events}
        selection={selection}
        totals={data.totals}
        total={data.total}
        groups={groups}
        labels={labels}
        render={cardRender}
      />
    );
  }
  const filterColumn = filterAt ? columns.find((c) => c.key === filterAt.key) : undefined;

  return (
    <div
      data-grid
      data-density={settings.density ?? 'normal'}
      data-view={view}
      className={`flex min-w-0 flex-col gap-2.5 ${settings.width === 'center' && !onBoard ? 'mx-auto w-full max-w-[1180px]' : ''}`}
    >
      <GridToolbar
        columns={columns}
        defaultVisible={defaultVisible}
        settings={settings}
        onSettingsChange={onSettingsChange}
        onResetView={onResetView}
        view={view}
        fixedView={fixedView}
        board={
          kanban && kbKey !== null
            ? {
                key: kbKey,
                options: boardKeys(kanban, keys).map((k) => ({
                  key: k,
                  label: columns.find((c) => c.key === k)!.label,
                })),
              }
            : undefined
        }
        phone={phone}
        total={error ? null : total}
        caption={caption}
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
        fold={fold}
        onExport={onExport}
        exporting={exporting}
        labels={labels}
      />
      {(filterKeys.length > 0 || group.length > 0 || searching) && (
        <GridChips
          group={group.map((k) => columns.find((c) => c.key === k)!.label)}
          fold={phone && fold ? <GridFoldButton fold={fold} phone labels={labels} /> : null}
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
      {!error && !loading && data && data.total > 0 && board && (
        <div
          className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"
          data-grid-footer
        >
          <span>{labels.boardShown(board.columns.length, data.total)}</span>
          <div className="flex-1" />
          {canMove && (
            <span className="text-faint" data-board-tip>
              {phone ? labels.boardTipMenu : labels.boardTipDrag}
            </span>
          )}
        </div>
      )}
      {!error && !loading && data && data.total > 0 && tree && (
        <div
          className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted"
          data-grid-footer
        >
          <span>{labels.groupsShown(tree.length, data.total)}</span>
        </div>
      )}
      {!error &&
        !loading &&
        data &&
        data.total > 0 &&
        (!(tree || onBoard) || pageCount(data.total, 'all') > 1) && (
          <GridFooter
            page={data.page}
            total={data.total}
            size={tree || onBoard ? 'all' : size}
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
            errorTextOf={errorTextOf}
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
      {menu && (actions || canMove) && (
        <ActionMenu
          key={menu.move ? 'move' : 'actions'}
          items={menu.move ? moveItems(menu.row) : menuItems(menu.row)}
          place={menu.place}
          label={menu.move ? labels.boardMove : labels.actions}
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
  fold,
  search,
  onClearSearch,
  filters,
  onRemove,
  onResetAll,
  labels,
}: {
  group: readonly string[];
  onUngroup: () => void;
  /** Телефон: значок «Свернуть все / Развернуть все» рядом с чипом «Группировка». */
  fold?: ReactNode;
  search: string | null;
  onClearSearch?: () => void;
  filters: readonly { key: string; label: string; text: string }[];
  onRemove: (key: string) => void;
  onResetAll: () => void;
  labels: GridLabels;
}) {
  const chip = (key: string, name: string, text: string, clear: string, onClear?: () => void) => (
    <Chip key={key} id={key} clear={clear} onClear={onClear}>
      <b className="font-[650]">{name}</b> {text}
    </Chip>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-grid-chips>
      {group.length > 0 &&
        chip('group', labels.chipGroup, group.join(' → '), labels.ungroup, onUngroup)}
      {group.length > 0 && fold}
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
