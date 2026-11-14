'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import type { MenuPlace } from './action-menu';
import { useRowEvents } from './grid/row-events';

/** Столбец маленькой таблицы карточки: ключ, подпись, число справа. */
export interface MiniColumn {
  key: string;
  label: string;
  numeric?: boolean;
  /** Ширина столбца на ПК, px (прототип `<th style="width:…">`). */
  width?: number;
  /** Кнопки строки («Изменить», «Удалить»): на телефоне — в правом верхнем углу карточки. */
  actions?: boolean;
}

/** Строка: ячейки по ключам столбцов. */
export interface MiniRow {
  key: string;
  cells: Readonly<Record<string, ReactNode>>;
  /** Ячейки на всю ширину карточки на телефоне — длинные значения (`miniWide`). */
  wide?: readonly string[];
  /** Пустые ячейки («—»): на телефоне скрыты (прототип `m-empty`). */
  blank?: readonly string[];
  /** Итоговая строка таблицы-карточек (прототип `tr.m-total`): жирная, на телефоне — серый фон; не открывается. */
  total?: boolean;
  /** Просроченная строка (прототип `tr.rm-late`): на ПК — красная полоска слева, на телефоне — красная рамка карточки. */
  late?: boolean;
  /** У строки есть меню действий: правый клик и долгое нажатие открывают его (`onMenu` таблицы). */
  menu?: boolean;
}

/** Значение длиннее стольких знаков на телефоне занимает всю ширину карточки (прототип `MC_LONG`). */
export const MINI_WIDE_CHARS = 22;

/** Ключи ячеек с длинным текстом — для `MiniRow.wide` (прототип ui/mobile-pack.js `mCardsTable`). */
export const miniWide = (texts: Readonly<Record<string, string>>): string[] =>
  Object.keys(texts).filter((k) => texts[k]!.replace(/\s+/g, ' ').trim().length > MINI_WIDE_CHARS);

/**
 * Маленькая таблица в карточке записи (прототип css/cards.css `table.mini.m-cards`): на ПК —
 * таблица с серой шапкой, узкая прокручивается вбок; на телефоне — строки карточками по два значения с
 * подписями, первый столбец — заголовок карточки, длинные значения — на всю ширину, кнопки строки — в
 * правом верхнем углу. Пустая — одна строка с серым текстом. С `onOpen` строка открывает запись
 * (нажатием или Enter), как строка списка. С `phoneCards={false}` — таблица и на телефоне, узкая
 * прокручивается вбок (прототип `table.mini` без `m-cards`: строки распределения в окнах оплаты). С
 * `fixed` — столбцы по заданной ширине; `late` у строки — отметка просрочки. С `onMenu` у строк с
 * `menu` правый клик, долгое нажатие пальцем, ContextMenu и Shift+F10 открывают меню действий, как в
 * общих списках (`useRowEvents`; прототип v110 `.rm-list`): нажатие на кнопку внутри строки её не
 * открывает, отпускание пальца после долгого нажатия — тоже.
 */
