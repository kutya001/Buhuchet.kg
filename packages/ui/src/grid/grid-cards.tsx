'use client';

import { Fragment, type ReactNode } from 'react';
import { cardToneClass } from './card-tone';
import { aggText, type GroupNode } from './grid-groups';
import { GroupToggle, RowMenuButton, SELECT_BOX, type GridTableGroups } from './grid-table';
import type { RowEvents } from './row-events';
import type {
  GridColumn,
  GridLabels,
  GridRowSelection,
  GridRowStripe,
  GridRowTone,
  GridShortCard,
} from './types';

/**
 * Карточки списка (прототип ui/grid.js, cardsHtml; стили `.gcards`, `.gcard`): заголовок — главный
 * столбец, ниже пары «подпись — значение» видимых столбцов, внизу строка «Создал… · Изменил…» из
 * служебных столбцов; у списка с массовыми действиями — галочка в заголовке карточки. Сгруппированный
 * список — заголовки групп с числом записей и итогами (`.gc-grp`), под раскрытой группой — её
 * вложенные группы или карточки. Суммы, которые читаются вместе (`tileLine`), — одной строкой
 * «К уплате 5 000 · Получено 5 000 · Оплачено 3 000». Действия записи — кнопкой «⋯» в заголовке
 * карточки и долгим нажатием, без правого клика; у записи без действий кнопки нет. Короткая карточка
 * телефона (`short`, прототип v141 `mcard`): под заголовком — строка главного, справа — статус, ниже —
 * только столбцы, которых в них нет.
 */
