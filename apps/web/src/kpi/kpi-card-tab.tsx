'use client';

import { formatDateRu, indicatorTotals, monthText, pluralForm } from '@buhuchet/domain';
import { KpiValuesSaved, type KpiCard, type KpiCell, type MonthStatus } from '@buhuchet/shared';
import {
  buttonClass,
  EmptyState,
  Hint,
  Icon,
  inputClass,
  Modal,
  Note,
  PHONE_QUERY,
  SWITCH_CLASS,
  Tag,
  useMediaQuery,
  useToast,
  type ShellCount,
} from '@buhuchet/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { cardQuery, missingSummaryQuery, useKpiRefresh } from './kpi-data';
import {
  columnSub,
  monthGenName,
  monthName,
  monthShortName,
  numberText,
  valueText,
} from './kpi-format';
import { PeriodBar, type Period } from './kpi-period-bar';
import { MonthMini } from './kpi-status';
import {
  EMPTY_CELL,
  FIRST_CLASS,
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
 * Вкладка «Показатели» карточки контрагента (задача 2.27; ТЗ «В карточке контрагента на вкладке
 * «Показатели»», «Индикатор незаполненных показателей»; прототип modules/kpi.js: kpiCardHtml,
 * kpiCardWhoHtml, kCardMissHtml, kPastDlg, kpiCardMount). Ставит её в карточку задача карточки
 * контрагента (2.11, #67): здесь — сама вкладка, число на ярлыке вкладки и значок для списка контрагентов
 * (задача 2.10, #66).
 */

const TOTALS = ['sum', 'avg', 'max', 'min'] as const;

/** Месяцы и цвет незаполненных показателей контрагента из индикатора; всё внесено — null. */
export function useKpiMissingOf(contractorId: string, enabled = true) {
  const summary = useQuery({ ...missingSummaryQuery, enabled });
  return summary.data?.contractors.find((c) => c.contractorId === contractorId) ?? null;
}

/** Число на ярлыке вкладки «Показатели» карточки: незаполненные месяцы, красное — есть просроченные. */
export function useKpiCardCount(contractorId: string, enabled = true): ShellCount | undefined {
  const x = useKpiMissingOf(contractorId, enabled);
  return x ? { value: x.months.length, tone: x.overdue ? 'red' : 'yellow' } : undefined;
}

/**
 * Значок «Показатели не заполнены» в строке списка контрагентов (прототип `cpKpiPill`): число месяцев,
 * в подсказке — месяцы («08.2026, 09.2026»); красный — есть просроченные. Ставит его список контрагентов
 * (задача 2.10, #66).
 */
export function KpiMissingBadge({ contractorId }: { contractorId: string }) {
  const t = useT();
  const x = useKpiMissingOf(contractorId);
  if (!x) return null;
  const tip = t('kpi.badge.tip', { months: x.months.map(monthText).join(', ') });
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full py-0 pr-[7px] pl-[6px] text-[11px] leading-[17px] font-semibold ${x.overdue ? 'bg-danger-bg text-danger-label' : 'bg-warn-bg text-warn-label'}`}
      title={tip}
      aria-label={tip}
      data-kpi-badge={contractorId}
    >
      <Icon name="gauge" size="sm" />
      {x.months.length}
    </span>
  );
}

export function KpiCardTab({ contractorId }: { contractorId: string }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useKpiRefresh();
  const phone = useMediaQuery(PHONE_QUERY);
  const [period, setPeriod] = useState<Period | null>(null);
  const [chart, setChart] = useState<string | null>(null);
  const [past, setPast] = useState<{ n: number; open: boolean } | null>(null);
  const query = useQuery({ ...cardQuery(contractorId, period), placeholderData: keepPreviousData });
  const tableRef = useRef<HTMLTableElement>(null);
  const data = query.data;
  const grid = useCellGrid(tableRef, {
    rows: data?.rows.length ?? 0,
    cols: data?.months.length ?? 0,
  });

  if (query.isError && !data) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!data) return null;

  const save = async (changes: CellChange[]) => {
    if (changes.length === 0) return null;
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: changes } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    return KpiValuesSaved.parse(res.data);
  };

  const sendWho = async (indicatorId: string, on: boolean, name: string) => {
    const res = await callApi(() =>
      api.api.kpi.who.$put({ json: { changes: [{ indicatorId, contractorId, on }] } }),
    );
    void refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t(on ? 'kpi.card.who_on' : 'kpi.card.who_off', { name }), { icon: 'gauge' });
  };

  const sendFrom = async (indicatorId: string, from: string, name: string) => {
    if (!from) return;
    if (from > data.current) return toast(t('err.from_in_future'), { bad: true });
    const res = await callApi(() =>
      api.api.kpi.who.from.$put({ json: { indicatorId, contractorId, from } }),
    );
    void refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('kpi.card.from_set', { name, month: monthText(from) }), { icon: 'gauge' });
  };

  const shownPeriod = { from: data.from, to: data.to };
  const rows = data.rows;
  const chosen = rows.find((r) => r.indicator.id === chart) ?? rows[0];

  const cell = (r: KpiCard['rows'][number], j: number, ri: number) => {
    const m = data.months[j]!;
    const v = r.values[j] ?? null;
    const applies = r.applies[j]!;
    const early = r.early[j]!;
    const empty = v === null && applies && m < data.current;
    const editable =
      data.editable &&
      !r.indicator.archived &&
      (applies || v !== null || early) &&
      m <= data.current;
    if (editable) {
      return (
        <td key={m} className={`${NUM} ${early ? OFF_CELL : empty ? EMPTY_CELL : ''}`}>
          <ValueInput
            r={ri}
            c={j}
            wide={phone}
            cell={{ contractorId, indicatorId: r.indicator.id, month: m, type: r.indicator.type }}
            value={v}
            readOnly={false}
            label={t('kpi.month_cell_label', { ind: r.indicator.name, month: monthName(t, m) })}
            title={early ? t('kpi.early_card', { from: monthText(r.start) }) : undefined}
            onCommit={async (value, prev) => {
              const done = await save([
                { contractorId, indicatorId: r.indicator.id, month: m, value, prev },
              ]);
              if (done) toast(t('kpi.card.saved'));
            }}
            onBad={(text) => toast(t('kpi.not_number', { text }), { bad: true })}
            onMove={grid.onMove}
            onPaste={async (r0, c0, block) => {
              const { changes, bad } = grid.pasted(r0, c0, block);
              const done = await save(changes);
              if (done) {
                toast(
                  bad
                    ? t('kpi.pasted_bad', { n: done.changed, bad })
                    : t('kpi.pasted', { n: done.changed }),
                  { icon: 'paste' },
                );
              }
            }}
          />
        </td>
      );
    }
    return (
      <td key={m} className={`${NUM} ${empty ? EMPTY_CELL : ''}`}>
        {v !== null ? (
          numberText(r.indicator.type, v)
        ) : (
          <span className="text-faint">{empty ? t('kpi.empty') : '—'}</span>
        )}
      </td>
    );
  };

  const totals = (r: KpiCard['rows'][number]) =>
    TOTALS.map((k) => (
      <td
        key={k}
        className={`${NUM} bg-pane-alt! ${k === r.indicator.total ? 'font-semibold' : ''} ${k === 'min' ? 'border-r border-r-line-strong' : ''}`}
        data-kpi-card-total={`${r.indicator.name}|${k}`}
      >
        {r.count ? numberText(r.indicator.type, r.totals[k]) : '—'}
        {k === 'avg' && r.count ? (
          <small className="text-faint">
            {' '}
            {t('kpi.avg_of', { n: r.count, of: r.need || data.months.length })}
          </small>
        ) : null}
      </td>
    ));

  return (
    <div className="flex flex-col gap-3.5" data-kpi-card={contractorId}>
      {data.who.length > 0 ? (
        <WhoBox t={t} data={data} onToggle={sendWho} onFrom={sendFrom} />
      ) : null}
      <MissingNote
        t={t}
        data={data}
        onPast={() => setPast((p) => ({ n: (p?.n ?? 0) + 1, open: true }))}
      />
      <PeriodBar value={shownPeriod} onChange={setPeriod} />
      {rows.length === 0 ? (
        <EmptyState
          icon="gauge"
          title={t('kpi.card.none')}
          text={t(
            data.contractor.paused || data.contractor.archived
              ? 'kpi.card.none_paused'
              : 'kpi.card.none_setup',
          )}
        />
      ) : (
        <>
          <Hint>{t('kpi.card.hint')}</Hint>
          {phone ? (
            rows.map((r, ri) => (
              <section
                key={r.indicator.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-pane p-3"
              >
                <div className="flex items-center gap-2">
                  <b className="flex-1">{r.indicator.name}</b>
                  {r.indicator.description ? (
                    <InfoTip
                      label={t('kpi.desc_label', { name: r.indicator.name })}
                      text={r.indicator.description}
                    />
                  ) : null}
                  <Tag>{r.indicator.unit || '—'}</Tag>
                </div>
                <div className="grid grid-cols-4 gap-1.5 max-[560px]:grid-cols-2">
                  {TOTALS.map((k) => (
                    <span
                      key={k}
                      className={`flex flex-col rounded-lg bg-pane-alt px-2 py-1.5 ${k === r.indicator.total ? 'shadow-[inset_0_0_0_1px_var(--bu-border-strong)]' : ''}`}
                    >
                      <small className="text-[11px] text-faint">{t(`kpi.total.${k}`)}</small>
                      <b className="text-[13.5px] tabular-nums">
                        {r.count ? numberText(r.indicator.type, r.totals[k]) : '—'}
                      </b>
                    </span>
                  ))}
                </div>
                <table className="w-full text-[13px]" ref={ri === 0 ? tableRef : undefined}>
                  <tbody>
                    {data.months.map((m, j) => (
                      <tr key={m}>
                        <td className="px-0.5 py-1">{monthName(t, m)}</td>
                        {cell(r, j, ri)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))
          ) : (
            <div className={WRAP_CLASS} data-no-swipe="">
              <table ref={tableRef} className={TABLE_CLASS} data-kpi-card-table="">
                <thead>
                  <tr>
                    <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>
                      {t('kpi.col.indicator')}
                    </th>
                    {TOTALS.map((k) => (
                      <th
                        key={k}
                        className={`${HEAD_CLASS} ${NUM} ${k === 'min' ? 'border-r border-r-line-strong' : ''}`}
                      >
                        {t(`kpi.total.${k}`)}
                      </th>
                    ))}
                    {data.months.map((m) => (
                      <th key={m} className={`${HEAD_CLASS} ${NUM}`}>
                        {monthShortName(t, m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr
                      key={r.indicator.id}
                      className={chosen?.indicator.id === r.indicator.id ? '[&_td]:bg-sel!' : ''}
                    >
                      <td className={FIRST_CLASS}>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-left text-link hover:underline"
                          title={t('kpi.card.chart_pick')}
                          onClick={() => setChart(r.indicator.id)}
                        >
                          {r.indicator.name}
                        </button>
                        {r.indicator.description ? (
                          <InfoTip
                            label={t('kpi.desc_label', { name: r.indicator.name })}
                            text={r.indicator.description}
                          />
                        ) : null}
                        <small className="text-faint"> {r.indicator.unit}</small>
                      </td>
                      {totals(r)}
                      {data.months.map((_, j) => cell(r, j, ri))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!phone && chosen ? <Chart t={t} data={data} row={chosen} /> : null}
        </>
      )}
      {past ? (
        <PastDialog
          key={`kpi-past-${past.n}`}
          open={past.open}
          onClose={() => setPast((p) => p && { ...p, open: false })}
          data={data}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

/** «Какие показатели вести» (прототип `kpiCardWhoHtml`): переключатель «Вести» и «с <месяц>». */
function WhoBox({
  t,
  data,
  onToggle,
  onFrom,
}: {
  t: Translate;
  data: KpiCard;
  onToggle: (indicatorId: string, on: boolean, name: string) => void;
  onFrom: (indicatorId: string, from: string, name: string) => void;
}) {
  const edit = data.canSetup && !data.contractor.archived;
  const on = data.who.filter((w) => w.on).length;
  return (
    <details
      className="rounded-lg border border-line bg-pane p-3.5"
      open={!data.contractor.archived}
      data-kpi-card-who=""
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <b>{t('kpi.card.who_title')}</b>
        <span className="flex-1" />
        <span className="text-muted">{t('kpi.n_of', { n: on, of: data.who.length })}</span>
        <Icon name="down" size="sm" />
      </summary>
      <div className="mt-2.5 flex flex-col overflow-hidden rounded-lg border border-line">
        {data.who.map((w) => (
          <div
            key={w.indicator.id}
            className="flex items-center gap-2.5 border-b border-line bg-raised px-3 py-[9px] last:border-b-0 max-md:flex-wrap"
          >
            <span className="min-w-0 flex-1 max-md:basis-full">
              <b>{w.indicator.name}</b>
              <small className="mt-px block text-[12px] text-faint">
                {columnSub(t, w.indicator)}
                {!w.on && w.offSince
                  ? ` · ${t('kpi.off_since', { month: monthGenName(t, w.offSince) })}`
                  : ''}
              </small>
            </span>
            {w.on ? (
              <label
                className="flex flex-none items-center gap-1.5"
                title={t('kpi.card.from_title')}
              >
                <span className="text-muted">{t('kpi.card.from')}</span>
                <input
                  type="month"
                  className={`${inputClass({ full: false })} min-h-[30px] w-auto px-2 py-0.5`}
                  value={w.start}
                  max={data.current}
                  disabled={!edit}
                  aria-label={t('kpi.card.from_label', { name: w.indicator.name })}
                  onChange={(e) => {
                    if (e.target.value && e.target.value !== w.start) {
                      onFrom(w.indicator.id, e.target.value, w.indicator.name);
                    }
                  }}
                />
              </label>
            ) : null}
            <label className="flex flex-none cursor-pointer items-center gap-2">
              <span className="text-muted">{t('kpi.card.keep')}</span>
              <input
                type="checkbox"
                role="switch"
                className={SWITCH_CLASS}
                checked={w.on}
                disabled={!edit}
                aria-label={t('kpi.card.keep_label', { name: w.indicator.name })}
                onChange={(e) => onToggle(w.indicator.id, e.target.checked, w.indicator.name)}
              />
            </label>
          </div>
        ))}
      </div>
      {data.canSetup ? null : <Hint>{t('kpi.card.no_setup')}</Hint>}
    </details>
  );
}

/** Какие месяцы не заполнены и «Внести за прошлые месяцы» (прототип `kCardMissHtml`). */
function MissingNote({ t, data, onPast }: { t: Translate; data: KpiCard; onPast: () => void }) {
  const x = data.missing;
  const button = data.editable ? (
    <button
      type="button"
      className={`${buttonClass(x ? 'cta' : 'default', 'sm')} ${x ? '' : 'opacity-60'} max-md:w-full max-md:justify-center`}
      aria-disabled={x ? undefined : true}
      title={x ? undefined : t('kpi.card.past_none')}
      data-kpi-past=""
      onClick={x ? onPast : undefined}
    >
      <Icon name="edit" size="sm" />
      {t('kpi.card.past')}
    </button>
  ) : null;
  if (!x) {
    return button ? (
      <div className="flex flex-wrap items-center gap-2.5">
        <Hint>{t('kpi.card.all_in')}</Hint>
        <span className="flex-1" />
        {button}
      </div>
    ) : null;
  }
  const n = x.months.length;
  return (
    <Note tone={x.overdue ? 'bad' : 'warn'} icon="alert">
      <span className="flex flex-wrap items-center gap-2.5" data-kpi-card-missing="">
        <span className="min-w-0 flex-1">
          {t(`kpi.card.missing.${pluralForm(n)}`, {
            n,
            months: x.months.map(monthText).join(', '),
          })}
          {x.overdue ? '' : ` ${t('kpi.card.not_late')}`}
        </span>
        {button}
      </span>
    </Note>
  );
}

/** «… по месяцам»: столбики выбранного показателя, серые отметки — месяцы без значения. */
function Chart({ t, data, row }: { t: Translate; data: KpiCard; row: KpiCard['rows'][number] }) {
  const months = data.months;
  const values = row.values;
  const max = Math.max(1, ...values.filter((v): v is number => v !== null).map(Math.abs));
  const W = Math.max(320, months.length * 56);
  const H = 170;
  const step = W / months.length;
  const bw = Math.min(36, step - 14);
  const totals = indicatorTotals(values);
  const main = row.indicator.total;
  return (
    <section className="rounded-lg border border-line bg-pane p-3.5">
      <h3 className="mt-0 mb-2 flex items-center gap-2 text-[14px] font-semibold">
        {t('kpi.card.chart_title', { name: row.indicator.name })}
        <span className="flex-1" />
        <span className="text-[12.5px] font-normal text-muted">
          {t(`kpi.total.${main}`)}: {'sum' in totals ? valueText(row.indicator, totals[main]) : '—'}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={t('kpi.card.chart_label', { name: row.indicator.name })}
          style={{ minWidth: Math.min(W, 560), display: 'block' }}
        >
          <line x1={0} x2={W} y1={H - 24} y2={H - 24} stroke="var(--bu-border)" />
          {months.map((m, j) => {
            const v = values[j] ?? null;
            const x = j * step + (step - bw) / 2;
            const bh = v === null ? 0 : Math.max(2, (Math.abs(v) / max) * (H - 50));
            return (
              <g key={m}>
                <title>
                  {`${monthName(t, m)}: ${v === null ? t('status.indicator.empty') : valueText(row.indicator, v)}`}
                </title>
                {v === null ? (
                  <rect
                    x={x}
                    y={H - 28}
                    width={bw}
                    height={4}
                    rx={2}
                    fill="var(--bu-border-strong)"
                  />
                ) : (
                  <rect
                    x={x}
                    y={H - 24 - bh}
                    width={bw}
                    height={bh}
                    rx={4}
                    fill="var(--bu-b-blue)"
                  />
                )}
                <text
                  x={x + bw / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--bu-faint)"
                >
                  {monthShortName(t, m).split(' ')[0]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <Hint>{t('kpi.card.chart_hint')}</Hint>
    </section>
  );
}

type PastRow = { month: string; due: string; status: MonthStatus | null; cells: KpiCell[] };

/**
 * «Внести за прошлые месяцы» (прототип `kPastDlg`): незаполненные месяцы контрагента от «с …» до
 * прошлого месяца по всем ведущимся показателям, ввод в ячейках как в «Вводе за месяц». Список месяцев
 * запоминается при открытии: заполненная строка не исчезает, пока окно открыто.
 */
function PastDialog({
  open,
  onClose,
  data,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  data: KpiCard;
  onSave: (changes: CellChange[]) => Promise<{
    changed: number;
    statuses: { month: string; status: MonthStatus['code'] }[];
  } | null>;
}) {
  const t = useT();
  const toast = useToast();
  const ref = useRef<HTMLTableElement>(null);
  const columns = data.who.filter((w) => w.on).map((w) => w.indicator);
  const [rows, setRows] = useState<PastRow[]>(() =>
    data.past.map((p) => ({ month: p.month, due: p.due, status: p.status, cells: p.cells })),
  );
  const grid = useCellGrid(ref, { rows: rows.length, cols: columns.length });
  const contractorId = data.contractor.id;
  const cellOf = (row: PastRow, indicatorId: string) =>
    row.cells.find((c) => c.indicatorId === indicatorId);
  const left = rows.filter((r) =>
    columns.some((col) => {
      const c = cellOf(r, col.id);
      return col.required && c?.state === 'required' && c.value === null;
    }),
  ).length;

  const save = async (changes: CellChange[]) => {
    if (changes.length === 0) return null;
    const by = new Map(changes.map((c) => [`${c.month}|${c.indicatorId}`, c.value]));
    setRows((list) =>
      list.map((r) => ({
        ...r,
        cells: r.cells.map((c) =>
          by.has(`${r.month}|${c.indicatorId}`)
            ? { ...c, value: by.get(`${r.month}|${c.indicatorId}`)! }
            : c,
        ),
      })),
    );
    const done = await onSave(changes);
    if (done) {
      const statuses = new Map(done.statuses.map((s) => [s.month, s.status]));
      setRows((list) =>
        list.map((r) =>
          statuses.has(r.month)
            ? {
                ...r,
                status: {
                  ...(r.status ?? { id: '', version: 0, actor: null }),
                  code: statuses.get(r.month)!,
                  at: new Date().toISOString(),
                },
              }
            : r,
        ),
      );
    }
    return done;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t('kpi.card.past')}
      sub={data.contractor.name}
      footer={
        <>
          <span className="flex-1 text-[12.5px] text-muted" data-kpi-past-left="">
            {rows.length ? t('kpi.card.past_left', { n: left, of: rows.length }) : ''}
          </span>
          <button type="button" className={buttonClass('cta')} onClick={onClose}>
            {t('kpi.card.done')}
          </button>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon="ok"
          title={t('kpi.missing.empty_title')}
          text={t('kpi.card.past_empty')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Note>{t('kpi.card.past_note')}</Note>
          <div className={WRAP_CLASS} data-no-swipe="">
            <table ref={ref} className={TABLE_CLASS} data-kpi-past-table="">
              <thead>
                <tr>
                  <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.month')}</th>
                  {columns.map((col) => (
                    <th key={col.id} className={`${HEAD_CLASS} ${NUM}`}>
                      {col.name}
                      {col.description ? (
                        <InfoTip
                          label={t('kpi.desc_label', { name: col.name })}
                          text={col.description}
                        />
                      ) : null}
                      <small>{columnSub(t, col)}</small>
                    </th>
                  ))}
                  <th className={HEAD_CLASS}>{t('kpi.col.month_status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const overdue =
                    (row.status?.code ?? 'empty') === 'empty' &&
                    data.past.find((p) => p.month === row.month)?.overdue;
                  return (
                    <tr
                      key={row.month}
                      className={overdue ? OVERDUE_ROW : ''}
                      data-kpi-past-row={row.month}
                    >
                      <td className={FIRST_CLASS}>
                        <b>{monthName(t, row.month)}</b>
                        <small className="block text-[11px] text-faint">
                          {t('kpi.card.due', { date: formatDateRu(row.due) })}
                        </small>
                      </td>
                      {columns.map((col, ci) => {
                        const c = cellOf(row, col.id);
                        if (!c || c.state !== 'required') {
                          return (
                            <td
                              key={col.id}
                              className={`${NUM} ${OFF_CELL}`}
                              title={t('kpi.card.not_needed')}
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={col.id}
                            className={`${NUM} ${c.value === null && col.required ? EMPTY_CELL : ''}`}
                          >
                            <ValueInput
                              r={ri}
                              c={ci}
                              cell={{
                                contractorId,
                                indicatorId: col.id,
                                month: row.month,
                                type: col.type,
                              }}
                              value={c.value}
                              readOnly={false}
                              label={t('kpi.month_cell_label', {
                                ind: col.name,
                                month: monthName(t, row.month),
                              })}
                              onCommit={(value, prev) =>
                                void save([
                                  {
                                    contractorId,
                                    indicatorId: col.id,
                                    month: row.month,
                                    value,
                                    prev,
                                  },
                                ])
                              }
                              onBad={(text) => toast(t('kpi.not_number', { text }), { bad: true })}
                              onMove={grid.onMove}
                              onPaste={async (r0, c0, block) => {
                                const { changes, bad } = grid.pasted(r0, c0, block);
                                const done = await save(changes);
                                if (done) {
                                  toast(
                                    bad
                                      ? t('kpi.pasted_bad', { n: done.changed, bad })
                                      : t('kpi.pasted', { n: done.changed }),
                                    { icon: 'paste' },
                                  );
                                }
                              }}
                            />
                          </td>
                        );
                      })}
                      <td>
                        <MonthMini status={row.status} needed />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
