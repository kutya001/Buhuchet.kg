'use client';

import type { GridViewSettings, GroupAgg, ListSort } from '@buhuchet/domain';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { iconButtonClass, TOUCH_AREA } from '../button';
import { Icon } from '../icon';
import { aggText, groupLabelSpan, type GroupNode } from './grid-groups';
import { clampWidth, columnWidth, dropColumn, setColumnWidth } from './grid-state';
import type { GridColumn, GridLabels, GridRowSelection, GridRowStripe, GridRowTone } from './types';
import type { RowEvents } from './row-events';

/** Ширина столбца «⋯» (`.actc` прототипа). */
const ACTIONS_WIDTH = 44;
/** Ширина столбца с галочками (`.selc` прототипа). */
const SELECT_WIDTH = 38;
/** Галочка выбора строки. */
export const SELECT_BOX = 'm-0 h-4 w-4 flex-none cursor-pointer accent-accent align-middle';

export const isNumeric = <Row,>(c: GridColumn<Row>) =>
  c.numeric ?? (c.type === 'int' || c.type === 'money');

const TONE_ROW: Record<GridRowTone, string> = {
  // Прототип `.gt tr.muted` — цветом `--faint` (2,9 : 1); основной текст не бледнее `--muted`
  // (docs/deviations.md, п. 22).
  muted: '[&>td]:text-muted',
  overdue: '[&>td]:bg-danger-bg [&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-red)]',
  warn: '[&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-orange)]',
};

/** Тон строки с цветной полоской: своя полоска тона уступает (как в прототипе), фон остаётся. */
const TONE_ROW_STRIPED: Record<GridRowTone, string> = {
  muted: TONE_ROW.muted,
  overdue: '[&>td]:bg-danger-bg',
  warn: '',
};

const STRIPE_ROW: Record<GridRowStripe, string> = {
  info: '[&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-blue)]',
  violet: '[&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-purple)]',
};

interface TableProps<Row> {
  columns: readonly GridColumn<Row>[];
  allKeys: readonly string[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  rowStripe?: (row: Row) => GridRowStripe | undefined;
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  sort: ListSort | null;
  onSort: (key: string) => void;
  totals: Readonly<Record<string, number>>;
  total: number;
  hasActions: boolean;
  clickable: boolean;
  events: RowEvents<Row>;
  /** Выбор строк галочками (есть массовые действия). */
  selection?: GridRowSelection<Row>;
  /** Фильтр у заголовков: открыть меню столбца у кнопки; `filtered` — у столбца есть фильтр. */
  filter?: GridHeaderFilter;
  /** Сгруппированный список: группы со строками, свёрнутые группы и итоги числовых столбцов. */
  groups?: GridTableGroups<Row>;
  label: string;
  labels: GridLabels;
}

export interface GridHeaderFilter {
  filtered: (key: string) => boolean;
  /** Меню какого столбца открыто (у кнопки — aria-expanded). */
  open: string | null;
  onOpen: (key: string, anchor: HTMLElement) => void;
}

export interface GridTableGroups<Row> {
  tree: readonly GroupNode<Row>[];
  closed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  aggs: Readonly<Record<string, GroupAgg>>;
}

/** Кнопка группы (`.g-tg` прототипа): стрелка, название жирным и число записей. */
export function GroupToggle<Row>({
  node,
  open,
  onToggle,
  indent,
  labels,
}: {
  node: GroupNode<Row>;
  open: boolean;
  onToggle: (path: string) => void;
  indent: boolean;
  labels: GridLabels;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => onToggle(node.path)}
      style={indent ? { paddingLeft: node.level * 22 } : undefined}
      className="inline-flex max-w-full cursor-pointer items-center gap-[7px] border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
    >
      <Icon name={open ? 'down' : 'right'} size="sm" />
      <b className="truncate">{node.group.label ?? labels.empty}</b>
      <span className="rounded-full border border-line bg-btn px-[7px] text-[11px] font-semibold text-muted tabular-nums">
        {node.group.count}
      </span>
    </button>
  );
}

