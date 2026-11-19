'use client';

import {
  GROUP_AGGS,
  groupAggOf,
  groupLevels,
  isNumericColumn,
  type GridViewKind,
  type GridViewSettings,
  type GroupAggChoice,
} from '@buhuchet/domain';
import type { ListSort } from '@buhuchet/domain';
import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { ActionList, ActionMenu, type ActionEntry } from '../action-menu';
import { buttonClass, iconButtonClass, TOUCH_AREA } from '../button';
import { FloatingPanel } from '../floating';
import { inputClass } from '../form';
import { Icon } from '../icon';
import { Popover } from '../popover';
import { withGroup } from './grid-groups';
import {
  gridViews,
  isHidden,
  moveColumn,
  orderedKeys,
  setColumnVisible,
  setView as withView,
  screenVisibleKeys,
  visibleKeys,
} from './grid-state';
import type { GridBulkAction, GridColumn, GridLabels } from './types';

/** Значки видов списка (прототип `VI`). */
const VIEW_ICON = { table: 'table', cards: 'cards', kanban: 'board' } as const;

/** Вид «Доска» на панели: по какому столбцу списка разложены записи и из каких можно выбрать. */
export interface GridBoardChoice {
  /** Столбец доски сейчас. */
  key: string;
  /** Столбцы списка, по которым можно разложить доску, с подписями. */
  options: readonly { key: string; label: string }[];
}

/**
 * «⋯» панели на телефоне — значок 36 px с подложкой (`.gtools .icon-btn.sm.raised`), область
 * касания — 44 px (`TOUCH_AREA`).
 */
const PHONE_TOOL = `${TOUCH_AREA} inline-grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-btn text-muted shadow-flat hover:text-ink [&_svg]:h-[17px] [&_svg]:w-[17px]`;

/** «Фильтр» и «Сортировка» на телефоне (прототип v139 `.btn.sm.gt-m`); включённая — с рамкой (`.on`). */
const phoneButton = (on: boolean) =>
  `${buttonClass('default', 'sm')} gap-[5px] px-2.5 ${on ? 'text-ink shadow-[inset_0_0_0_1px_var(--bu-border-strong)]' : ''}`;

/** Кнопка «Настройки вида» на ПК (`.icon-btn.sm.raised`). */
const RAISED_ICON = `${iconButtonClass('sm')} bg-btn! shadow-flat`;

interface ToolbarProps<Row> {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  onResetView: () => void;
  view: GridViewKind;
  fixedView?: 'table' | 'cards';
  /** У списка есть вид «Доска»: третья кнопка вида; на доске — выбор её столбца вместо «Группировки». */
  board?: GridBoardChoice;
  phone: boolean;
  total: number | null;
  /** Своя строка вместо числа записей (прототип `caption`: «Видео: 9 · Опубликовано: 7 · Занято: …»). */
  caption?: ReactNode;
  /** Отмеченные строки и массовые действия: при выборе вместо числа записей — «Выбрано: N». */
  selection?: GridSelectionBar<Row>;
  /** Столбцы группировки (до двух). */
  group: readonly string[];
  /** «Группировка» сменила уровни — свёрнутые группы снова раскрыты. */
  onGroupChange: () => void;
  /** Группы есть — кнопка «Свернуть все / Развернуть все» (на телефоне она у чипа «Группировка»). */
  fold?: GridFold;
  /** «В Excel»: есть — кнопка на панели; `exporting` — файл собирается. */
  onExport?: () => void;
  exporting?: boolean;
  /** Телефон: «Фильтр», «Сортировка» и «Выбрать несколько» под «⋯» (прототип v139). */
  phoneTools?: GridPhoneTools;
  labels: GridLabels;
}

/** Что панели на телефоне нужно от списка: фильтры столбцов, сортировка и режим выбора строк. */
export interface GridPhoneTools {
  /** Столбцы с фильтром: стоит ли он и его значение строкой (как в чипе). */
  filters?: {
    active: Readonly<Record<string, string>>;
    /** Открыть окно фильтра столбца у кнопки панели. */
    onOpen: (key: string, anchor: HTMLElement) => void;
    onReset: () => void;
  };
  sort: ListSort | null;
  onSort: (sort: ListSort | null) => void;
  /** «Выбрать несколько»: галочки у записей видны только в этом режиме; нет массовых действий — нет пункта. */
  select?: { on: boolean; onToggle: () => void };
}

