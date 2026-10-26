'use client';

import { iconButtonClass } from '../button';
import { Icon } from '../icon';
import { SELECT_BOX } from './grid-table';
import type { RowEvents } from './row-events';
import type { GridColumn, GridLabels, GridRowSelection, GridRowTone } from './types';

/** Как `.gcard.<класс>` прототипа: приглушения у карточек нет (`.gt tr.muted` — только таблица). */
const TONE_CARD: Record<GridRowTone, string> = {
  muted: '',
  overdue:
    'border-[color-mix(in_srgb,var(--bu-red)_40%,var(--bu-border))] bg-[linear-gradient(var(--bu-red-bg),var(--bu-red-bg)),var(--bu-raised)]',
  warn: 'border-l-[3px] border-l-caution',
};

/**
 * Карточки списка (прототип ui/grid.js, cardsHtml; стили `.gcards`, `.gcard`): заголовок — главный
 * столбец, ниже пары «подпись — значение» видимых столбцов, внизу строка «Создал… · Изменил…» из
 * служебных столбцов; у списка с массовыми действиями — галочка в заголовке карточки. Плитки телефона (одна строка сумм, действия без правого клика) — задача #16.
 */
export function GridCards<Row>({
  columns,
  titleKey,
  rows,
  rowKey,
  rowTone,
  hasActions,
  clickable,
  events,
  selection,
  totals,
  total,
  labels,
}: {
  columns: readonly GridColumn<Row>[];
  titleKey?: string;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  hasActions: boolean;
  clickable: boolean;
  events: RowEvents<Row>;
  selection?: GridRowSelection<Row>;
  totals: Readonly<Record<string, number>>;
  total: number;
  labels: GridLabels;
}) {
  const title = columns.find((c) => c.key === titleKey) ?? columns[0]!;
  const rest = columns.filter((c) => c !== title && !c.audit);
  const audit = columns.filter((c) => c.audit);
  const auditLine = (row: Row, kind: 'created' | 'updated') =>
    audit
      .filter((c) => c.audit === kind)
      .map((c) => c.text(row))
      .filter(Boolean)
      .join(', ');
  const withTotals = columns.filter((c) => c.total && totals[c.key] !== undefined);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-2.5" data-grid-cards>
        {rows.map((row) => {
          const id = rowKey(row);
          const tone = rowTone?.(row);
          const created = auditLine(row, 'created');
          const updated = auditLine(row, 'updated');
          const picked = selection?.has(row) ?? false;
          return (
            <div
              key={id}
              data-id={id}
              tabIndex={0}
              {...events.handlers(row)}
              className={`flex min-w-0 flex-col gap-[9px] rounded-xl border border-line bg-raised pt-[11px] pr-3 pb-3 pl-3.5 transition-shadow duration-150 hover:shadow-pane focus-visible:outline-2 focus-visible:outline-brand-blue ${clickable ? 'cursor-pointer' : ''} ${tone ? TONE_CARD[tone] : ''} ${picked ? 'shadow-btn-active' : ''}`}
            >
              <div className="flex items-start gap-[9px]">
                {selection && (
                  <input
                    type="checkbox"
                    aria-label={labels.selectCard}
                    checked={picked}
                    onChange={(e) => selection.toggle(row, e.target.checked)}
                    className={`${SELECT_BOX} mt-[3px]`}
                  />
                )}
                <div className="min-w-0 flex-1 leading-[1.35] font-semibold">
                  {title.cell ? title.cell(row) : title.text(row)}
                </div>
                {hasActions && (
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
                )}
              </div>
              {rest.length > 0 && (
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-[5px] text-[12.5px]">
                  {rest.map((c) => {
                    const text = c.text(row);
                    return (
                      <div key={c.key} className="contents">
                        <dt className="text-faint">{c.label}</dt>
                        <dd title={text} className="m-0 min-w-0 truncate text-right tabular-nums">
                          {text === '' ? (
                            <span className="text-faint">—</span>
                          ) : c.cell ? (
                            c.cell(row)
                          ) : (
                            text
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
              {(created || updated) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-[7px] text-[11.5px] text-faint">
                  {created && <span>{labels.createdLine(created)}</span>}
                  {updated && <span>{labels.updatedLine(updated)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {withTotals.length > 0 && (
        <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 rounded-[10px] border border-line bg-pane-alt px-3 py-2 text-[12.5px] text-muted">
          <span>{labels.totalByFilter(total)}</span>
          {withTotals.map((c) => (
            <span key={c.key}>
              {c.label}: <b className="text-ink tabular-nums">{c.total!(totals[c.key]!)}</b>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