/**
 * Кнопка «⋯» записи (`.icon-btn.sm` прототипа): на вид 27 px, а на телефоне её область касания —
 * 44 px (`TOUCH_AREA`).
 */
export function RowMenuButton<Row>({
  row,
  events,
  label,
}: {
  row: Row;
  events: RowEvents<Row>;
  label: string;
}) {
  return (
    <button
      type="button"
      data-row-menu
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => events.menuAt(row, { anchor: e.currentTarget })}
      className={`${iconButtonClass('sm')} ${TOUCH_AREA}`}
    >
      <Icon name="more" />
    </button>
  );
}

/**
 * Таблица списка (прототип ui/grid.js, tableHtml; стили `.gscroll`, `table.gt`): заголовок закреплён,
 * сортировка нажатием на заголовок, ширина — перетаскиванием границы (не уже 70 px), порядок —
 * перетаскиванием заголовка; слева — галочки выбора строк, справа — «⋯», действия записи; внизу
 * закреплённая строка итогов.
 * Широкая таблица прокручивается внутри себя; в развёрнутом окне — выше, на телефоне — без
 * ограничения высоты.
 */
export function GridTable<Row>({
  columns,
  allKeys,
  rows,
  rowKey,
  rowTone,
  rowStripe,
  settings,
  onSettingsChange,
  sort,
  onSort,
  totals,
  total,
  hasActions,
  clickable,
  events,
  selection,
  filter,
  groups,
  label,
  labels,
}: TableProps<Row>) {
  const [live, setLive] = useState<{ key: string; width: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const resizing = useRef(false);
  const widthOf = (c: GridColumn<Row>) =>
    live?.key === c.key ? live.width : columnWidth(c, settings);
  const tableWidth =
    columns.reduce((sum, c) => sum + widthOf(c), 0) +
    (selection ? SELECT_WIDTH : 0) +
    (hasActions ? ACTIONS_WIDTH : 0);
  const compact = settings.density === 'compact';
  const hasTotals = columns.some((c) => c.total);

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>, c: GridColumn<Row>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const x0 = e.clientX;
    const w0 = widthOf(c);
    let width = w0;
    resizing.current = true;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      width = clampWidth(w0 + ev.clientX - x0);
      setLive({ key: c.key, width });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      resizing.current = false;
      setLive(null);
      if (width !== w0) onSettingsChange(setColumnWidth(settings, c.key, width));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const cell = `overflow-hidden border-b border-line px-2.5 text-ellipsis whitespace-nowrap ${compact ? 'h-[31px] py-[3px] text-[12.5px]' : 'h-[41px] py-2 text-[13px]'}`;

  // Строки тела по порядку: без группировки — строки страницы; с группировкой — строка группы, под
  // ней (если она раскрыта) её вложенные группы или строки (прототип tableHtml, `walk`).
  const lines: ({ kind: 'group'; node: GroupNode<Row> } | { kind: 'row'; row: Row })[] = [];
  const walk = (nodes: readonly GroupNode<Row>[]) => {
    for (const node of nodes) {
      lines.push({ kind: 'group', node });
      if (groups!.closed.has(node.path)) continue;
      if (node.sub) walk(node.sub);
      else for (const row of node.rows) lines.push({ kind: 'row', row });
    }
  };
  if (groups) walk(groups.tree);
  else for (const row of rows) lines.push({ kind: 'row', row });

  const span = groupLabelSpan(columns);
  const groupRow = (node: GroupNode<Row>, last: boolean): ReactNode => {
    const { closed, onToggle, aggs } = groups!;
    const bg =
      node.level === 0
        ? 'bg-pane-alt'
        : 'bg-[color-mix(in_srgb,var(--bu-pane-alt)_45%,transparent)]';
    const td = `${cell} ${bg} border-line-strong font-semibold ${last ? 'border-b-0' : ''}`;
    return (
      <tr
        key={`g${node.path}`}
        data-group={node.path}
        data-group-level={node.level}
        className="[&:hover>td]:bg-row-hover"
      >
        {selection && <td className={td} />}
        <td colSpan={span} className={`${td} overflow-visible`}>
          <GroupToggle
            node={node}
            open={!closed.has(node.path)}
            onToggle={onToggle}
            indent
            labels={labels}
          />
        </td>
        {columns.slice(span).map((c) => {
          const how = aggs[c.key];
          if (!how) return <td key={c.key} className={td} />;
          return (
            <td
              key={c.key}
              title={`${labels.agg[how]}: ${c.label}`}
              className={`${td} text-right text-ink tabular-nums`}
            >
              {aggText(c.type, how, node.group.aggs[c.key] ?? null)}
            </td>
          );
        })}
        {hasActions && <td className={td} />}
      </tr>
    );
  };

  const dataRow = (row: Row, last: boolean): ReactNode => {
    const id = rowKey(row);
    const tone = rowTone?.(row);
    const stripe = rowStripe?.(row);
    const toneClass = tone ? (stripe ? TONE_ROW_STRIPED : TONE_ROW)[tone] : '';
    const picked = selection?.has(row) ?? false;
    return (
      <tr
        key={id}
        data-id={id}
        data-tone={tone}
        tabIndex={0}
        {...events.handlers(row)}
        className={`group/row focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue [&:hover>td]:bg-row-hover ${clickable ? 'cursor-pointer' : ''} ${toneClass} ${stripe ? STRIPE_ROW[stripe] : ''} ${picked ? '[&>td]:bg-sel' : ''}`}
      >
        {selection && (
          <td className={`${cell} px-0! text-center ${last ? 'border-b-0' : ''}`}>
            <input
              type="checkbox"
              aria-label={labels.selectRow}
              checked={picked}
              onChange={(e) => selection.toggle(row, e.target.checked)}
              className={SELECT_BOX}
            />
          </td>
        )}
        {columns.map((c) => {
          const text = c.text(row);
          return (
            <td
              key={c.key}
              title={text}
              className={`${cell} ${last ? 'border-b-0' : ''} ${isNumeric(c) ? 'text-right' : ''} ${c.className ?? ''}`}
            >
              {c.cell ? c.cell(row) : text}
            </td>
          );
        })}
        {hasActions && (
          <td className={`${cell} px-1! text-center ${last ? 'border-b-0' : ''}`}>
            {events.hasMenu(row) && (
              <RowMenuButton row={row} events={events} label={labels.actions} />
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div
      data-grid-scroll
      className="relative max-h-[max(320px,calc(100dvh-330px))] min-h-[120px] overflow-auto rounded-xl border border-line bg-raised max-md:max-h-none [[data-max=true]_&]:max-h-[max(320px,calc(100dvh-250px))]"
    >
      <table
        aria-label={label}
        style={{ width: tableWidth }}
        className={`min-w-full table-fixed border-separate border-spacing-0 tabular-nums ${compact ? '[&_[data-pill]]:leading-[17px]' : ''}`}
      >
        <colgroup>
          {selection && <col style={{ width: SELECT_WIDTH }} />}
          {columns.map((c) => (
            <col key={c.key} style={{ width: widthOf(c) }} />
          ))}
          {hasActions && <col style={{ width: ACTIONS_WIDTH }} />}
        </colgroup>
        <thead>
          <tr>
            {selection && (
              <th
                scope="col"
                className="sticky top-0 z-[2] border-b border-line bg-pane-alt p-0 text-center"
              >
                <input
                  type="checkbox"
                  aria-label={labels.selectAll}
                  checked={selection.allOnPage}
                  onChange={(e) => selection.togglePage(e.target.checked)}
                  className={SELECT_BOX}
                />
              </th>
            )}
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : null;
              const sortable = c.sortable !== false;
              return (
                <th
                  key={c.key}
                  scope="col"
                  data-column={c.key}
                  draggable={!live}
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  onDragStart={(e) => {
                    if (resizing.current) return e.preventDefault();
                    setDrag(c.key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', c.key);
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    setOver(c.key);
                  }}
                  onDragLeave={() => setOver((k) => (k === c.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag && drag !== c.key) {
                      onSettingsChange(dropColumn(allKeys, settings, drag, c.key));
                    }
                    setDrag(null);
                    setOver(null);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  className={`group/th sticky top-0 z-[2] border-b border-line bg-pane-alt p-0 text-left text-[12px] font-[650] tracking-[0.01em] text-muted select-none ${over === c.key && drag !== c.key ? 'shadow-[inset_2px_0_0_var(--bu-b-blue)]' : ''}`}
                >
                  <div
                    className={`flex min-h-9 items-center gap-0.5 pr-1 pl-2.5 ${isNumeric(c) ? 'justify-end' : ''}`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        title={labels.sortBy(c.label)}
                        className={`inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent py-1.5 text-left font-[inherit] ${dir ? 'text-ink' : 'text-inherit'}`}
                      >
                        <span className="truncate">{c.label}</span>
                        {dir && <Icon name={dir === 'asc' ? 'up' : 'dn'} size="sm" />}
                      </button>
                    ) : (
                      <span className="truncate py-1.5">{c.label}</span>
                    )}
                    {filter && c.filterable !== false && (
                      <button
                        type="button"
                        data-filter-button={c.key}
                        aria-label={labels.filterOf(c.label)}
                        title={labels.filter}
                        aria-haspopup="dialog"
                        aria-expanded={filter.open === c.key}
                        aria-pressed={filter.filtered(c.key)}
                        onClick={(e) => filter.onOpen(c.key, e.currentTarget)}
                        className={`${TOUCH_AREA} inline-grid h-6 w-6 flex-none cursor-pointer place-items-center rounded-[5px] border-0 group-hover/th:opacity-100 focus-visible:opacity-100 ${filter.filtered(c.key) ? 'bg-info-bg text-info opacity-100' : 'bg-transparent text-faint opacity-55 hover:bg-row-hover hover:text-ink'}`}
                      >
                        <Icon name="filter" size="sm" />
                      </button>
                    )}
                  </div>
                  <span
                    title={labels.columnWidth}
                    aria-hidden="true"
                    onPointerDown={(e) => startResize(e, c)}
                    className={`group absolute top-0 -right-1 bottom-0 z-[3] w-2 cursor-col-resize after:absolute after:top-1.5 after:bottom-1.5 after:left-[3px] after:w-0.5 after:rounded-sm after:bg-brand-blue after:content-[''] ${live?.key === c.key ? '' : 'after:hidden hover:after:block'}`}
                  />
                </th>
              );
            })}
            {hasActions && (
              <th
                scope="col"
                aria-label={labels.actions}
                className="sticky top-0 z-[2] border-b border-line bg-pane-alt p-0"
              />
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) =>
            line.kind === 'group'
              ? groupRow(line.node, i === lines.length - 1)
              : dataRow(line.row, i === lines.length - 1),
          )}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {selection && (
                <td className="sticky bottom-0 z-[1] border-t border-line-strong bg-pane-alt" />
              )}
              {columns.map((c, i) => {
                const value = totals[c.key];
                const foot =
                  'sticky bottom-0 z-[1] h-[38px] border-t border-line-strong bg-pane-alt px-2.5 font-bold whitespace-nowrap';
                if (c.total && value !== undefined) {
                  return (
                    <td key={c.key} className={`${foot} text-right`}>
                      {c.total(value)}
                    </td>
                  );
                }
                return (
                  <td key={c.key} className={`${foot} overflow-visible`}>
                    {i === 0 ? labels.totalByFilter(total) : null}
                  </td>
                );
              })}
              {hasActions && (
                <td className="sticky bottom-0 z-[1] border-t border-line-strong bg-pane-alt" />
              )}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