/** Все группы свёрнуты (`shut`) — кнопка разворачивает их, иначе сворачивает. */
export interface GridFold {
  shut: boolean;
  onToggle: () => void;
}

/**
 * Одна кнопка для всех групп (прототип ui/grid.js, `fold`; docs/deviations.md#О-64): «Свернуть все», а
 * когда все группы свёрнуты — «Развернуть все». На телефоне — значок с подсказкой.
 */
export function GridFoldButton({
  fold,
  phone,
  labels,
}: {
  fold: GridFold;
  phone: boolean;
  labels: GridLabels;
}) {
  const hint = fold.shut ? labels.expandAllHint : labels.collapseAllHint;
  return (
    <button
      type="button"
      onClick={fold.onToggle}
      title={hint}
      aria-label={phone ? hint : undefined}
      data-grid-fold={fold.shut ? 'expand' : 'collapse'}
      className={phone ? `${TOUCH_AREA} ${RAISED_ICON}` : buttonClass('default', 'sm')}
    >
      <Icon name={fold.shut ? 'unfold' : 'fold'} size="sm" />
      {!phone && (fold.shut ? labels.expandAll : labels.collapseAll)}
    </button>
  );
}

export interface GridSelectionBar<Row> {
  count: number;
  actions: readonly GridBulkAction<Row>[];
  onRun: (action: GridBulkAction<Row>) => void;
  onClear: () => void;
}

/**
 * Панель над списком (прототип ui/grid.js, `.gtools`; ТЗ «Панель над списком»): число записей, вид
 * «Таблица / Карточки», «Столбцы (видно / всего)» и «Настройки вида». На телефоне (до 768 px) — своя
 * панель `PhoneTools`: «Фильтр», «Сортировка» и «⋯» (прототип v139).
 */
