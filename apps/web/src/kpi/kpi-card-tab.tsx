'use client';

import { formatDateRu, indicatorTotals, monthText, pluralForm } from '@buhuchet/domain';
import {
  KpiValuesSaved,
  type KpiCard,
  type KpiCell,
  type KpiColumn,
  type MonthStatus,
} from '@buhuchet/shared';
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
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { cardQuery, missingSummaryQuery, useKpiRefresh } from './kpi-data';
import { useKpiEntry } from './kpi-entry';
import { exCellOf, exKey, type KxRef, KxTd, putCells } from './kpi-ex';
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
  FIRST_CLASS,
  HEAD_CLASS,
  InfoTip,
  NUM,
  OVERDUE_ROW,
  TABLE_CLASS,
  WRAP_CLASS,
  type CellChange,
} from './kpi-table';
import { EX_WRAP, useExTable } from './use-ex-table';

/*
 * Вкладка «Показатели» карточки контрагента (задача 2.27; ТЗ «В карточке контрагента на вкладке
 * «Показатели»», «Индикатор незаполненных показателей»; прототип modules/kpi.js: kpiCardHtml,
 * kpiCardWhoHtml, kCardMissHtml, kPastDlg, kpiCardMount). Ставит её в карточку задача карточки
 * контрагента (2.11, #67): здесь — сама вкладка, число на ярлыке вкладки и значок для списка контрагентов
 * (задача 2.10, #66). Ввод значений — таблица как в Excel (прототип v81, `ex-table.ts`).
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
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const phone = useMediaQuery(PHONE_QUERY);
  const entry = useKpiEntry();
  const [period, setPeriod] = useState<Period | null>(null);
  const [chart, setChart] = useState<string | null>(null);
  const [past, setPast] = useState<{ n: number; open: boolean } | null>(null);
  const query = useQuery({ ...cardQuery(contractorId, period), placeholderData: keepPreviousData });
  const data = query.data;

  if (query.isError && !data) return <Note tone="bad">{t('kpi.load_error')}</Note>;
  if (!data) return null;

  /** Сохранить значения: сразу в таблице, потом на сервере; ошибка — уведомление и данные с сервера. */
  const save = async (changes: readonly CellChange[]) => {
    if (changes.length === 0) return null;
    client.setQueryData<KpiCard>(
      cardQuery(contractorId, period).queryKey,
      (old) => old && patchedCard(old, changes),
    );
    const res = await callApi(() => api.api.kpi.values.$put({ json: { values: [...changes] } }));
    void refresh();
    if (!res.ok) {
      toast(errorText(res.error), { bad: true });
      return null;
    }
    return KpiValuesSaved.parse(res.data);
  };
  const onSave = async (changes: CellChange[]) => (await save(changes)) !== null;

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
  const onEntry = (month: string) => void entry.open(contractorId, month);

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
          <Hint>
            {t('kpi.card.hint')}
            {data.editable ? ` ${t('kpi.card.hint_edit')}` : ''}
          </Hint>
          {phone ? (
            rows.map((r) => (
              <CardMini
                key={r.indicator.id}
                t={t}
                data={data}
                row={r}
                onSave={onSave}
                onEntry={onEntry}
              />
            ))
          ) : (
            <CardGrid
              t={t}
              data={data}
              chosen={chosen?.indicator.id ?? null}
              onChart={setChart}
              onSave={onSave}
              onEntry={onEntry}
            />
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
          onEntry={onEntry}
        />
      ) : null}
      {entry.dialog}
    </div>
  );
}

type CardRow = KpiCard['rows'][number];

/** Значения после правки — сразу в таблице карточки, пока сервер не ответил. */
function patchedCard(data: KpiCard, changes: readonly CellChange[]): KpiCard {
  const by = new Map(changes.map((c) => [`${c.indicatorId}|${c.month}`, c.value]));
  return {
    ...data,
    rows: data.rows.map((r) => ({
      ...r,
      values: r.values.map((v, j) => {
        const key = `${r.indicator.id}|${data.months[j]}`;
        return by.has(key) ? by.get(key)! : v;
      }),
    })),
  };
}

