'use client';

import {
  formatSom,
  formatSomWithUnit,
  reportTaxMonths,
  reportTaxRoles,
  type YearMonth,
} from '@buhuchet/domain';
import type { KpiTaxBox, ReportCard } from '@buhuchet/shared';
import {
  buttonClass,
  Hint,
  Icon,
  inputClass,
  linkButtonClass,
  MiniTable,
  Tag,
  useToast,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { TaxFill } from '../reports/report-amount';
import { useShell } from '../shell/context';
import { taxBoxQuery, useKpiRefresh } from './kpi-data';
import { monthGenName, monthName, monthShortName, numberText, parseCell } from './kpi-format';

/*
 * «Расчёт по показателям» в окнах «Сумма к уплате» и «Отметить сданным» (прототип v80
 * modules/kpi-tax.js: kTaxOk, kTaxHtml, kTaxBind; стили css/extable.css `.ktx`): значения показателей
 * с отметкой «Для расчёта налогов» за месяцы периода отчёта, недостающие вносятся прямо здесь и
 * пишутся в показатели; расчёт — подсказка, суммы подставляются кнопкой «Подставить». Считает сервер
 * (`GET /api/kpi/tax/{reportId}`), блок только показывает.
 */

type Box = NonNullable<KpiTaxBox['box']>;
type Row = Box['rows'][number];

/** Вид отчёта и период подходят для блока (прототип kTaxNeed, kRepMs) — до ответа сервера. */
const boxFits = (card: Pick<ReportCard, 'type' | 'act' | 'period' | 'periodStart'>) =>
  reportTaxRoles(card.type.code, card.act) !== null &&
  reportTaxMonths(card.period, card.periodStart).length > 0;

/**
 * Блок отчёта: `wide` — окну нужна средняя ширина (блок есть или ещё грузится), `box` — данные блока
 * (null — блока нет: функция выключена, нет права «Просматривать показатели», вид без расчёта,
 * контрагент вне области показателей).
 */
export function useReportTaxBox(
  card: Pick<ReportCard, 'id' | 'type' | 'act' | 'period' | 'periodStart'>,
): { wide: boolean; box: Box | null } {
  const { access } = useShell();
  const on = access.feature('indicators') && access.can('kpiView') && boxFits(card);
  const query = useQuery({ ...taxBoxQuery(card.id), enabled: on });
  const box = on ? (query.data?.box ?? null) : null;
  return { wide: on && (query.isPending || box !== null), box };
}

// Жирные суммы внутри текста словаря: значение подстановки берётся в эти скобки.
const OPEN = '⟦';
const CLOSE = '⟧';
const strong = (text: string) => `${OPEN}${text}${CLOSE}`;

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(new RegExp(`${OPEN}|${CLOSE}`)).map((part, n) =>
        n % 2 ? (
          <b key={n} className="tabular-nums">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Строка итога (`.ktx-row`): текст с подсказкой и кнопки сразу за ним. */
function ResultRow({
  children,
  hint,
  alert = false,
  actions,
}: {
  children?: ReactNode;
  hint?: ReactNode;
  alert?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-kpi-tax-row="">
      {alert ? <Icon name="alert" size="sm" className="flex-none text-faint" /> : null}
      {children !== undefined || hint !== undefined ? (
        <span className={`min-w-[200px] ${alert ? 'text-[11.5px] text-faint' : ''}`}>
          {children}
          {hint ? <Hint>{hint}</Hint> : null}
        </span>
      ) : null}
      {actions}
    </div>
  );
}

/** Поле значения месяца (`.ktx-in`): пишется в показатели по уходу из поля или Enter. */
function CellInput({
  row,
  month,
  value,
  label,
  placeholder,
  onCommit,
}: {
  row: Row;
  month: YearMonth;
  value: number | null;
  label: string;
  placeholder: string;
  onCommit: (text: string) => void;
}) {
  const shown = numberText(row.indicator.type, value);
  const [draft, setDraft] = useState<string | null>(null);
  // Пустое обязательное значение подсвечено (прототип `td.emp`): численность расчёту не обязательна.
  const empty = value === null && row.role !== 'emp';
  return (
    <input
      type="text"
      inputMode="decimal"
      data-kpi-tax-cell={`${row.role}:${month}`}
      aria-label={label}
      placeholder={placeholder}
      className={`${inputClass({ full: false })} ml-auto block min-h-[30px]! w-[110px] px-2! py-[3px]! text-right tabular-nums ${empty ? 'border-[color-mix(in_srgb,var(--bu-b-yellow)_45%,var(--bu-border))]! bg-[color-mix(in_srgb,var(--bu-b-yellow)_16%,var(--bu-pane))]!' : ''}`}
      value={draft ?? shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // Enter записывает значение, а не сохраняет окно (прототип: stopPropagation и blur).
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.blur();
      }}
      onBlur={() => {
        if (draft === null) return;
        setDraft(null);
        if (draft.trim() !== shown) onCommit(draft);
      }}
    />
  );
}

export function ReportTaxBox({
  reportId,
  box,
  period,
  typeShort,
  onFill,
}: {
  reportId: string;
  box: Box;
  /** Период отчёта словами: «III квартал 2026». */
  period: string;
  /** Короткое название вида отчёта — в строке «<вид> ≈ <сумма>». */
  typeShort: string;
  /** «Подставить»: окно ставит значения в свои поля; false — поля не нашлось. */
  onFill: (fill: TaxFill) => boolean;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const refresh = useKpiRefresh();
  const { months, result } = box;
  const contractorId = box.contractor.id;
  const key = taxBoxQuery(reportId).queryKey;

  const commit = async (row: Row, month: YearMonth, prev: number | null, text: string) => {
    const value = parseCell(row.indicator.type, text);
    if (value === undefined) return toast(t('kpi.not_number', { text }), { bad: true });
    if (value === prev) return;
    // Значение сразу в таблице; расчёт под ней придёт с сервера.
    client.setQueryData<KpiTaxBox>(key, (old) =>
      old?.box
        ? {
            box: {
              ...old.box,
              rows: old.box.rows.map((r) =>
                r.role === row.role
                  ? {
                      ...r,
                      cells: r.cells.map((c) => (c.month === month ? { ...c, value } : c)),
                    }
                  : r,
              ),
            },
          }
        : old,
    );
    const res = await callApi(() =>
      api.api.kpi.values.$put({
        json: { values: [{ contractorId, indicatorId: row.indicator.id, month, value, prev }] },
      }),
    );
    void refresh();
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    toast(t('kpi.tax.saved', { name: row.indicator.name, month: monthName(t, month) }), {
      icon: 'gauge',
    });
  };

  /** «Вести»: показатель включается у контрагента; период отчёта раньше «с <месяц>» — «с» сдвигается. */
  const turnOn = async (row: Row) => {
    const indicatorId = row.indicator.id;
    const res = await callApi(() =>
      api.api.kpi.who.$put({ json: { changes: [{ indicatorId, contractorId, on: true }] } }),
    );
    if (!res.ok) {
      void refresh();
      return toast(errorText(res.error), { bad: true });
    }
    const fresh = await client
      .fetchQuery({ ...taxBoxQuery(reportId), staleTime: 0 })
      .catch(() => null);
    const start = fresh?.box?.rows.find((r) => r.role === row.role)?.start;
    const first = months[0];
    if (first && start && first < start) {
      const from = first < box.current ? first : box.current;
      const moved = await callApi(() =>
        api.api.kpi.who.from.$put({ json: { indicatorId, contractorId, from } }),
      );
      if (!moved.ok) toast(errorText(moved.error), { bad: true });
    }
    void refresh();
    toast(t('kpi.tax.turned_on', { name: row.indicator.name, cp: box.contractor.name }), {
      icon: 'gauge',
    });
  };

  const fill = (value: TaxFill) => {
    if (onFill(value)) toast(t('kpi.tax.filled'), { icon: 'gauge' });
  };
  const fillButton = (label: string, value: TaxFill, mark: string) => (
    <button
      type="button"
      key={mark}
      className={buttonClass('default', 'sm')}
      data-kpi-tax-fill={mark}
      onClick={() => fill(value)}
    >
      <Icon name="download" size="sm" />
      {label}
    </button>
  );

  let body: ReactNode;
  if (result.kind === 'no_indicator') {
    body = (
      <Hint>
        {t('kpi.tax.no_indicator', { name: t(`kpi.tax.name.${box.main}`) })}{' '}
        {t(box.canSetup ? 'kpi.tax.no_indicator_setup' : 'kpi.tax.no_indicator_ask')}
      </Hint>
    );
  } else {
    let rows: ReactNode;
    if (result.kind === 'missing') {
      rows = (
        <ResultRow alert>
          {t(box.editable ? 'kpi.tax.missing_edit' : 'kpi.tax.missing', {
            name: result.indicator,
            months: result.months.map((m) => monthName(t, m)).join(', '),
          })}
        </ResultRow>
      );
    } else if (result.kind === 'no_tariff') {
      rows = <ResultRow alert>{t('kpi.tax.no_tariff')}</ResultRow>;
    } else if (result.kind === 'socfund') {
      const parts =
        result.incomeKey !== null && result.contributionsKey !== null
          ? [
              { key: result.incomeKey, tax: result.incomeTax },
              { key: result.contributionsKey, tax: result.contributions },
            ]
          : null;
      rows = (
        <>
          <ResultRow
            hint={t('kpi.tax.income_hint', {
              rate: result.incomeRate,
              worker: String(result.workerRate).replace('.', ','),
            })}
          >
            <Rich
              text={t('kpi.tax.income', { sum: strong(formatSomWithUnit(result.incomeTax)) })}
            />
          </ResultRow>
          <ResultRow
            hint={`${t('kpi.tax.contrib_hint', { tariff: result.tariff, total: result.total })}${
              result.capped ? t('kpi.tax.contrib_cap', { cap: formatSom(result.cap, 'auto') }) : ''
            }`}
            actions={fillButton(
              t('kpi.tax.to_sum'),
              parts
                ? { kind: 'parts', parts }
                : { kind: 'amount', amount: result.incomeTax + result.contributions },
              'sum',
            )}
          >
            <Rich
              text={t('kpi.tax.contrib', {
                sum: strong(formatSomWithUnit(result.contributions)),
              })}
            />
          </ResultRow>
        </>
      );
    } else if (result.kind === 'line') {
      rows = (
        <ResultRow
          actions={fillButton(
            t('kpi.tax.to_revenue'),
            { kind: 'revenue', key: result.key, revenue: result.revenue },
            result.key,
          )}
        >
          <Rich
            text={t('kpi.tax.line', {
              label: result.label,
              revenue: strong(formatSomWithUnit(result.revenue)),
              tax: strong(formatSomWithUnit(result.tax)),
            })}
          />
        </ResultRow>
      );
    } else if (result.kind === 'lines') {
      rows = (
        <>
          <ResultRow>
            <Rich
              text={t('kpi.tax.lines', { revenue: strong(formatSomWithUnit(result.revenue)) })}
            />
          </ResultRow>
          <ResultRow
            actions={result.lines.map((l) =>
              fillButton(
                t('kpi.tax.to_line', { label: l.label }),
                { kind: 'revenue', key: l.key, revenue: result.revenue },
                l.key,
              ),
            )}
          />
        </>
      );
    } else if (result.kind === 'no_rate') {
      rows = (
        <ResultRow>
          <Rich
            text={t(result.vat ? 'kpi.tax.no_rate.vat' : 'kpi.tax.no_rate.other', {
              revenue: strong(formatSomWithUnit(result.revenue)),
            })}
          />
        </ResultRow>
      );
    } else {
      rows = (
        <ResultRow
          hint={t('kpi.tax.rate_hint', {
            pct: result.pct,
            revenue: formatSomWithUnit(result.revenue),
          })}
          actions={fillButton(
            t('kpi.tax.to_sum'),
            { kind: 'amount', amount: result.amount },
            'sum',
          )}
        >
          <Rich
            text={t('kpi.tax.rate', {
              type: typeShort,
              sum: strong(formatSomWithUnit(result.amount)),
            })}
          />
        </ResultRow>
      );
    }
    body = (
      <>
        <MiniTable
          label={t('kpi.tax.title')}
          empty=""
          phoneCards={false}
          columns={[
            { key: 'indicator', label: t('kpi.col.indicator') },
            ...months.map((m) => ({ key: m, label: monthShortName(t, m), numeric: true })),
            ...(months.length > 1
              ? [{ key: 'total', label: t('kpi.tax.total'), numeric: true }]
              : []),
          ]}
          rows={box.rows.map((row) => ({
            key: row.role,
            cells: {
              indicator: (
                <span className="whitespace-nowrap">
                  {row.indicator.name} <small className="text-faint">{row.indicator.unit}</small>
                  {row.on ? null : (
                    <>
                      {' '}
                      <Tag
                        title={
                          row.offSince
                            ? t('kpi.off_since', { month: monthGenName(t, row.offSince) })
                            : t('kpi.tax.off_title')
                        }
                      >
                        {t('kpi.tax.off')}
                      </Tag>
                      {row.canTurnOn ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            className={linkButtonClass()}
                            data-kpi-tax-on={row.role}
                            onClick={() => void turnOn(row)}
                          >
                            {t('kpi.tax.turn_on')}
                          </button>
                        </>
                      ) : null}
                    </>
                  )}
                </span>
              ),
              ...Object.fromEntries(
                row.cells.map((cell) => [
                  cell.month,
                  cell.input ? (
                    <CellInput
                      row={row}
                      month={cell.month}
                      value={cell.value}
                      label={t('kpi.tax.cell', {
                        name: row.indicator.name,
                        month: monthName(t, cell.month),
                      })}
                      placeholder={t('kpi.tax.enter')}
                      onCommit={(text) => void commit(row, cell.month, cell.value, text)}
                    />
                  ) : cell.value === null ? (
                    <span className="text-faint">—</span>
                  ) : (
                    numberText(row.indicator.type, cell.value)
                  ),
                ]),
              ),
              total: (
                <b className="tabular-nums">
                  {row.total === null ? '—' : numberText(row.indicator.type, row.total)}
                </b>
              ),
            },
          }))}
        />
        <div className="mt-2 flex flex-col gap-1.5" data-kpi-tax-result={result.kind}>
          {rows}
        </div>
      </>
    );
  }

  return (
    <div
      data-field=""
      data-kpi-tax-box={box.main}
      className="col-span-full min-w-0 rounded-lg border border-line bg-pane-alt px-3 py-2.5"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Icon name="gauge" size="sm" />
        <b>{t('kpi.tax.title')}</b>
        <Hint>{t(`kpi.tax.sub.${box.main}`, { period })}</Hint>
      </div>
      {body}
    </div>
  );
}