export function GridToolbar<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  onResetView,
  view,
  fixedView,
  board,
  phone,
  total,
  caption,
  selection,
  group,
  onGroupChange,
  fold,
  onExport,
  exporting = false,
  phoneTools,
  labels,
}: ToolbarProps<Row>) {
  const keys = columns.map((c) => c.key);
  const visible = screenVisibleKeys(columns, settings, defaultVisible, phone);
  const shown = visible.length;
  const kanban = view === 'kanban' && !!board;
  // На доске «Столбцы» — это поля карточки: первые пять видимых (прототип «Поля (5/12)»).
  const columnsName = kanban ? labels.boardFields : labels.columns;
  const columnsLabel = `${columnsName} (${shown}/${keys.length})`;
  const groupLabel = group.length ? labels.groupN(group.length) : labels.group;
  const setView = (next: GridViewKind) => onSettingsChange(withView(settings, phone, next));
  const views = gridViews(!!board);
  const boardName = kanban ? (board.options.find((o) => o.key === board.key)?.label ?? '') : '';
  const boardLabel = labels.boardBy(boardName);
  const lead =
    selection && selection.count > 0 ? (
      <GridBulkBar selection={selection} labels={labels} />
    ) : (
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        {total === null ? null : (caption ?? <span data-grid-count>{labels.count(total)}</span>)}
      </div>
    );

  if (phone) {
    return (
      <div className="flex min-h-[33px] flex-wrap items-center gap-2" data-grid-tools="phone">
        {lead}
        <div className="flex-1" />
        <PhoneTools
          columns={columns}
          defaultVisible={defaultVisible}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onResetView={onResetView}
          view={view}
          views={fixedView ? [] : views}
          board={kanban ? board : undefined}
          group={group}
          onGroupChange={onGroupChange}
          fold={fold}
          onExport={onExport}
          exporting={exporting}
          tools={phoneTools}
          labels={labels}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[33px] flex-wrap items-center gap-2">
      {lead}
      <div className="flex-1" />
      {!fixedView && (
        <div
          role="group"
          aria-label={labels.view}
          data-grid-view
          className="inline-flex gap-0.5 rounded-lg border border-line bg-pane-alt p-[3px]"
        >
          {views.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              data-view={v}
              title={v === 'kanban' ? labels.kanbanHint : labels[v]}
              onClick={() => setView(v)}
              className={`inline-flex min-h-[26px] cursor-pointer items-center gap-1.5 rounded-md border-0 px-2.5 py-1 text-[12.5px] font-[550] ${view === v ? 'bg-raised text-ink shadow-flat-strong' : 'bg-transparent text-muted'}`}
            >
              <Icon name={VIEW_ICON[v]} size="sm" />
              <span>{labels[v]}</span>
            </button>
          ))}
        </div>
      )}
      {kanban && (
        <Popover
          label={labels.boardByHint}
          role="menu"
          placement="bottom-end"
          trigger={({ open, toggle, id }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={id}
              aria-haspopup="menu"
              data-grid-board-by
              title={labels.boardByHint}
              className={buttonClass('default', 'sm')}
            >
              <Icon name="layers" size="sm" />
              {boardLabel}
            </button>
          )}
        >
          {(close) => (
            <ActionList
              onPick={close}
              items={board.options.map((o) => ({
                id: o.key,
                label: o.label,
                icon: 'layers' as const,
                on: o.key === board.key,
                run: () => onSettingsChange({ ...settings, kb: o.key }),
              }))}
            />
          )}
        </Popover>
      )}
      {!kanban && (
        <Popover
          label={labels.group}
          placement="bottom-end"
          padded
          trigger={({ open, toggle, id }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={id}
              aria-haspopup="dialog"
              data-grid-group-button
              title={labels.groupButtonHint}
              className={buttonClass('default', 'sm')}
            >
              <Icon name="layers" size="sm" />
              {groupLabel}
            </button>
          )}
        >
          {(close) => (
            <GroupPanel
              columns={columns}
              keys={keys}
              visible={visible}
              settings={settings}
              onApply={(next) => {
                onSettingsChange(next);
                onGroupChange();
                close();
              }}
              labels={labels}
            />
          )}
        </Popover>
      )}
      <Popover
        label={columnsName}
        placement="bottom-end"
        padded
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={id}
            aria-haspopup="dialog"
            data-grid-columns-button
            title={kanban ? labels.boardFieldsHint : undefined}
            className={buttonClass('default', 'sm')}
          >
            <Icon name="columns" size="sm" />
            {columnsLabel}
          </button>
        )}
      >
        {() => (
          <ColumnsPanel
            columns={columns}
            defaultVisible={defaultVisible}
            settings={settings}
            onSettingsChange={onSettingsChange}
            labels={labels}
          />
        )}
      </Popover>
      {/* На доске плотности и ширины нет — как в прототипе: только «Столбцы: …», «Поля» и «В Excel». */}
      {!kanban && (
        <Popover
          label={labels.viewOptions}
          role="menu"
          placement="bottom-end"
          trigger={({ open, toggle, id }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={id}
              aria-haspopup="menu"
              title={labels.viewOptionsHint}
              aria-label={labels.viewOptions}
              data-grid-options-button
              className={RAISED_ICON}
            >
              <Icon name="sliders" size="sm" />
            </button>
          )}
        >
          {(close) => (
            <ActionList
              onPick={close}
              items={viewOptionItems(settings, onSettingsChange, onResetView, labels)}
            />
          )}
        </Popover>
      )}
      {fold && <GridFoldButton fold={fold} phone={false} labels={labels} />}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          aria-busy={exporting}
          title={labels.excelHint}
          data-grid-export
          className={buttonClass('default', 'sm')}
        >
          <Icon name="download" size="sm" />
          {labels.excel}
        </button>
      )}
    </div>
  );
}