/** Ячейка карточки: показатель строки за месяц `j`. */
function cardRef(data: KpiCard, row: CardRow, j: number): KxRef | null {
  const month = data.months[j];
  if (!month) return null;
  return {
    contractorId: data.contractor.id,
    indicatorId: row.indicator.id,
    type: row.indicator.type,
    required: row.indicator.required,
    archived: row.indicator.archived,
    month,
    state: row.applies[j] ? 'required' : row.early[j] ? 'early' : 'off',
    start: row.start,
    offSince: row.offSince,
    value: row.values[j] ?? null,
    editable: data.editable,
  };
}

/** Пункт меню правой кнопки: окно контрагента за месяц — комментарий, файл и история значения. */
const entryItem = (t: Translate, name: string, month: string, onEntry: (m: string) => void) => ({
  id: 'entry',
  label: t('kpi.ex.menu.entry'),
  icon: 'clip' as const,
  sub: `${name} · ${monthName(t, month)}`,
  run: () => onEntry(month),
});

/** Итоги строки (прототип `kCardTots`): сумма, среднее «по N из M», максимум, минимум. */
function CardTotals({ t, data, row }: { t: Translate; data: KpiCard; row: CardRow }) {
  return TOTALS.map((k) => (
    <td
      key={k}
      className={`${NUM} bg-pane-alt! ${k === row.indicator.total ? 'font-semibold' : ''} ${k === 'min' ? 'border-r border-r-line-strong' : ''}`}
      data-kpi-card-total={`${row.indicator.name}|${k}`}
    >
      {row.count ? numberText(row.indicator.type, row.totals[k]) : '—'}
      {k === 'avg' && row.count ? (
        <small className="text-faint">
          {' '}
          {t('kpi.avg_of', { n: row.count, of: row.need || data.months.length })}
        </small>
      ) : null}
    </td>
  ));
}

/**
 * Таблица «показатель × месяц» карточки на ПК (прототип `kpiCardHtml`, `kpiCardMount`): итоги строки и
 * ввод как в Excel; название показателя выбирает его для графика.
 */