export function MiniTable({
  columns,
  rows,
  empty,
  label,
  headless = false,
  phoneCards = true,
  fixed = false,
  onOpen,
  onMenu,
}: {
  columns: readonly MiniColumn[];
  rows: readonly MiniRow[];
  /**
   * На ПК столбцы ровно по заданной ширине, первый — на остаток; узкая таблица прокручивается вбок
   * (прототип `.rm-tbl`: таблицы месяцев одна под другой — столбцы на одной линии).
   */
  fixed?: boolean;
  /** Без строки заголовков и подписей у значений на телефоне (реквизиты в карточке сотрудника). */
  headless?: boolean;
  /** «Нет закреплённых контрагентов». */
  empty: string;
  /** Название таблицы для экранного диктора. */
  label: string;
  /** false — на телефоне не карточки, а та же таблица с прокруткой вбок. */
  phoneCards?: boolean;
  /** Открыть запись строки (ключ строки). */
  onOpen?: (key: string) => void;
  /** Открыть меню действий строки (ключ строки) в точке нажатия или у строки; только у строк с `menu`. */
  onMenu?: (key: string, place: MenuPlace) => void;
}) {
  const events = useRowEvents<MiniRow>({
    onOpen: onOpen ? (row) => onOpen(row.key) : undefined,
    onMenu: onMenu ? (row, place) => onMenu(row.key, place) : undefined,
    hasMenu: (row) => !!row.menu && !row.total,
  });
  if (!phoneCards)
    return (
      <PlainMiniTable
        columns={columns}
        rows={rows}
        empty={empty}
        label={label}
        headless={headless}
        onOpen={onOpen}
      />
    );
  const num = (c: MiniColumn) => (c.numeric ? 'text-left md:text-right' : 'text-left');
  const hasActions = columns.some((c) => c.actions);
  // На телефоне: заголовок карточки, кнопки в углу, значение на всю ширину или с подписью из шапки.
  const phone = (c: MiniColumn, i: number, row: MiniRow) => {
    if (i === 0) return `max-md:col-span-2 max-md:text-[14px] ${hasActions ? 'max-md:pr-10' : ''}`;
    if (c.actions) return 'max-md:absolute max-md:top-1.5 max-md:right-1.5';
    const label = headless
      ? ''
      : 'max-md:before:text-[11px] max-md:before:font-[650] max-md:before:text-faint max-md:before:content-[attr(data-label)]';
    if (row.blank?.includes(c.key)) return `${label} max-md:hidden`;
    return row.wide?.includes(c.key) ? `${label} max-md:col-span-2` : label;
  };
  return (
    <div className="overflow-x-auto max-md:overflow-visible">
      <table
        aria-label={label}
        data-mini-table=""
        className={`w-full border-collapse text-[13px] tabular-nums max-md:block ${fixed ? 'md:min-w-[860px] md:table-fixed' : ''}`}
      >
        <thead className={headless ? 'hidden' : 'max-md:hidden'}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={`border-b border-line px-2 py-1.5 text-[11.5px] font-[650] text-faint ${num(c)}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:block">
          {rows.length === 0 ? (
            <tr className="max-md:block">
              <td colSpan={columns.length} className="px-2 py-[7px] text-faint max-md:block">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.key}
                data-mini-row={row.key}
                {...(row.total ? { 'data-mini-total': '' } : {})}
                {...(row.late ? { 'data-mini-late': '' } : {})}
                {...(onMenu && !row.total
                  ? {
                      ...events.handlers(row),
                      ...(onOpen ? { 'data-open': '' } : {}),
                      ...(onOpen || events.hasMenu(row) ? { tabIndex: 0 } : {}),
                    }
                  : onOpen && !row.total
                    ? {
                        'data-open': '',
                        tabIndex: 0,
                        onClick: () => onOpen(row.key),
                        onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          onOpen(row.key);
                        },
                      }
                    : {})}
                className="data-open:cursor-pointer data-open:hover:bg-row-hover data-open:focus-visible:bg-row-hover data-open:focus-visible:outline-none data-mini-total:font-bold md:last:[&>td]:border-b-0 max-md:relative max-md:mb-2 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-lg max-md:border max-md:border-line max-md:bg-pane max-md:px-3 max-md:py-2.5 max-md:last:mb-0 max-md:data-mini-total:bg-pane-alt md:data-mini-late:[&>td:first-child]:shadow-[inset_3px_0_0_var(--color-danger)] max-md:data-mini-late:border-danger"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    data-label={c.label}
                    className={`align-middle md:border-b md:border-line md:px-2 md:py-[7px] max-md:flex max-md:min-w-0 max-md:flex-col max-md:gap-px max-md:[overflow-wrap:anywhere] ${num(c)} ${phone(c, i, row)}`}
                  >
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Таблица без карточек на телефоне (`phoneCards={false}`, `table.mini` прототипа без `m-cards`): шапка
 * (без неё — `headless`), числа справа, прокрутка вбок; `onOpen` — строка открывает запись.
 */
function PlainMiniTable({
  columns,
  rows,
  empty,
  label,
  headless,
  onOpen,
}: {
  columns: readonly MiniColumn[];
  rows: readonly MiniRow[];
  empty: string;
  label: string;
  headless: boolean;
  onOpen?: (key: string) => void;
}) {
  const align = (c: MiniColumn) => (c.numeric ? 'text-right' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        data-mini-table=""
        className="w-full border-collapse text-[13px] tabular-nums"
      >
        <thead className={headless ? 'hidden' : undefined}>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={`border-b border-line px-2 py-1.5 text-[11.5px] font-[650] text-faint ${align(c)}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-[7px] text-faint">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.key}
                {...(onOpen
                  ? {
                      'data-open': '',
                      tabIndex: 0,
                      onClick: () => onOpen(row.key),
                      onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        onOpen(row.key);
                      },
                    }
                  : {})}
                className="last:[&>td]:border-b-0 data-open:cursor-pointer data-open:hover:bg-row-hover data-open:focus-visible:bg-row-hover data-open:focus-visible:outline-none"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-line px-2 py-[7px] align-middle ${align(c)}`}
                  >
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