/** Пункты «Настроек вида»: плотность, ширина и «Сбросить вид». */
function viewOptionItems(
  settings: GridViewSettings,
  onSettingsChange: (settings: GridViewSettings) => void,
  onResetView: () => void,
  labels: GridLabels,
): ActionEntry[] {
  return [
    {
      id: 'normal',
      label: labels.densityNormal,
      icon: 'list',
      on: (settings.density ?? 'normal') === 'normal',
      run: () => onSettingsChange({ ...settings, density: 'normal' }),
    },
    {
      id: 'compact',
      label: labels.densityCompact,
      icon: 'menu',
      on: settings.density === 'compact',
      run: () => onSettingsChange({ ...settings, density: 'compact' }),
    },
    { id: 'sep1', separator: true },
    {
      id: 'full',
      label: labels.widthFull,
      icon: 'columns',
      on: (settings.width ?? 'full') === 'full',
      run: () => onSettingsChange({ ...settings, width: 'full' }),
    },
    {
      id: 'center',
      label: labels.widthCenter,
      icon: 'table',
      on: settings.width === 'center',
      run: () => onSettingsChange({ ...settings, width: 'center' }),
    },
    { id: 'sep2', separator: true },
    {
      id: 'reset',
      label: labels.resetView,
      icon: 'refresh',
      sub: labels.resetViewSub,
      run: onResetView,
    },
  ];
}

/** Что открыто у кнопок панели на телефоне. */
type PhoneOpen = 'filter' | 'sort' | 'more' | 'board' | 'options' | 'group' | 'columns' | null;

/** Сортировка из меню телефона: тот же столбец — в обратную сторону, другой — по возрастанию. */
export function phoneSort(sort: ListSort | null, key: string): ListSort {
  return sort?.key === key
    ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: 'asc' };
}

/** Что открывает пункт «⋯» на телефоне: столбец доски, «Группировка», «Столбцы» или «Плотность». */
export type PhonePanel = 'board' | 'group' | 'columns' | 'options';

export interface PhoneMenuArgs<Row> {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  view: GridViewKind;
  /** Виды для выбора; пусто — вид закреплён модулем. */
  views: readonly GridViewKind[];
  /** Список сейчас в виде «Доска». */
  board?: GridBoardChoice;
  group: readonly string[];
  fold?: GridFold;
  onExport?: () => void;
  exporting: boolean;
  tools?: GridPhoneTools;
  /** Открыть окно фильтра столбца. */
  openFilter: (key: string) => void;
  /** Открыть окно или меню пункта «⋯». */
  open: (panel: PhonePanel) => void;
  labels: GridLabels;
}

/**
 * Пункты трёх меню панели списка на телефоне (прототип v139 ui/grid.js `mfilt`, `msort`, `mmore`):
 * «Фильтр» — видимые столбцы с фильтром (у стоящего — его значение) и «Сбросить фильтры»;
 * «Сортировка» — видимые столбцы (у выбранного — направление) и «Без сортировки»; «⋯» — вид, группировка
 * или столбец доски, «Свернуть все», столбцы или поля карточки, плотность, «Выбрать несколько», «В Excel».
 */
