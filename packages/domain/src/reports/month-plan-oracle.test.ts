import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../common/dates';
import type { ReportAct, ReportPeriod } from '../platform-dicts/catalog';
import fixture from './__fixtures__/month-plan.json';
import { monthPlan, type MonthPlanGroup, type MonthPlanReport } from './month-plan';
import type { ReportStatus } from './rules';

// Сверка правила «к сдаче и к оплате по месяцам» с прототипом (modules/report-months.js: rmYm, rmItem,
// rmGroup, rmPlan) на отчётах demoDB.json и наборе с правками. Эталон пишет
// scripts/oracle-month-plan.mjs (скилл prototype-oracle); сроки и просрочку отчёта прототип считает сам —
// продукт получает их готовыми, как от расчёта сроков.

type Row = MonthPlanReport & { contractor: string; order: number };

const flag = (v: string) => v === '1';
const text = (v: string | number | boolean | null) =>
  v === null ? '' : v === true ? '1' : v === false ? '0' : String(v);
const line = (...values: (string | number | boolean | null)[]) => values.map(text).join('|');

/** Отчёты набора полями продукта; сроки и просрочка — из прогона прототипа. */
function reportsOf(reports: readonly string[], dues: readonly string[]): Row[] {
  const due = new Map(dues.map((d) => [d.split('|')[0]!, d.split('|')]));
  return reports.map((row) => {
    const [id, contractor, act, status, period, start, event, amount, paid, superseded, order] =
      row.split('|') as [
        string,
        string,
        ReportAct,
        ReportStatus,
        ReportPeriod,
        IsoDate,
        string,
        string,
        string,
        string,
        string,
      ];
    const [, dueDate, payDue, overdue, payOverdue] = due.get(id)!;
    return {
      id,
      contractor,
      act,
      status,
      period,
      periodStart: start,
      eventDate: event === '' ? null : (event as IsoDate),
      dueDate: dueDate as IsoDate,
      payDue: payDue === '' ? null : (payDue as IsoDate),
      amount: amount === '' ? null : Number(amount),
      paid: Number(paid),
      overdue: flag(overdue!),
      payOverdue: flag(payOverdue!),
      superseded: flag(superseded),
      order: Number(order),
    };
  });
}

/** План каждого контрагента — в порядке контрагентов набора, как в эталоне. */
function plansOf(rows: readonly Row[], taxpay: boolean): [string, MonthPlanGroup<Row>[]][] {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.contractor, [...(by.get(r.contractor) ?? []), r]);
  return [...by.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([cp, list]) => [
      cp,
      // При равном сроке — по месту вида в каталоге, потом по номеру отчёта (прототип rmGroup).
      monthPlan(
        [...list].sort((a, b) => Number(a.id) - Number(b.id)),
        { taxpay, order: (r) => r.order },
      ),
    ]);
}

describe('план по месяцам — ответы прототипа (rmPlan)', () => {
  for (const dataset of fixture.datasets) {
    for (const run of dataset.runs) {
      const name = `${dataset.name}, сегодня ${run.today}, учёт оплаты налогов ${run.taxpay ? 'включён' : 'выключен'}`;
      const plans = plansOf(reportsOf(dataset.reports, run.dues), run.taxpay);

      it(`${name}: строки плана — что сдать и уплатить, суммы и ближайший срок`, () => {
        const items = plans.flatMap(([, plan]) =>
          plan.flatMap((g) =>
            g.items.map((x) =>
              line(
                x.report.id,
                x.submit,
                x.pay,
                x.submitDone,
                x.payDone,
                x.noAmount,
                x.amount,
                x.paid,
                x.left,
                x.late,
                x.when,
              ),
            ),
          ),
        );
        expect(items).toEqual(run.items);
      });

      it(`${name}: месяцы — порядок отчётов и итоги`, () => {
        const groups = plans.flatMap(([cp, plan]) =>
          plan.map((g) =>
            line(
              cp,
              g.month,
              g.items.map((x) => x.report.id).join(','),
              g.submitCount,
              g.submitDone,
              g.payCount,
              g.payDone,
              g.noAmount,
              g.amount,
              g.paid,
              g.left,
              g.late,
              g.done,
              g.from,
              g.to,
            ),
          ),
        );
        expect(groups).toEqual(run.groups);
      });
    }
  }

  it('набор с правками проходит ветки, которых нет в демо-данных', () => {
    const rows = fixture.datasets[1]!.reports.map((r) => r.split('|'));
    expect(rows.some((r) => r[9] === '1')).toBe(true); // прежняя версия отчёта
    expect(rows.some((r) => r[6] !== '')).toBe(true); // отчёт по событию
    expect(rows.some((r) => r[7] === '0')).toBe(true); // нулевая сумма
    expect(rows.some((r) => r[7] !== '' && Number(r[8]) > Number(r[7]))).toBe(true); // переплата
  });
});