export function GridCards<Row>({
  columns,
  titleKey,
  rows,
  rowKey,
  rowTone,
  rowStripe,
  clickable,
  events,
  selection,
  totals,
  total,
  groups,
  labels,
  render,
  short,
}: {
  /** Своя карточка (прототип `cardHtml`): обёртка, «⋯» и нажатие — общие. */
  render?: (row: Row) => ReactNode;
  /** Короткая карточка телефона: что показать под заголовком и справа; второй аргумент — видимые столбцы. */
  short?: (row: Row, visible: ReadonlySet<string>) => GridShortCard;
  groups?: GridTableGroups<Row>;
  columns: readonly GridColumn<Row>[];
  titleKey?: string;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowTone?: (row: Row) => GridRowTone | undefined;
  rowStripe?: (row: Row) => GridRowStripe | undefined;
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
  // Столбцы общей строки плитки стоят одной строкой на месте первого из них (`clineHtml` прототипа).
  const lineColumns = rest.filter((c) => c.tileLine);
  const tileLine = (row: Row, line: readonly GridColumn<Row>[] = lineColumns): ReactNode => {
    // Прототип v141: у первого столбца строки значение не больше нуля — строки нет.
    const lead = line[0]?.tileLine?.amount;
    if (lead && !((lead(row) ?? 0) > 0)) return null;
    const parts = line.filter((c) => c.text(row) !== '');
    if (!parts.length) return null;
    return (
      <dd
        key="tile-line"
        data-tile-line
        className="col-span-full m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left text-muted"
      >
        {parts.map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 && <i className="text-faint not-italic">·</i>}
            <span>
              {c.tileLine!.label ?? c.label}{' '}
              <b className="font-[650] text-ink tabular-nums">
                {c.tileLine!.cell ? c.tileLine!.cell(row) : c.text(row)}
              </b>
            </span>
          </Fragment>
        ))}
      </dd>
    );
  };

  const visibleKeys = new Set(columns.map((c) => c.key));
  const card = (row: Row): ReactNode =>
    short ? common(row, short(row, visibleKeys)) : render ? own(row, render) : common(row);
  /** Своя карточка во всю ширину, «⋯» — поверх в правом верхнем углу (прототип `.gcard-x .gc-mx`). */
  const own = (row: Row, draw: (row: Row) => ReactNode): ReactNode => {
    const id = rowKey(row);
    return (
      <div
        key={id}
        data-id={id}
        data-card-own
        tabIndex={0}
        {...events.handlers(row)}
        className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-raised transition-shadow duration-150 hover:shadow-pane focus-visible:outline-2 focus-visible:outline-brand-blue ${clickable ? 'cursor-pointer' : ''}`}
      >
        {draw(row)}
        {events.hasMenu(row) && (
          <span className="absolute top-1.5 right-1.5 rounded-lg bg-[hsla(0_0%_100%/.9)] text-[#222]">
            <RowMenuButton row={row} events={events} label={labels.actions} />
          </span>
        )}
      </div>
    );
  };

  const common = (row: Row, brief?: GridShortCard): ReactNode => {
    const id = rowKey(row);
    const pairs = brief ? rest.filter((c) => !brief.keys.includes(c.key)) : rest;
    const line = pairs.filter((c) => c.tileLine);
    const tone = rowTone?.(row);
    const stripe = rowStripe?.(row);
    const created = auditLine(row, 'created');
    const updated = auditLine(row, 'updated');
    const picked = selection?.has(row) ?? false;
    return (
      <div
        key={id}
        data-id={id}
        data-tone={tone}
        data-card-short={brief ? '' : undefined}
        tabIndex={0}
        {...events.handlers(row)}
        className={`flex min-w-0 flex-col rounded-xl border ${brief ? 'gap-1.5 py-2.5 pr-2.5 pl-[13px]' : 'gap-[9px] pt-[11px] pr-3 pb-3 pl-3.5'} transition-shadow duration-150 hover:shadow-pane focus-visible:outline-2 focus-visible:outline-brand-blue ${clickable ? 'cursor-pointer' : ''} ${cardToneClass(tone, stripe)} ${picked ? 'shadow-btn-active' : ''}`}
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
            {brief?.sub ? (
              <div
                data-card-sub
                className="mt-0.5 text-[12.5px] font-medium text-muted [&_*]:inline"
              >
                {brief.sub}
              </div>
            ) : null}
          </div>
          {brief?.right ? (
            // Справа — статус словом и цветом, без точек шкалы (`.gc-r .scm-d`).
            <div
              data-card-right
              className="max-w-[44%] flex-none pt-px [&_[data-status-dots]]:hidden"
            >
              {brief.right}
            </div>
          ) : null}
          {events.hasMenu(row) &&
            (brief ? (
              <span className="-mt-1.5 -mr-1 flex-none">
                <RowMenuButton row={row} events={events} label={labels.actions} />
              </span>
            ) : (
              <RowMenuButton row={row} events={events} label={labels.actions} />
            ))}
        </div>
        {pairs.length > 0 && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-[5px] text-[12.5px] empty:hidden">
            {pairs.map((c) => {
              if (c.tileLine) return c === line[0] ? tileLine(row, line) : null;
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
  };

  const nums = columns.filter((c) => groups?.aggs[c.key]);
  const grid = (list: readonly Row[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-2.5" data-grid-cards>
      {list.map(card)}
    </div>
  );
  const walk = (nodes: readonly GroupNode<Row>[]): ReactNode =>
    nodes.map((node) => {
      const open = !groups!.closed.has(node.path);
      return (
        <div key={node.path} className="contents">
          <div
            data-group={node.path}
            data-group-level={node.level}
            className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-[10px] border border-line px-3 py-2 text-[13px] ${node.level ? 'ml-3.5 bg-transparent' : 'bg-pane-alt'}`}
          >
            <GroupToggle
              node={node}
              open={open}
              onToggle={groups!.onToggle}
              indent={false}
              labels={labels}
            />
            {nums.length > 0 && (
              <span className="ml-auto flex flex-wrap gap-x-3.5 gap-y-0.5 text-[12px] text-muted">
                {nums.map((c) => {
                  const how = groups!.aggs[c.key]!;
                  return (
                    <span key={c.key}>
                      {c.label}
                      {how === 'sum' ? '' : ` (${labels.agg[how].toLowerCase()})`}:{' '}
                      <b className="tabular-nums">
                        {aggText(c.type, how, node.group.aggs[c.key] ?? null)}
                      </b>
                    </span>
                  );
                })}
              </span>
            )}
          </div>
          {open &&
            (node.sub ? (
              <div className="flex flex-col gap-2">{walk(node.sub)}</div>
            ) : (
              grid(node.rows)
            ))}
        </div>
      );
    });

  return (
    <>
      {groups ? (
        <div className="flex flex-col gap-2" data-grid-groups>
          {walk(groups.tree)}
        </div>
      ) : (
        grid(rows)
      )}
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
