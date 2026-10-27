'use client';

import { addMonths, columnTotals, monthText, searchText } from '@buhuchet/domain';
import { KpiValuesSaved, type KpiMonth } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  iconButtonClass,
  Note,
  NothingFound,
  PHONE_QUERY,
  Popover,
  useMediaQuery,
  useToast,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { useShell } from '../shell/context';
import { monthQuery, useKpiRefresh } from './kpi-data';
import { useKpiEntry } from './kpi-entry';
import { columnSub, monthGenName, monthName, totalText } from './kpi-format';
import { KpiPlates } from './kpi-plates';
import { setKpiChoice, useKpiChoice } from './kpi-state';
import { MonthMini } from './kpi-status';
import {
  EMPTY_CELL,
  FIRST_CLASS,
  FOOT_CLASS,
  HEAD_CLASS,
  InfoTip,
  NUM,
  OFF_CELL,
  OVERDUE_ROW,
  TABLE_CLASS,
  useCellGrid,
  ValueInput,
  WRAP_CLASS,
  type CellChange,
} from './kpi-table';

/*
 * Вкладка «Ввод за месяц» (задача 2.27; ТЗ «Вкладка «Ввод за месяц»»; прототип modules/kpi.js: kpiMonth,
 * kMonPick): выбор месяца, таблица контрагенты × показатели с вводом прямо в ячейках и вставкой блока из
 * Excel, итоги по столбцам и статус месяца; на телефоне — плитки контрагентов, нажатие открывает окно
 * ввода всех показателей контрагента за месяц.
 */

const TOTALS = ['sum', 'avg', 'max', 'min'] as const;

export function KpiMonthTab() {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const { search, clearSearch } = useShell();
  const phone = useMediaQuery(PHONE_QUERY);
  const { month } = useKpiChoice();
  const query = useQuery({ ...monthQuery(month), placeholderData: keepPreviousData });
  const entry = useKpiEntry();
  const data = query.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const q = searchText(search.trim());
    return data.rows
      .filter(
        (r) =>
          !q || searchText(r.name).includes(q) || searchText(r.responsibleName ?? '').includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [data, search]);

  if (query.isError && !data) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!data) return <KpiPlates />;

  /** Сохранить ячейки: сразу на экране, потом на сервере; ошибка — уведомление и данные с сервера. */
  const save = async (changes: readonly CellChange[]) => {
    if (changes.length === 0) return 0;
    client.setQueryData<KpiMonth>(
      monthQuery(month).queryKey,
      (old) => old && patched(old, changes),
    );
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: [...changes] } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    return KpiValuesSaved.parse(res.data).changed;
  };

  const header = (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <MonthPicker data={data} />
      <Hint>{t('kpi.month.hint')}</Hint>
    </div>
  );

  let body;
  if (data.indicators.length === 0) {
    body = (
      <EmptyState icon="gauge" title={t('kpi.no_indicators')} text={t('kpi.no_indicators_text')} />
    );
  } else if (rows.length === 0) {
    body = search.trim() ? (
      <NothingFound
        title={t('grid.not_found')}
        resetLabel={t('grid.reset_filters')}
        onReset={clearSearch}
      />
    ) : (
      <EmptyState
        icon="search"
        title={t('grid.not_found')}
        text={t('kpi.month.nobody', { month: monthName(t, data.month) })}
      />
    );
  } else if (phone) {
    body = <MonthTiles t={t} rows={rows} onOpen={(cid) => void entry.open(cid, data.month)} />;
  } else {
    body = (
      <MonthTable
        t={t}
        data={data}
        rows={rows}
        onSave={(changes) => void save(changes)}
        onPaste={async (changes, bad) => {
          const n = await save(changes);
          if (n === null) return;
          toast(bad ? t('kpi.pasted_bad', { n, bad }) : t('kpi.pasted', { n }), { icon: 'paste' });
        }}
        onBad={(text) => toast(t('kpi.not_number', { text }), { bad: true })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5" data-kpi-month={data.month}>
      <KpiPlates />
      {header}
      {body}
      {entry.dialog}
    </div>
  );
}

/** Ячейки после правки — сразу в таблице, пока сервер не ответил. */
function patched(data: KpiMonth, changes: readonly CellChange[]): KpiMonth {
  const by = new Map(changes.map((c) => [`${c.contractorId}|${c.indicatorId}`, c.value]));
  return {
    ...data,
    rows: data.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => {
        const key = `${r.contractorId}|${c.indicatorId}`;
        return by.has(key) ? { ...c, value: by.get(key)! } : c;
      }),
    })),
  };
}