function CardGrid({
  t,
  data,
  chosen,
  onChart,
  onSave,
  onEntry,
}: {
  t: Translate;
  data: KpiCard;
  chosen: string | null;
  onChart: (id: string) => void;
  onSave: (changes: CellChange[]) => Promise<boolean>;
  onEntry: (month: string) => void;
}) {
  const rows = data.rows;
  const at = (r: number, j: number) => (rows[r] ? cardRef(data, rows[r], j) : null);
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable({
    rows: rows.length,
    cols: data.months.length,
    get: (r, c) => exCellOf(t, at(r, c), data.current),
    key: (r, c) => exKey(at(r, c)),
    put: (list) => putCells(list, at, onSave),
    label: (r, c) =>
      t('kpi.ex.cell_label', {
        name: data.contractor.name,
        ind: rows[r]!.indicator.name,
        month: monthName(t, data.months[c]!),
      }),
    menu: (_r, c) => [entryItem(t, data.contractor.name, data.months[c]!, onEntry)],
  });
  return (
    <>
      {exStat}
      <div ref={exRef} className={`${WRAP_CLASS} ${EX_WRAP}`} data-no-swipe="">
        {exLayer}
        <table className={TABLE_CLASS} data-kpi-card-table="">
          <thead>
            <tr>
              <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.indicator')}</th>
              {TOTALS.map((k) => (
                <th
                  key={k}
                  className={`${HEAD_CLASS} ${NUM} ${k === 'min' ? 'border-r border-r-line-strong' : ''}`}
                >
                  {t(`kpi.total.${k}`)}
                </th>
              ))}
              {data.months.map((m, j) => (
                <th
                  key={m}
                  className={`${HEAD_CLASS} ${NUM}`}
                  data-exc={j}
                  title={t('kpi.ex.select_col')}
                >
                  {monthShortName(t, m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr
                key={row.indicator.id}
                className={chosen === row.indicator.id ? '[&_td]:bg-sel!' : ''}
                data-kpi-card-row={row.indicator.id}
              >
                <td className={FIRST_CLASS} data-exr={r}>
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-link hover:underline"
                    title={t('kpi.card.chart_pick')}
                    onClick={() => onChart(row.indicator.id)}
                  >
                    {row.indicator.name}
                  </button>
                  {row.indicator.description ? (
                    <InfoTip
                      label={t('kpi.desc_label', { name: row.indicator.name })}
                      text={row.indicator.description}
                    />
                  ) : null}
                  <small className="text-faint"> {row.indicator.unit}</small>
                </td>
                <CardTotals t={t} data={data} row={row} />
                {data.months.map((m, j) => (
                  <KxTd key={m} r={r} c={j} x={at(r, j)!} current={data.current} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {exMenu}
    </>
  );
}

/**
 * Показатель карточки на телефоне (прототип `kpiCardHtml`, `.kcard-i`): итоги плитками и месяцы
 * столбиком — своя таблица как в Excel в один столбец: нажатие открывает ввод, «Далее» — следующий месяц.
 */
function CardMini({
  t,
  data,
  row,
  onSave,
  onEntry,
}: {
  t: Translate;
  data: KpiCard;
  row: CardRow;
  onSave: (changes: CellChange[]) => Promise<boolean>;
  onEntry: (month: string) => void;
}) {
  const at = (r: number, c: number) => (c === 0 ? cardRef(data, row, r) : null);
  const {
    wrapRef: exRef,
    layer: exLayer,
    menu: exMenu,
  } = useExTable(
    {
      rows: data.months.length,
      cols: 1,
      get: (r, c) => exCellOf(t, at(r, c), data.current),
      key: (r, c) => exKey(at(r, c)),
      put: (list) => putCells(list, at, onSave),
      label: (r) =>
        t('kpi.ex.cell_label', {
          name: data.contractor.name,
          ind: row.indicator.name,
          month: monthName(t, data.months[r]!),
        }),
      menu: (r) => [entryItem(t, data.contractor.name, data.months[r]!, onEntry)],
    },
    { stat: false },
  );
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-line bg-pane p-3"
      data-kpi-card-row={row.indicator.id}
    >
      <div className="flex items-center gap-2">
        <b className="flex-1">{row.indicator.name}</b>
        {row.indicator.description ? (
          <InfoTip
            label={t('kpi.desc_label', { name: row.indicator.name })}
            text={row.indicator.description}
          />
        ) : null}
        <Tag>{row.indicator.unit || '—'}</Tag>
      </div>
      <div className="grid grid-cols-4 gap-1.5 max-[560px]:grid-cols-2">
        {TOTALS.map((k) => (
          <span
            key={k}
            className={`flex flex-col rounded-lg bg-pane-alt px-2 py-1.5 ${k === row.indicator.total ? 'shadow-[inset_0_0_0_1px_var(--bu-border-strong)]' : ''}`}
          >
            <small className="text-[11px] text-faint">{t(`kpi.total.${k}`)}</small>
            <b className="text-[13.5px] tabular-nums">
              {row.count ? numberText(row.indicator.type, row.totals[k]) : '—'}
            </b>
          </span>
        ))}
      </div>
      <div ref={exRef} className={EX_WRAP} data-no-swipe="">
        {exLayer}
        <table className="w-full text-[13px]">
          <tbody>
            {data.months.map((m, j) => (
              <tr key={m}>
                <td className="px-0.5 py-1" data-exr={j}>
                  {monthName(t, m)}
                </td>
                <KxTd r={j} c={0} x={at(j, 0)!} current={data.current} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {exMenu}
    </section>
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
 * «Внести за прошлые месяцы» (прототип v81 `kPastDlg`): незаполненные месяцы контрагента от «с …» до
 * прошлого месяца по всем ведущимся показателям, таблица как в Excel, как в «Вводе за месяц». Список
 * месяцев запоминается при открытии: заполненная строка не исчезает, пока окно открыто.
 */
function PastDialog({
  open,
  onClose,
  data,
  onSave,
  onEntry,
}: {
  open: boolean;
  onClose: () => void;
  data: KpiCard;
  onSave: (changes: CellChange[]) => Promise<KpiValuesSaved | null>;
  onEntry: (month: string) => void;
}) {
  const t = useT();
  const columns = data.who.filter((w) => w.on).map((w) => w.indicator);
  const [rows, setRows] = useState<PastRow[]>(() =>
    data.past.map((p) => ({ month: p.month, due: p.due, status: p.status, cells: p.cells })),
  );
  const contractorId = data.contractor.id;
  const cellOf = (row: PastRow, indicatorId: string) =>
    row.cells.find((c) => c.indicatorId === indicatorId);
  const left = rows.filter((r) =>
    columns.some((col) => {
      const c = cellOf(r, col.id);
      return col.required && c?.state === 'required' && c.value === null;
    }),
  ).length;

  const at = (r: number, ci: number): KxRef | null => {
    const row = rows[r];
    const col = columns[ci];
    if (!row || !col) return null;
    const c = cellOf(row, col.id);
    return {
      contractorId,
      indicatorId: col.id,
      type: col.type,
      required: col.required,
      archived: col.archived,
      month: row.month,
      state: c?.state ?? 'off',
      start: c?.start ?? row.month,
      offSince: c?.offSince ?? null,
      value: c?.value ?? null,
      editable: data.editable,
    };
  };

  const save = async (changes: CellChange[]) => {
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
    if (!done) return false;
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
    return true;
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
      {rows.length === 0 || columns.length === 0 ? (
        <EmptyState
          icon="ok"
          title={t('kpi.missing.empty_title')}
          text={t('kpi.card.past_empty')}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Note>{t('kpi.card.past_note')}</Note>
          <PastTable
            t={t}
            data={data}
            rows={rows}
            columns={columns}
            at={at}
            onSave={save}
            onEntry={onEntry}
          />
        </div>
      )}
    </Modal>
  );
}

/** Таблица окна «Внести за прошлые месяцы»: месяцы × показатели как в Excel; строится, когда окно на экране. */
function PastTable({
  t,
  data,
  rows,
  columns,
  at,
  onSave,
  onEntry,
}: {
  t: Translate;
  data: KpiCard;
  rows: readonly PastRow[];
  columns: readonly KpiColumn[];
  at: (r: number, c: number) => KxRef | null;
  onSave: (changes: CellChange[]) => Promise<boolean>;
  onEntry: (month: string) => void;
}) {
  const {
    wrapRef: exRef,
    layer: exLayer,
    stat: exStat,
    menu: exMenu,
  } = useExTable({
    rows: rows.length,
    cols: columns.length,
    get: (r, c) => exCellOf(t, at(r, c), data.current),
    key: (r, c) => exKey(at(r, c)),
    put: (list) => putCells(list, at, onSave),
    label: (r, c) =>
      t('kpi.ex.cell_label', {
        name: data.contractor.name,
        ind: columns[c]!.name,
        month: monthName(t, rows[r]!.month),
      }),
    menu: (r) => [entryItem(t, data.contractor.name, rows[r]!.month, onEntry)],
  });
  return (
    <>
      {exStat}
      <div ref={exRef} className={`${WRAP_CLASS} ${EX_WRAP}`} data-no-swipe="">
        {exLayer}
        <table className={TABLE_CLASS} data-kpi-past-table="">
          <thead>
            <tr>
              <th className={`${HEAD_CLASS} ${FIRST_CLASS} z-[3]`}>{t('kpi.col.month')}</th>
              {columns.map((col, ci) => (
                <th
                  key={col.id}
                  className={`${HEAD_CLASS} ${NUM}`}
                  data-exc={ci}
                  title={t('kpi.ex.select_col')}
                >
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
                  <td className={FIRST_CLASS} data-exr={ri}>
                    <b>{monthName(t, row.month)}</b>
                    <small className="block text-[11px] text-faint">
                      {t('kpi.card.due', { date: formatDateRu(row.due) })}
                    </small>
                  </td>
                  {columns.map((col, ci) => (
                    <KxTd key={col.id} r={ri} c={ci} x={at(ri, ci)!} current={data.current} />
                  ))}
                  <td>
                    <MonthMini status={row.status} needed />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {exMenu}
    </>
  );
}