export function phoneMenus<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  view,
  views,
  board,
  group,
  fold,
  onExport,
  exporting,
  tools,
  openFilter,
  open,
  labels,
}: PhoneMenuArgs<Row>): {
  filter: readonly ActionEntry[];
  sort: readonly ActionEntry[];
  more: readonly ActionEntry[];
  /** Сколько фильтров стоит — число на кнопке «Фильтр». */
  filterCount: number;
} {
  const keys = columns.map((c) => c.key);
  const visible = screenVisibleKeys(columns, settings, defaultVisible, true);
  const shownColumns = visible.map((k) => columns.find((c) => c.key === k)!);
  const filters = tools?.filters;
  const filterCount = filters ? Object.keys(filters.active).length : 0;
  const sort = tools?.sort ?? null;
  const label = (key: string) => columns.find((c) => c.key === key)?.label ?? '';

  const filterItems: ActionEntry[] = filters
    ? [
        ...shownColumns
          .filter((c) => c.filterable !== false)
          .map((c) => ({
            id: c.key,
            label: c.label,
            icon: 'filter' as const,
            on: c.key in filters.active,
            sub: filters.active[c.key],
            run: () => openFilter(c.key),
          })),
        ...(filterCount
          ? [
              { id: 'filter-sep', separator: true as const },
              {
                id: 'filter-reset',
                label: labels.resetFilters,
                icon: 'x' as const,
                run: filters.onReset,
              },
            ]
          : []),
      ]
    : [];
  const sortItems: ActionEntry[] = tools
    ? [
        ...shownColumns
          .filter((c) => c.sortable !== false)
          .map((c) => {
            const on = sort?.key === c.key;
            return {
              id: c.key,
              label: c.label,
              icon: on && sort.dir === 'desc' ? ('dn' as const) : ('up' as const),
              on,
              sub: on ? (sort.dir === 'asc' ? labels.sortAsc : labels.sortDesc) : undefined,
              run: () => tools.onSort(phoneSort(sort, c.key)),
            };
          }),
        ...(sort
          ? [
              { id: 'sort-sep', separator: true as const },
              {
                id: 'sort-none',
                label: labels.sortNone,
                icon: 'x' as const,
                run: () => tools.onSort(null),
              },
            ]
          : []),
      ]
    : [];
  const select = tools?.select;
  const moreItems: ActionEntry[] = [
    ...views.map((v) => ({
      id: `view-${v}`,
      label: labels[v],
      icon: VIEW_ICON[v],
      on: view === v,
      run: () => onSettingsChange(withView(settings, true, v)),
    })),
    ...(views.length ? [{ id: 'more-sep', separator: true as const }] : []),
    board
      ? {
          id: 'board',
          label: labels.boardColumns,
          icon: 'layers' as const,
          sub: label(board.key),
          run: () => open('board'),
        }
      : {
          id: 'group',
          label: labels.group,
          icon: 'layers' as const,
          sub: group.map(label).join(' → ') || undefined,
          run: () => open('group'),
        },
    ...(fold
      ? [
          {
            id: 'fold',
            label: fold.shut ? labels.expandAll : labels.collapseAll,
            icon: fold.shut ? ('unfold' as const) : ('fold' as const),
            run: fold.onToggle,
          },
        ]
      : []),
    {
      id: 'columns',
      label: board || view === 'cards' ? labels.boardFieldsName : labels.columns,
      icon: 'columns' as const,
      sub: labels.shownOf(visible.length, keys.length),
      run: () => open('columns'),
    },
    // На доске плотности и ширины нет — как на ПК.
    ...(board
      ? []
      : [
          {
            id: 'options',
            label: labels.density,
            icon: 'sliders' as const,
            run: () => open('options'),
          },
        ]),
    ...(select
      ? [
          {
            id: 'select',
            label: labels.selectMany,
            icon: 'check' as const,
            on: select.on,
            run: select.onToggle,
          },
        ]
      : []),
    ...(onExport
      ? [
          {
            id: 'excel',
            label: labels.excel,
            icon: 'download' as const,
            disabled: exporting,
            run: onExport,
          },
        ]
      : []),
  ];

  return { filter: filterItems, sort: sortItems, more: moreItems, filterCount };
}

/**
 * Панель списка на телефоне (прототип v139 ui/grid.js `mfilt`, `msort`, `mmore`; решение заказчика
 * 17.11.2026 «Меньше текста»): на виду «Фильтр» с числом фильтров, «Сортировка» и «⋯»; под «⋯» — вид,
 * группировка (на доске — её столбец), «Свернуть все», столбцы или поля карточки, плотность, «Выбрать
 * несколько» и «В Excel». Фильтр и сортировка работают и в виде «Карточки». Меню и окна — листами снизу.
 */
