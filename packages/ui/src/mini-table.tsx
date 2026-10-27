import type { KeyboardEvent, ReactNode } from 'react';

/** Столбец маленькой таблицы карточки: ключ, подпись, число справа. */
export interface MiniColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

/** Строка: ячейки по ключам столбцов. */
export interface MiniRow {
  key: string;
  cells: Readonly<Record<string, ReactNode>>;
}

/**
 * Маленькая таблица в карточке записи (прототип css/cards.css `table.mini.m-cards`): на ПК —
 * таблица с серой шапкой, узкая прокручивается вбок; на телефоне — строки карточками по два значения с
 * подписями, первый столбец — заголовок карточки. Пустая — одна строка с серым текстом. С `onOpen`
 * строка открывает запись (нажатием или Enter), как строка списка.
 */
export function MiniTable({
  columns,
  rows,
  empty,
  label,
  onOpen,
}: {
  columns: readonly MiniColumn[];
  rows: readonly MiniRow[];
  /** «Нет закреплённых контрагентов». */
  empty: string;
  /** Название таблицы для экранного диктора. */
  label: string;
  /** Открыть запись строки (ключ строки). */
  onOpen?: (key: string) => void;
}) {
  const num = (c: MiniColumn) => (c.numeric ? 'text-left md:text-right' : 'text-left');
  return (
    <div className="overflow-x-auto max-md:overflow-visible">
      <table
        aria-label={label}
        data-mini-table=""
        className="w-full border-collapse text-[13px] tabular-nums max-md:block"
      >
        <thead className="max-md:hidden">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
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
                className="data-open:cursor-pointer data-open:hover:bg-row-hover data-open:focus-visible:bg-row-hover data-open:focus-visible:outline-none md:last:[&>td]:border-b-0 max-md:mb-2 max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-lg max-md:border max-md:border-line max-md:bg-pane max-md:px-3 max-md:py-2.5 max-md:last:mb-0"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    data-label={c.label}
                    className={`align-middle md:border-b md:border-line md:px-2 md:py-[7px] max-md:flex max-md:min-w-0 max-md:flex-col max-md:gap-px max-md:[overflow-wrap:anywhere] ${num(c)} ${i === 0 ? 'max-md:col-span-2 max-md:text-[14px]' : 'max-md:before:text-[11px] max-md:before:font-[650] max-md:before:text-faint max-md:before:content-[attr(data-label)]'}`}
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
