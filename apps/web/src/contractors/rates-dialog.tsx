'use client';

import {
  dueRuleText,
  formatSom,
  isSingleTaxType,
  parseSom,
  type ReportPeriod,
  type UiTextKey,
} from '@buhuchet/domain';
import type { Assignment, Contractor, ReportType } from '@buhuchet/shared';
import { Box, buttonClass, Hint, inputClass, MiniTable, Modal, Note, useToast } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery, valueDictsQuery } from '../dicts/dicts-data';
import { useErrorText, useT } from '../l10n/provider';
import { useContractorsRefresh } from './contractor-data';
import { RateRows, singleTaxDefaults, type RateState, type SingleTaxContext } from './rate-rows';
import { reportPickQuery } from './report-pick-data';

/** Своя периодичность и срок назначения (прототип intRows: per, day, mo). */
interface OwnRule {
  period: ReportPeriod;
  day: number;
  month: number;
}

const PERIODS: readonly ReportPeriod[] = ['M', 'Q', 'H', 'Y'];
const SMALL = 'min-h-[30px] w-auto cursor-pointer px-2 py-[3px]';

/** Месяц срока по умолчанию при смене периодичности (прототип bindInt: год — апрель, иначе — 1-й после). */
const monthFor = (period: ReportPeriod) => (period === 'Y' ? 4 : 1);

function ownOf(a: Assignment, type: ReportType): OwnRule {
  const period = a.ownPeriod ?? type.period;
  return {
    period,
    day: a.ownDay ?? type.dueDay,
    month: a.ownMonth ?? (period === 'Y' ? (type.dueMonth ?? 4) : (type.dueAfter ?? 1)),
  };
}

const ownSame = (a: OwnRule, b: OwnRule) =>
  a.period === b.period && a.day === b.day && a.month === b.month;

/** Ставки назначений как в форме: обычные, строки ЕН и добавленные строки налога с продаж. */
function ratesOf(list: readonly Assignment[]): RateState {
  return {
    rates: Object.fromEntries(list.filter((a) => a.rate).map((a) => [a.reportTypeCode, a.rate!])),
    en: Object.fromEntries(
      list
        .filter((a) => isSingleTaxType(a.reportTypeCode))
        .map((a) => [a.reportTypeCode, a.enRates.map((e) => ({ ...e }))]),
    ),
    adds: Object.fromEntries(list.map((a) => [a.reportTypeCode, [...a.rateAdditions]])),
    // Сохранённые строки ЕН — выбор пользователя: по ГКЭД заново не подставляются.
    manual: list.filter((a) => isSingleTaxType(a.reportTypeCode)).map((a) => a.reportTypeCode),
  };
}

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * «Ставки» в блоке «Сдаёт отчёты» карточки (ТЗ «Подбор отчётов → Где открывается»: «окно «Ставки и
 * сроки отчётов» (ставка, повторяющаяся сумма, срок) без выбора видов»; прототип modules/contractors.js,
 * assignDlg): ставки и повторяющиеся суммы назначенных видов и, у видов с периодичностью в назначении,
 * своя периодичность и срок. Виды не выбираются — это «Подбор отчётов». Сохраняется каждое изменённое
 * назначение (`PATCH /api/assignments/{id}` с версией записи).
 */