function PhoneTools<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  onResetView,
  view,
  views,
  board,
  group,
  onGroupChange,
  fold,
  onExport,
  exporting,
  tools,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  onResetView: () => void;
  view: GridViewKind;
  /** Виды для выбора; пусто — вид закреплён модулем. */
  views: readonly GridViewKind[];
  /** Список сейчас в виде «Доска». */
  board?: GridBoardChoice;
  group: readonly string[];
  onGroupChange: () => void;
  fold?: GridFold;
  onExport?: () => void;
  exporting: boolean;
  tools?: GridPhoneTools;
  labels: GridLabels;
}) {
  const [open, setOpen] = useState<PhoneOpen>(null);
  const close = () => setOpen(null);
  const [filterButton, setFilterButton] = useState<HTMLButtonElement | null>(null);
  const [sortButton, setSortButton] = useState<HTMLButtonElement | null>(null);
  const [moreButton, setMoreButton] = useState<HTMLButtonElement | null>(null);
  const keys = columns.map((c) => c.key);
  const visible = screenVisibleKeys(columns, settings, defaultVisible, true);
  const filters = tools?.filters;
  const sort = tools?.sort ?? null;
  const {
    filter: filterItems,
    sort: sortItems,
    more: moreItems,
    filterCount,
  } = phoneMenus({
    columns,
    defaultVisible,
    settings,
    onSettingsChange,
    view,
    views,
    board,
    group,
    fold,
    onExport,
    exporting,
    tools,
    openFilter: (key) => {
      if (filterButton) filters?.onOpen(key, filterButton);
    },
    open: setOpen,
    labels,
  });

  const menus: Partial<
    Record<
      Exclude<PhoneOpen, null>,
      { items: readonly ActionEntry[]; label: string; at: HTMLElement | null }
    >
  > = {
    filter: { items: filterItems, label: labels.filter, at: filterButton },
    sort: { items: sortItems, label: labels.sort, at: sortButton },
    more: { items: moreItems, label: labels.more, at: moreButton },
    board: {
      items: (board?.options ?? []).map((o) => ({
        id: o.key,
        label: o.label,
        icon: 'layers' as const,
        on: o.key === board?.key,
        run: () => onSettingsChange({ ...settings, kb: o.key }),
      })),
      label: labels.boardByHint,
      at: moreButton,
    },
    options: {
      items: viewOptionItems(settings, onSettingsChange, onResetView, labels),
      label: labels.viewOptions,
      at: moreButton,
    },
  };
  const menu = open ? menus[open] : undefined;

  return (
    <>
      {filters && (
        <button
          ref={setFilterButton}
          type="button"
          onClick={() => setOpen('filter')}
          aria-label={filterCount ? labels.filterN(filterCount) : labels.filter}
          aria-haspopup="menu"
          aria-expanded={open === 'filter'}
          data-grid-phone="filter"
          className={phoneButton(filterCount > 0)}
        >
          <Icon name="filter" size="sm" />
          <span>{labels.filter}</span>
          {filterCount > 0 && (
            <span
              aria-hidden="true"
              className="h-4 min-w-4 rounded-lg bg-accent px-1 text-center text-[10.5px] leading-4 text-on-accent"
            >
              {filterCount}
            </span>
          )}
        </button>
      )}
      {tools && (
        <button
          ref={setSortButton}
          type="button"
          onClick={() => setOpen('sort')}
          aria-label={labels.sort}
          aria-haspopup="menu"
          aria-expanded={open === 'sort'}
          data-grid-phone="sort"
          className={phoneButton(!!sort)}
        >
          <Icon name={sort?.dir === 'desc' ? 'dn' : 'up'} size="sm" />
          <span>{labels.sort}</span>
        </button>
      )}
      <button
        ref={setMoreButton}
        type="button"
        onClick={() => setOpen('more')}
        aria-label={labels.moreHint}
        title={labels.more}
        aria-haspopup="menu"
        aria-expanded={open === 'more'}
        data-grid-phone="more"
        className={PHONE_TOOL}
      >
        <Icon name="more" size="sm" />
      </button>
      {menu?.at && (
        <ActionMenu
          key={open}
          items={menu.items}
          place={{ anchor: menu.at }}
          label={menu.label}
          onClose={close}
        />
      )}
      {open === 'group' && moreButton && (
        <FloatingPanel anchor={moreButton} label={labels.group} onClose={close}>
          <GroupPanel
            columns={columns}
            keys={keys}
            visible={visible}
            settings={settings}
            onApply={(next) => {
              onSettingsChange(next);
              onGroupChange();
              close();
            }}
            labels={labels}
          />
        </FloatingPanel>
      )}
      {open === 'columns' && moreButton && (
        <FloatingPanel
          anchor={moreButton}
          label={board ? labels.boardFields : labels.columns}
          onClose={close}
        >
          <ColumnsPanel
            columns={columns}
            defaultVisible={defaultVisible}
            settings={settings}
            onSettingsChange={onSettingsChange}
            labels={labels}
          />
        </FloatingPanel>
      )}
    </>
  );
}

