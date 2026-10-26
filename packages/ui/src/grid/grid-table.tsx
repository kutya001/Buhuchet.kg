'use client';

import type { GridViewSettings, ListSort } from '@buhuchet/domain';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { iconButtonClass } from '../button';
import { Icon } from '../icon';
import { clampWidth, columnWidth, dropColumn, setColumnWidth } from './grid-state';
import type { GridColumn, GridLabels, GridRowTone } from './types';
import type { RowEvents } from './row-events';

/** Ширина столбца «⋯» (`.actc` прототипа). */
const ACTIONS_WIDTH = 44;

export const isNumeric = <Row,>(c: GridColumn<Row>) =>
  c.numeric ?? (c.type === 'int' || c.type === 'money');

const TONE_ROW: Record<GridRowTone, string> = {
  muted: '[&>td]:text-faint',
  overdue: '[&>td]:bg-danger-bg [&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-red)]',
  warn: '[&>td:first-child]:shadow-[inset_3px_0_0_var(--bu-orange)]',
};

interface TableProps<Row> {
  columns: readonly GridColumn<Row>[];
  allKeys: readonly string[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  settings: GridViewSettings;
  onSettingsChange: (settings: GridViewSettings) => void;
  sort: ListSort | null;
  onSort: (key: string) => void;
  totals: Readonly<Record<string, number>>;
  total: number;
  hasActions: boolean;
  clickable: boolean;
  events: RowEvents<Row>;
  label: string;
  labels: GridLabels;
}

/**
 * Таблица списка (прототип ui/grid.js, tableHtml; стили `.gscroll`, `table.gt`): заголовок закреплён,
 * сортировка нажатием на заголовок, ширина — перетаскиванием границы (не уже 70 px), порядок —
 * перетаскиванием заголовка; столбец «⋯» — действия записи; внизу закреплённая строка итогов.
 * Широкая таблица прокручивается внутри себя; в развёрнутом окне — выше, на телефоне — без
 * ограничения высоты.
 */
export function GridTable<Row>({
  columns,
  allKeys,
  rows,
  rowKey,
  rowTone,
  settings,
  onSettingsChange,
  sort,
  onSort,
  totals,
  total,
  hasActions,
  clickable,
  events,
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
    columns.reduce((sum, c) => sum + widthOf(c), 0) + (hasActions ? ACTIONS_WIDTH : 0);
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

  return (
    <div
      data-grid-scroll
      className="relative max-h-[max(320px,calc(100dvh-330px))] min-h-[120px] overflow-auto rounded-xl border border-line bg-raised max-md:max-h-none [[data-max=true]_&]:max-h-[max(320px,calc(100dvh-250px))]"
    >
      <table
        aria-label={label}
        style={{ width: tableWidth }}
        className="min-w-full table-fixed border-separate border-spacing-0 tabular-nums"
      >
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={{ width: widthOf(c) }} />
          ))}
          {hasActions && <col style={{ width: ACTIONS_WIDTH }} />}
        </colgroup>
        <thead>
          <tr>
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
                  className={`sticky top-0 z-[2] border-b border-line bg-pane-alt p-0 text-left text-[12px] font-[650] tracking-[0.01em] text-muted select-none ${over === c.key && drag !== c.key ? 'shadow-[inset_2px_0_0_var(--bu-b-blue)]' : ''}`}
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
          {rows.map((row, i) => {
            const id = rowKey(row);
            const tone = rowTone?.(row);
            const last = i === rows.length - 1;
            return (
              <tr
                key={id}
                data-id={id}
                tabIndex={0}
                {...events.handlers(row)}
                className={`group/row focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue [&:hover>td]:bg-row-hover ${clickable ? 'cursor-pointer' : ''} ${tone ? TONE_ROW[tone] : ''}`}
              >
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
                    <button
                      type="button"
                      data-row-menu
                      aria-label={labels.actions}
                      aria-haspopup="menu"
                      onClick={(e) => events.menuAt(row, { anchor: e.currentTarget })}
                      className={iconButtonClass('sm')}
                    >
                      <Icon name="more" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
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