export function RatesDialog({
  contractor: c,
  assignments,
  open,
  onClose,
}: {
  contractor: Contractor;
  assignments: readonly Assignment[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const refresh = useContractorsRefresh();
  const catalog = useQuery(catalogQuery).data;
  const dicts = useQuery(valueDictsQuery).data;
  const ctx = useQuery(reportPickQuery({ contractorId: c.id })).data;
  const [rates, setRates] = useState<RateState>(() => ratesOf(assignments));
  const [fixed, setFixed] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      assignments.map((a) => [
        a.reportTypeCode,
        a.fixedAmount === null ? '' : formatSom(a.fixedAmount),
      ]),
    ),
  );
  const [own, setOwn] = useState<Record<string, OwnRule>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const type = (code: string) => catalog?.type(code);
  const codes = assignments.map((a) => a.reportTypeCode);
  const office = dicts?.offices.find((o) => o.code === c.taxOffice?.code);
  const cx: SingleTaxContext | null =
    ctx && dicts
      ? {
          rates: dicts.rates,
          index: new Map(ctx.gkedIndex.map((n) => [n.code, n])),
          subject: {
            gked: c.gked?.code ?? null,
            gkedExtra: c.gkedExtra.map((g) => g.code),
            benefits: c.benefits.map((b) => b.code),
            place: [office?.region ?? '', (c.registration.address ?? '').trim()]
              .filter(Boolean)
              .join(' '),
          },
          today: ctx.today,
        }
      : null;
  const withRates = codes.filter((code) => (type(code)?.rates.length ?? 0) > 0);
  const withSum = assignments.filter((a) => a.act !== 'sub');
  const periodic = assignments.filter((a) => a.periodInAssignment && type(a.reportTypeCode));
  const ownNow = (a: Assignment) => own[a.id] ?? ownOf(a, type(a.reportTypeCode)!);

  /** Изменённые поля назначения; ошибка суммы — строкой. */
  const patchOf = (a: Assignment): Record<string, unknown> | string => {
    const code = a.reportTypeCode;
    const out: Record<string, unknown> = {};
    if (isSingleTaxType(code)) {
      const rows = (rates.en[code] ?? []).map((e) => ({ code: e.code, variant: e.variant }));
      if (rows.length && !sameList(rows, a.enRates)) out.enRates = rows;
    } else if ((type(code)?.rates.length ?? 0) > 0) {
      const rate = rates.rates[code] ?? a.rate;
      if (rate !== a.rate) out.rate = rate;
      const adds = [...(rates.adds[code] ?? [])];
      if (!sameList(adds, a.rateAdditions)) out.rateAdditions = adds;
    }
    if (a.act !== 'sub') {
      const text = (fixed[code] ?? '').trim();
      const amount = text ? parseSom(text) : null;
      if (text && amount === null) return t('cp.rates.bad_sum', { name: a.reportTypeShort });
      if (amount !== a.fixedAmount) out.fixedAmount = amount;
    }
    const tp = type(code);
    if (a.periodInAssignment && tp && own[a.id] && !ownSame(own[a.id]!, ownOf(a, tp))) {
      const o = own[a.id]!;
      Object.assign(out, { ownPeriod: o.period, ownDay: o.day, ownMonth: o.month });
    }
    return out;
  };

  const plan = assignments.map((a) => ({ a, patch: patchOf(a) }));
  const dirty = plan.some((p) => typeof p.patch === 'string' || Object.keys(p.patch).length > 0);

  const save = async () => {
    const bad = plan.find((p) => typeof p.patch === 'string');
    if (bad) return setError(bad.patch as string);
    const changed = plan.filter((p) => Object.keys(p.patch).length > 0);
    if (!changed.length) {
      onClose();
      return toast(t('cp.asg.unchanged'), { icon: 'info' });
    }
    setBusy(true);
    setError(null);
    for (const { a, patch } of changed) {
      const res = await callApi(() =>
        api.api.assignments[':id'].$patch({
          param: { id: a.id },
          json: { ...(patch as Record<string, never>), version: a.version },
        }),
      );
      if (!res.ok) {
        setBusy(false);
        refresh();
        return setError(`${a.reportTypeShort}: ${errorText(res.error)}`);
      }
    }
    setBusy(false);
    refresh();
    onClose();
    toast(t('cp.rates.saved', { names: changed.map((p) => p.a.reportTypeShort).join(', ') }), {
      icon: 'check',
    });
  };

  const monthOptions = (period: ReportPeriod) =>
    period === 'Y'
      ? Array.from({ length: 12 }, (_, i) => ({
          value: i + 1,
          label: t('cp.rates.month_next_year', {
            month: t(`rule.month_gen.${i + 1}` as UiTextKey),
          }),
        }))
      : [0, 1, 2, 3].map((n) => ({ value: n, label: t(`cp.rates.after.${n}` as UiTextKey) }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="mid"
      title={t('cp.rates.title')}
      sub={[c.name, c.regime?.name ?? t('cp.rates.no_regime'), c.form.name].join(' · ')}
      dirty={dirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('btn.cancel')}
          </button>
          <button
            type="button"
            data-rates-ok=""
            className={buttonClass('cta')}
            disabled={busy || !catalog}
            onClick={() => void save()}
          >
            {t('btn.save')}
          </button>
        </>
      }
    >
      <Hint>{t('cp.rates.hint')}</Hint>
      {error ? (
        <Note tone="bad" alert>
          {error}
        </Note>
      ) : null}
      {catalog && (withRates.length || withSum.length) ? (
        <Box title={t('cp.rates.box_rates')}>
          {withRates.length && cx ? (
            <RateRows
              codes={withRates}
              types={catalog.type}
              state={rates}
              defaults={singleTaxDefaults(cx)}
              cx={cx}
              onChange={setRates}
            />
          ) : null}
          {withSum.length ? (
            <MiniTable
              label={t('cp.rates.col.fixed')}
              empty=""
              columns={[
                { key: 'type', label: t('cp.card.asg.col.type') },
                { key: 'fixed', label: t('cp.rates.col.fixed'), numeric: true },
              ]}
              rows={withSum.map((a) => ({
                key: a.id,
                cells: {
                  type: <b>{a.reportTypeShort}</b>,
                  fixed: (
                    <input
                      className={`${inputClass({ full: false })} ml-auto max-w-[120px] text-right tabular-nums ${SMALL}`}
                      data-rates-fixed={a.reportTypeCode}
                      inputMode="decimal"
                      placeholder={t('cp.rates.none')}
                      aria-label={t('cp.rates.fixed_of', { name: a.reportTypeShort })}
                      value={fixed[a.reportTypeCode] ?? ''}
                      onChange={(e) => {
                        setError(null);
                        setFixed((f) => ({ ...f, [a.reportTypeCode]: e.target.value }));
                      }}
                    />
                  ),
                },
              }))}
            />
          ) : null}
          <Hint>{t('cp.rates.fixed_hint')}</Hint>
        </Box>
      ) : null}
      {catalog && periodic.length ? (
        <Box title={t('cp.rates.box_period')}>
          <Hint>{t('cp.rates.period_hint')}</Hint>
          <MiniTable
            label={t('cp.rates.box_period')}
            empty=""
            columns={[
              { key: 'type', label: t('cp.card.asg.col.type') },
              { key: 'period', label: t('cp.rates.col.period') },
              { key: 'day', label: t('cp.rates.col.day') },
              { key: 'month', label: t('cp.rates.col.month') },
              { key: 'result', label: t('cp.rates.col.result') },
            ]}
            rows={periodic.map((a) => {
              const tp = type(a.reportTypeCode)!;
              const o = ownNow(a);
              const set = (next: Partial<OwnRule>) =>
                setOwn((x) => ({ ...x, [a.id]: { ...o, ...next } }));
              const year = o.period === 'Y';
              return {
                key: a.id,
                cells: {
                  type: <b>{a.reportTypeShort}</b>,
                  period: (
                    <select
                      className={`${inputClass({ full: false })} ${SMALL}`}
                      aria-label={t('cp.rates.col.period')}
                      data-rates-period={a.reportTypeCode}
                      value={o.period}
                      onChange={(e) => {
                        const period = e.target.value as ReportPeriod;
                        set({ period, month: monthFor(period) });
                      }}
                    >
                      {PERIODS.map((p) => (
                        <option key={p} value={p}>
                          {t(`report.period.${p.toLowerCase()}` as UiTextKey)}
                        </option>
                      ))}
                    </select>
                  ),
                  day: (
                    <input
                      className={`${inputClass({ full: false })} w-16 tabular-nums ${SMALL}`}
                      aria-label={t('cp.rates.col.day')}
                      inputMode="numeric"
                      value={o.day}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        if (n >= 1 && n <= 31) set({ day: n });
                      }}
                    />
                  ),
                  month: (
                    <select
                      className={`${inputClass({ full: false })} ${SMALL}`}
                      aria-label={t('cp.rates.col.month')}
                      value={o.month}
                      onChange={(e) => set({ month: Number(e.target.value) })}
                    >
                      {monthOptions(o.period).map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  ),
                  result: (
                    <span className="text-muted">
                      {dueRuleText(
                        {
                          ...tp,
                          period: o.period,
                          dueDay: o.day,
                          dueAfter: year ? 0 : o.month,
                          dueMonth: year ? o.month : tp.dueMonth,
                        },
                        t,
                      )}
                    </span>
                  ),
                },
              };
            })}
          />
          <Hint>{t('cp.rates.period_after')}</Hint>
        </Box>
      ) : null}
      {catalog && !withRates.length && !withSum.length && !periodic.length ? (
        <span className="text-faint">{t('cp.rates.nothing')}</span>
      ) : null}
    </Modal>
  );
}