/**
 * Окно «Группировка» (прототип ui/grid.js, groupPop; ТЗ «Группировка»): «Уровень 1» и «Уровень 2
 * (внутри первого)» — любой столбец списка; итоги в строке группы у видимых числовых столбцов — «Не
 * считать», «Сумма» (по умолчанию), «Среднее», «Минимум», «Максимум», «Количество». «Убрать» снимает
 * группировку, «Применить» сохраняет её в настройках вида.
 */
export function GroupPanel<Row>({
  columns,
  keys,
  visible,
  settings,
  onApply,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  keys: readonly string[];
  visible: readonly string[];
  settings: GridViewSettings;
  onApply: (settings: GridViewSettings) => void;
  labels: GridLabels;
}) {
  const id = useId();
  const saved = (settings.group ?? []).filter((k) => keys.includes(k));
  const [first, setFirst] = useState(saved[0] ?? '');
  const [second, setSecond] = useState(saved[1] ?? '');
  const numeric = orderedKeys(keys, settings.order)
    .map((k) => columns.find((c) => c.key === k)!)
    .filter((c) => visible.includes(c.key) && isNumericColumn(c.type));
  const [aggs, setAggs] = useState<Record<string, GroupAggChoice>>(() =>
    Object.fromEntries(
      numeric.map((c) => [c.key, groupAggOf(c.type, settings.agg?.[c.key]) ?? 'none']),
    ),
  );
  const ordered = orderedKeys(keys, settings.order).map((k) => columns.find((c) => c.key === k)!);
  const options = [
    <option key="" value="">
      {labels.groupNone}
    </option>,
    ...ordered.map((c) => (
      <option key={c.key} value={c.key}>
        {c.label}
      </option>
    )),
  ];
  const field = 'flex flex-col gap-1';
  const caption = 'text-[12.5px] font-[550] text-muted';

  return (
    <>
      <h4 className="m-0 text-[13.5px] font-[650] text-ink">{labels.group}</h4>
      <div className={field}>
        <label htmlFor={`${id}-1`} className={caption}>
          {labels.groupLevel1}
        </label>
        <select
          id={`${id}-1`}
          className={inputClass()}
          value={first}
          onChange={(e) => {
            setFirst(e.target.value);
            if (!e.target.value) setSecond('');
          }}
        >
          {options}
        </select>
      </div>
      <div className={field}>
        <label htmlFor={`${id}-2`} className={caption}>
          {labels.groupLevel2}
        </label>
        <select
          id={`${id}-2`}
          className={inputClass()}
          value={first ? second : ''}
          disabled={!first}
          onChange={(e) => setSecond(e.target.value)}
        >
          {options}
        </select>
      </div>
      {numeric.length > 0 && (
        <>
          <div className={`${caption} mt-1`}>{labels.groupAggs}</div>
          {numeric.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <label htmlFor={`${id}-a-${c.key}`} className="flex-1 text-[13px]">
                {c.label}
              </label>
              <select
                id={`${id}-a-${c.key}`}
                className={`${inputClass()} w-[140px]!`}
                value={aggs[c.key] ?? 'none'}
                onChange={(e) =>
                  setAggs((prev) => ({ ...prev, [c.key]: e.target.value as GroupAggChoice }))
                }
              >
                <option value="none">{labels.aggNone}</option>
                {GROUP_AGGS.map((how) => (
                  <option key={how} value={how}>
                    {labels.agg[how]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </>
      )}
      <div className="text-[12px] leading-[1.4] text-muted">{labels.groupHint}</div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onApply(withGroup(settings, []))}
          className={buttonClass('ghost', 'sm')}
        >
          {labels.groupRemove}
        </button>
        <button
          type="button"
          onClick={() =>
            onApply({
              ...withGroup(settings, groupLevels(first, first ? second : '')),
              agg: { ...settings.agg, ...aggs },
            })
          }
          className={buttonClass('cta', 'sm')}
        >
          {labels.apply}
        </button>
      </div>
    </>
  );
}

/**
 * Панель массовых действий (прототип `.bulkbar`; ТЗ «Действия над записью» → «Выбор нескольких строк
 * галочками и массовые действия»): «Выбрано: N», кнопки действий и «Снять выбор».
 */
export function GridBulkBar<Row>({
  selection,
  labels,
}: {
  selection: GridSelectionBar<Row>;
  labels: GridLabels;
}) {
  return (
    <div
      role="toolbar"
      aria-label={labels.selected(selection.count)}
      data-grid-bulk
      className="flex animate-rise flex-wrap items-center gap-1.5 rounded-full border border-line-strong bg-raised py-[3px] pr-1 pl-3 text-[13px] shadow-pane"
    >
      <b>{labels.selected(selection.count)}</b>
      {selection.actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => selection.onRun(a)}
          className={buttonClass(a.danger ? 'danger' : 'default', 'sm')}
        >
          <Icon name={a.icon ?? 'check'} size="sm" />
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={selection.onClear}
        aria-label={labels.clearSelection}
        title={labels.clearSelection}
        className={iconButtonClass('sm')}
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

/**
 * Меню «Столбцы» (прототип ui/grid.js, colsPop): галочка показывает столбец, порядок меняется
 * перетаскиванием строки или стрелками «Выше» / «Ниже»; последний видимый столбец скрыть нельзя.
 * Служебные столбцы помечены «системный».
 */
export function ColumnsPanel<Row>({
  columns,
  defaultVisible,
  settings,
  onSettingsChange,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  defaultVisible: readonly string[];
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  labels: GridLabels;
}) {
  const keys = columns.map((c) => c.key);
  const order = orderedKeys(keys, settings.order);
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const visibleCount = visibleKeys(keys, settings, defaultVisible).length;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const move = (key: string, to: number) => {
    onSettingsChange(moveColumn(keys, settings, key, to));
    setMoved(key);
  };
  const dropOn = (e: DragEvent, key: string) => {
    if (!drag) return;
    e.preventDefault();
    const from = drag;
    setDrag(null);
    setOver(null);
    move(from, order.indexOf(key));
  };

  return (
    <>
      <h4 className="m-0 text-[13.5px] font-[650] text-ink">{labels.columns}</h4>
      <div
        className="flex max-h-[340px] flex-col overflow-auto rounded-lg border border-line p-1"
        data-columns-list
      >
        {order.map((key, i) => {
          const column = byKey.get(key)!;
          const checked = !isHidden(key, settings, defaultVisible);
          const lastVisible = checked && visibleCount === 1;
          return (
            <div
              key={key}
              draggable
              data-column={key}
              onDragStart={(e) => {
                setDrag(key);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', key);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(key);
              }}
              onDrop={(e) => dropOn(e, key)}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              className={`flex items-center gap-0.5 rounded-[5px] ${drag === key ? 'opacity-45' : ''} ${over === key && drag !== key ? 'shadow-[inset_0_2px_0_var(--bu-accent)]' : ''} ${moved === key ? 'bg-sel' : ''}`}
            >
              <span title={labels.dragHint} className="inline-flex cursor-grab px-0.5 text-faint">
                <Icon name="grip" size="sm" />
              </span>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[5px] text-[13px]">
                <input
                  type="checkbox"
                  className="m-0 h-4 w-4 flex-none cursor-pointer accent-accent disabled:cursor-not-allowed"
                  checked={checked}
                  disabled={lastVisible}
                  onChange={(e) =>
                    onSettingsChange(
                      setColumnVisible(keys, settings, defaultVisible, key, e.target.checked),
                    )
                  }
                />
                <span className="truncate">{column.label}</span>
                {column.audit && (
                  <span className="ml-auto text-[11px] text-faint">{labels.system}</span>
                )}
              </label>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(key, i - 1)}
                aria-label={`${labels.moveUp}: ${column.label}`}
                title={labels.moveUp}
                className={`${iconButtonClass('sm')} h-6! w-6! disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="up" size="sm" />
              </button>
              <button
                type="button"
                disabled={i === order.length - 1}
                onClick={() => move(key, i + 1)}
                aria-label={`${labels.moveDown}: ${column.label}`}
                title={labels.moveDown}
                className={`${iconButtonClass('sm')} h-6! w-6! disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Icon name="dn" size="sm" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="text-[12px] leading-[1.4] text-muted">{labels.columnsHint}</div>
    </>
  );
}