/**
 * Выбор месяца (прототип `kMonPick`): стрелки «‹ ›» и список месяцев, у месяца с незаполненными
 * значениями — красная точка и число контрагентов; вперёд — не дальше идущего месяца.
 */
function MonthPicker({ data }: { data: KpiMonth }) {
  const t = useT();
  const go = (m: string) => setKpiChoice({ month: m });
  const missing = new Map(data.choices.map((c) => [c.month, c.missing]));
  const n = missing.get(data.month) ?? 0;
  const label = (m: string, count: number) =>
    count ? t('kpi.month.choice_missing', { month: monthText(m), n: count }) : monthText(m);

  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={t('kpi.month.label')}>
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('kpi.month.prev')}
        title={t('kpi.month.prev')}
        onClick={() => go(addMonths(data.month, -1))}
      >
        <Icon name="left" size="sm" />
      </button>
      <Popover
        label={t('kpi.month.label')}
        role="menu"
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            className={`${buttonClass('default', 'sm')} gap-1.5`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={id}
            title={t('kpi.month.pick')}
            data-kpi-month-pick=""
            onClick={toggle}
          >
            {n ? <Dot /> : null}
            <span>
              {n
                ? t('kpi.month.current_missing', { month: monthName(t, data.month), n })
                : monthName(t, data.month)}
            </span>
            <Icon name="down" size="sm" />
          </button>
        )}
      >
        {(close) => (
          <div className="flex max-h-[min(360px,60vh)] flex-col overflow-y-auto py-1">
            {data.choices.map((c) => (
              <button
                key={c.month}
                type="button"
                role="menuitemradio"
                aria-checked={c.month === data.month}
                data-kpi-choice={c.month}
                className={`flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover ${c.month === data.month ? 'bg-sel font-semibold' : ''}`}
                ref={(el) => {
                  if (el && c.month === data.month) el.scrollIntoView({ block: 'center' });
                }}
                onClick={() => {
                  close();
                  go(c.month);
                }}
              >
                {c.missing ? <Dot /> : <span className="h-2 w-2 flex-none" />}
                <span>
                  {label(c.month, c.missing)}
                  {c.month === data.current ? (
                    <small className="ml-1 text-faint">{t('kpi.month.now')}</small>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </Popover>
      <button
        type="button"
        className={iconButtonClass('sm')}
        aria-label={t('kpi.month.next')}
        title={t('kpi.month.next')}
        disabled={data.month >= data.current}
        onClick={() => go(addMonths(data.month, 1))}
      >
        <Icon name="right" size="sm" />
      </button>
    </div>
  );
}

/** Красная точка у месяца с незаполненными значениями (`.kdot`). */
const Dot = () => (
  <span
    aria-hidden="true"
    className="inline-block h-2 w-2 flex-none self-center rounded-full bg-danger"
  />
);

type Row = KpiMonth['rows'][number];

function MonthTable({
  t,
  data,
  rows,
  onSave,
  onPaste,
  onBad,
}: {
  t: Translate;
  data: KpiMonth;
  rows: readonly Row[];
  onSave: (changes: CellChange[]) => void;
  onPaste: (changes: CellChange[], bad: number) => void;
  onBad: (text: string) => void;
}) {
  const ref = useRef<HTMLTableElement>(null);
  const cols = data.indicators;
  const grid = useCellGrid(ref, { rows: rows.length, cols: cols.length });

  return (
    <div className={WRAP_CLASS} data-no-swipe="">
      <table ref={ref} className={TABLE_CLASS} data-kpi-table="">
        <thead>
          <tr>
            <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.contractor')}</th>
            <th className={HEAD_CLASS}>{t('kpi.col.responsible')}</th>
            {cols.map((col) => (
              <th key={col.id} className={`${HEAD_CLASS} ${NUM}`} data-kpi-col={col.id}>
                {col.name}
                {col.description ? (
                  <InfoTip label={t('kpi.desc_label', { name: col.name })} text={col.description} />
                ) : null}
                <small>{columnSub(t, col)}</small>
              </th>
            ))}
            <th className={HEAD_CLASS}>{t('kpi.col.month_status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr
              key={row.contractorId}
              className={row.overdue ? OVERDUE_ROW : ''}
              data-kpi-row={row.contractorId}
            >
              {/* Карточку контрагента на вкладке «Показатели» откроет её задача (2.11, #67). */}
              <td className={FIRST_CLASS}>{row.name}</td>
              <td className="text-muted">{row.responsibleName ?? '—'}</td>
              {row.cells.map((cell, c) => {
                const col = cols[c]!;
                if (cell.state === 'off') {
                  return (
                    <td
                      key={col.id}
                      className={`${NUM} ${OFF_CELL}`}
                      title={
                        cell.offSince
                          ? t('kpi.off_since', { month: monthGenName(t, cell.offSince) })
                          : t('kpi.cell_off')
                      }
                      data-kpi-off=""
                    >
                      —
                    </td>
                  );
                }
                const early = cell.state === 'early';
                const since = t('kpi.early_tag', { from: monthText(cell.start) });
                return (
                  <td
                    key={col.id}
                    className={`${NUM} ${early ? OFF_CELL : cell.value === null && col.required ? EMPTY_CELL : ''}`}
                  >
                    <ValueInput
                      r={r}
                      c={c}
                      cell={{
                        contractorId: row.contractorId,
                        indicatorId: col.id,
                        month: data.month,
                        type: col.type,
                      }}
                      value={cell.value}
                      readOnly={!row.editable}
                      label={
                        early
                          ? t('kpi.cell_label_early', { name: row.name, ind: col.name, since })
                          : t('kpi.cell_label', { name: row.name, ind: col.name })
                      }
                      placeholder={early ? since.toLowerCase() : undefined}
                      title={
                        !row.editable
                          ? t('kpi.readonly_cell')
                          : early
                            ? t('kpi.early_cell', { since })
                            : undefined
                      }
                      onCommit={(value) =>
                        onSave([
                          {
                            contractorId: row.contractorId,
                            indicatorId: col.id,
                            month: data.month,
                            value,
                          },
                        ])
                      }
                      onBad={onBad}
                      onMove={grid.onMove}
                      onPaste={(r0, c0, block) => {
                        const { changes, bad } = grid.pasted(r0, c0, block);
                        onPaste(changes, bad);
                      }}
                    />
                  </td>
                );
              })}
              <td>
                <MonthMini
                  status={row.status}
                  needed={row.cells.some((c) => c.state === 'required')}
                />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className={FOOT_CLASS}>
          {TOTALS.map((key) => (
            <tr key={key}>
              <th colSpan={2} className={FIRST_CLASS}>
                {t(`kpi.total.${key}`)}
              </th>
              {cols.map((col, c) => {
                const totals = columnTotals(rows.map((r) => r.cells[c]!.value));
                return (
                  <td
                    key={col.id}
                    className={NUM}
                    data-kpi-total={`${col.id}|${key}`}
                    title={
                      totals.count
                        ? t('kpi.total_of', { n: totals.count, of: totals.of })
                        : undefined
                    }
                  >
                    {totalText(col.type, totals, key)}
                  </td>
                );
              })}
              <td />
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

/** Телефон: плитки контрагентов (прототип `gcard kcard`); нажатие открывает окно ввода. */
function MonthTiles({
  t,
  rows,
  onOpen,
}: {
  t: Translate;
  rows: readonly Row[];
  onOpen: (contractorId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5">
      {rows.map((row) => {
        const open = row.cells.filter((c) => c.state !== 'off');
        const filled = open.filter((c) => c.value !== null).length;
        const early = row.cells.find((c) => c.state === 'early');
        return (
          <button
            key={row.contractorId}
            type="button"
            data-kpi-tile={row.contractorId}
            className={`flex flex-col gap-2 rounded-lg border bg-raised p-3 text-left text-[13px] hover:bg-row-hover ${row.overdue ? 'border-danger' : 'border-line'}`}
            onClick={() => onOpen(row.contractorId)}
          >
            <span className="flex items-center gap-2">
              <b className="min-w-0 flex-1">{row.name}</b>
              <Icon name="right" size="sm" />
            </span>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">{t('kpi.tile.filled')}</dt>
              <dd className="m-0">{t('kpi.n_of', { n: filled, of: open.length })}</dd>
              {early ? (
                <>
                  <dt className="text-muted">{t('kpi.tile.optional')}</dt>
                  <dd className="m-0">{t('kpi.tile.since', { from: monthText(early.start) })}</dd>
                </>
              ) : null}
              <dt className="text-muted">{t('kpi.col.responsible')}</dt>
              <dd className="m-0">{row.responsibleName ?? '—'}</dd>
              <dt className="text-muted">{t('kpi.col.month_status')}</dt>
              <dd className="m-0">
                <MonthMini
                  status={row.status}
                  needed={row.cells.some((c) => c.state === 'required')}
                />
              </dd>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
