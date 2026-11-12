'use client';

import { useState, type ReactNode } from 'react';
import { linkButtonClass } from '../button';
import { cardToneClass } from './card-tone';
import {
  BOARD_CARD_FIELDS,
  BOARD_COLUMNS_MAX,
  BOARD_DRAG_TYPE,
  boardLimit,
  boardMore,
  BOARD_STEP,
  type BoardColumn,
} from './grid-board';
import { RowMenuButton } from './grid-table';
import type { RowEvents } from './row-events';
import type { GridColumn, GridLabels, GridRowStripe, GridRowTone } from './types';

/**
 * Вид «Доска» (канбан; прототип ui/grid.js `kanbanHtml`, стили `.kan`, `.kan-col`, `.kan-card`):
 * столбцы — значения выбранного столбца списка, в шапке столбца — число записей и сумма, в столбце —
 * первые 30 карточек и «Показать ещё»; на карточке — заголовок и первые пять видимых полей. Карточку
 * можно перетащить в другой столбец (`onMove`); на телефоне и с клавиатуры то же делает пункт меню
 * карточки «Перенести в столбец…». Страниц и группировки на доске нет.
 */
export function GridKanban<Row>({
  columns,
  allColumns,
  titleKey,
  boardKey,
  sumKey,
  sumText,
  board,
  cut,
  rowKey,
  rowTone,
  rowStripe,
  clickable,
  events,
  hasMenu,
  draggable,
  onMove,
  labels,
}: {
  /** Видимые столбцы списка по порядку экрана. */
  columns: readonly GridColumn<Row>[];
  /** Все столбцы списка: заголовок карточки берётся и из скрытого (прототип `ac.find`). */
  allColumns: readonly GridColumn<Row>[];
  /** Ключ столбца-заголовка карточки; нет такого столбца — первый видимый. */
  titleKey?: string;
  /** Столбец списка, по которому разложена доска: на карточке он не повторяется. */
  boardKey: string;
  /** Столбец с суммой в шапке столбца доски (первый видимый с итогом). */
  sumKey?: string;
  /** Свой формат суммы в шапке (`GridKanban.sum`); нет — формат итога столбца. */
  sumText?: (value: number) => string;
  board: readonly BoardColumn<Row>[];
  /** Столбцов больше, чем показано: сколько всего; 0 — показаны все. */
  cut: number;
  rowKey: (row: Row) => string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  rowStripe?: (row: Row) => GridRowStripe | undefined;
  clickable: boolean;
  events: RowEvents<Row>;
  /** У карточки есть меню «⋯»: действия записи или «Перенести в столбец…». */
  hasMenu: (row: Row) => boolean;
  /** Карточки перетаскиваются мышью (ПК и есть перенос). */
  draggable: boolean;
  onMove?: (row: Row, to: BoardColumn<Row>) => void;
  labels: GridLabels;
}) {
  const [more, setMore] = useState<Readonly<Record<string, number>>>({});
  const [drag, setDrag] = useState<{ id: string; row: Row; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const title = allColumns.find((c) => c.key === titleKey) ?? columns[0]!;
  const fields = columns
    .filter((c) => c !== title && c.key !== boardKey && !c.audit)
    .slice(0, BOARD_CARD_FIELDS);
  const sum = sumKey ? columns.find((c) => c.key === sumKey) : undefined;

  const card = (row: Row, from: string): ReactNode => {
    const id = rowKey(row);
    const tone = rowTone?.(row);
    const stripe = rowStripe?.(row);
    const shown = fields.filter((c) => c.text(row) !== '');
    return (
      <div
        key={id}
        data-id={id}
        data-board-card
        data-tone={tone}
        tabIndex={0}
        draggable={draggable || undefined}
        onDragStart={
          draggable
            ? (e) => {
                setDrag({ id, row, from });
                e.dataTransfer.effectAllowed = 'move';
                try {
                  e.dataTransfer.setData(BOARD_DRAG_TYPE, id);
                } catch {
                  // Старые браузеры не дают записать данные — перенос идёт по состоянию списка.
                }
              }
            : undefined
        }
        onDragEnd={
          draggable
            ? () => {
                setDrag(null);
                setOver(null);
              }
            : undefined
        }
        {...events.handlers(row)}
        className={`flex min-w-0 flex-col gap-[7px] rounded-xl border pt-[9px] pr-2.5 pb-2.5 pl-3 transition-shadow duration-150 hover:shadow-pane focus-visible:outline-2 focus-visible:outline-brand-blue ${draggable ? 'cursor-grab' : clickable ? 'cursor-pointer' : ''} ${drag?.id === id ? 'opacity-45' : ''} ${cardToneClass(tone, stripe)}`}
      >
        <div className="flex items-start gap-[9px]">
          <div className="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold [overflow-wrap:anywhere]">
            {title.cell ? title.cell(row) : title.text(row)}
          </div>
          {hasMenu(row) && <RowMenuButton row={row} events={events} label={labels.actions} />}
        </div>
        {shown.length > 0 && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1 text-[12px]">
            {shown.map((c) => (
              <div key={c.key} className="contents">
                <dt className="text-faint">{c.tileLine?.label ?? c.label}</dt>
                <dd title={c.text(row)} className="m-0 min-w-0 truncate text-right tabular-nums">
                  {c.cell ? c.cell(row) : c.text(row)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  };

  const column = (col: BoardColumn<Row>): ReactNode => {
    const name = col.label ?? labels.empty;
    const limit = boardLimit(more, col.key);
    const rest = boardMore(col.rows.length, limit);
    // Как в прототипе: у столбца с записями сумма видна всегда, без сумм — ноль.
    const total = sum?.total && col.count ? (col.aggs[sum.key] ?? 0) : null;
    const target = drag !== null && over === col.key && drag.from !== col.key;
    return (
      <section
        key={col.key}
        data-board-column={col.key}
        aria-label={labels.boardColumn(name, col.count)}
        onDragOver={
          draggable
            ? (e) => {
                if (!drag) return;
                e.preventDefault();
                if (over !== col.key) setOver(col.key);
              }
            : undefined
        }
        onDrop={
          draggable
            ? (e) => {
                if (!drag) return;
                e.preventDefault();
                const moved = drag;
                setDrag(null);
                setOver(null);
                if (moved.from !== col.key) onMove?.(moved.row, col);
              }
            : undefined
        }
        className={`flex max-h-none min-w-0 flex-[0_0_min(84vw,300px)] snap-start flex-col rounded-xl border bg-pane-alt transition-[box-shadow,border-color] duration-100 md:max-h-[max(360px,calc(100vh-250px))] md:flex-[0_0_286px] ${target ? 'border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--bu-accent)_35%,transparent)]' : 'border-line'}`}
      >
        <header className="flex flex-none items-center gap-2 border-b border-line px-3 pt-[9px] pb-2 text-[13px]">
          <b title={name} className="min-w-0 truncate font-[650]">
            {name}
          </b>
          <span
            data-board-count
            className="flex-none rounded-full border border-line bg-btn px-[7px] text-[11px] font-semibold text-muted tabular-nums"
          >
            {col.count}
          </span>
          {sum?.total && total !== null && total !== undefined && (
            <span
              title={sum.label}
              data-board-sum
              className="ml-auto flex-none text-[12px] text-muted tabular-nums"
            >
              {(sumText ?? sum.total)(total)}
            </span>
          )}
        </header>
        <div className="flex min-h-14 flex-col gap-2 overflow-visible p-2 md:overflow-y-auto">
          {col.rows.length ? (
            col.rows.slice(0, limit).map((row) => card(row, col.key))
          ) : (
            <div className="px-1.5 py-3.5 text-center text-[12.5px] text-faint">
              {labels.boardEmpty}
            </div>
          )}
          {rest && (
            <button
              type="button"
              data-board-more={col.key}
              onClick={() => setMore((m) => ({ ...m, [col.key]: limit + BOARD_STEP }))}
              className={`${linkButtonClass()} self-center px-2 py-1 text-[12.5px]`}
            >
              {labels.boardMore(rest.next, rest.left)}
            </button>
          )}
        </div>
      </section>
    );
  };

  return (
    <>
      <div
        data-grid-board
        data-no-swipe
        className="-mx-3 flex snap-x snap-mandatory items-start gap-2.5 overflow-x-auto px-3 pt-0.5 pb-2.5 md:mx-0 md:snap-proximity md:px-0.5"
      >
        {board.map(column)}
      </div>
      {cut > 0 && (
        <div data-board-cut className="mt-1.5 text-[12.5px] text-muted">
          {labels.boardCut(BOARD_COLUMNS_MAX, cut)}
        </div>
      )}
    </>
  );
}
