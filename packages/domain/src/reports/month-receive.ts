import type { Tyiyn } from '../common/money';
import type { YearMonth } from '../common/months';
import type { MonthPlanGroup, MonthPlanReport } from './month-plan';

/**
 * «Принять деньги» за месяц и за весь период во вкладке «Отчёты к сдаче» карточки контрагента
 * (доработки 14.11.2026, блок 5; прототип v110 `modules/report-months.js`: `rmRecvLeft`,
 * `rmRecvMonths`, `rmRecvPlan`, `rmRecvWhy`, и `inDlg` с `pre.list` в `modules/contractors.js`). Та же
 * форма поступления, что «Принять деньги» у отчёта, сразу со всеми отчётами месяцев с суммой: деньги
 * распределяются по отчётам от старых месяцев к новым, внутри месяца — по сроку оплаты; излишек
 * остаётся авансом контрагента. Месяцы и суммы — из правила «по месяцам» (`monthPlan`), своего
 * правила месяца нет. Суммы — целые тыйыны.
 */

/**
 * Сколько ещё принять по отчёту (прототип `rmRecvLeft`, как у «Принять деньги» отчёта): к уплате
 * минус большее из оплаченного в бюджет и уже полученного от контрагента под этот отчёт.
 */
export const receiveLeft = (amount: Tyiyn, paid: Tyiyn, received: Tyiyn): Tyiyn =>
  Math.max(0, amount - Math.max(paid, received));

/** Один месяц (`ГГГГ-ММ`) или весь период. */
export type MonthReceiveScope = YearMonth | 'all';

/**
 * Месяцы, за которые принимают деньги (прототип `rmRecvMonths`, `rmRecvOpen`): один месяц или все
 * месяцы с неоплаченным остатком. Будущие месяцы, где суммы ещё не рассчитаны и неоплаченного нет, в
 * период не входят и кнопку не запирают.
 */
export function receiveMonths<R extends MonthPlanReport>(
  groups: readonly MonthPlanGroup<R>[],
  scope: MonthReceiveScope,
): MonthPlanGroup<R>[] {
  return groups.filter((g) => (scope === 'all' || g.month === scope) && g.left > 0);
}

/** Строка распределения: отчёт и сколько под него принять. */
export type MonthReceiveLine<R extends MonthPlanReport = MonthPlanReport> = {
  report: R;
  amount: Tyiyn;
};

export type MonthReceivePlan<R extends MonthPlanReport = MonthPlanReport> = {
  /** От старых месяцев к новым, внутри месяца — по сроку оплаты. */
  lines: MonthReceiveLine<R>[];
  total: Tyiyn;
};

export type MonthReceiveOptions<R extends MonthPlanReport> = {
  /** Уже получено от контрагента под отчёт (без оплаченного в бюджет). */
  received: (r: R) => Tyiyn;
  /**
   * Порядок при равном сроке оплаты (прототип — по номеру отчёта); без него — как в плане месяца.
   */
  tie?: (a: R, b: R) => number;
};

/**
 * Распределение по отчётам (прототип `rmRecvPlan`): месяцы — как пришли (план идёт от старых к
 * новым), внутри месяца — отчёты с суммой по сроку оплаты (без срока оплаты — по сроку сдачи), под
 * каждый — сколько ещё принять; отчёты, по которым всё уже получено, не входят.
 */
export function monthReceivePlan<R extends MonthPlanReport>(
  groups: readonly MonthPlanGroup<R>[],
  options: MonthReceiveOptions<R>,
): MonthReceivePlan<R> {
  const lines: MonthReceiveLine<R>[] = [];
  for (const g of groups) {
    const due = (r: R) => r.payDue ?? r.dueDate;
    const items = g.items
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.pay && x.amount > 0)
      .sort(
        (a, b) =>
          (due(a.x.report) < due(b.x.report) ? -1 : due(a.x.report) > due(b.x.report) ? 1 : 0) ||
          (options.tie ? options.tie(a.x.report, b.x.report) : 0) ||
          a.i - b.i,
      );
    for (const { x } of items) {
      const amount = receiveLeft(x.amount, x.report.paid, options.received(x.report));
      if (amount > 0) lines.push({ report: x.report, amount });
    }
  }
  return { lines, total: lines.reduce((sum, x) => sum + x.amount, 0) };
}

/**
 * Почему принять нельзя (прототип `rmRecvWhy`): у отчёта месяца не указана сумма — за месяц
 * называются такие отчёты, за весь период — такие месяцы; или деньги на налоги уже получены.
 */
export type MonthReceiveRefusal<R extends MonthPlanReport = MonthPlanReport> =
  { code: 'no_amount'; months: YearMonth[]; reports: R[] } | { code: 'received' };

/**
 * Что показать кнопкой «Принять деньги» (прототип `rmRecvBtn`): `null` — кнопки нет (месяцев с
 * неоплаченным остатком нет); иначе месяцы, распределение и причина, почему кнопка заперта.
 */
export type MonthReceiveOffer<R extends MonthPlanReport = MonthPlanReport> = MonthReceivePlan<R> & {
  scope: MonthReceiveScope;
  months: YearMonth[];
  refusal: MonthReceiveRefusal<R> | null;
};

export function monthReceiveOffer<R extends MonthPlanReport>(
  groups: readonly MonthPlanGroup<R>[],
  scope: MonthReceiveScope,
  options: MonthReceiveOptions<R>,
): MonthReceiveOffer<R> | null {
  const open = receiveMonths(groups, scope);
  if (!open.length) return null;
  const plan = monthReceivePlan(open, options);
  const noAmount = open.filter((g) => g.noAmount > 0);
  const refusal: MonthReceiveRefusal<R> | null = noAmount.length
    ? {
        code: 'no_amount',
        months: noAmount.map((g) => g.month),
        reports: noAmount[0]!.items.filter((x) => x.noAmount).map((x) => x.report),
      }
    : plan.lines.length
      ? null
      : { code: 'received' };
  return { ...plan, scope, months: open.map((g) => g.month), refusal };
}

/**
 * Распределение заново после правки общей суммы (прототип `inDlg`, `reAlloc`): по строкам по порядку,
 * каждой — не больше её суммы; что не хватило, у строк пропадает; излишек остаётся авансом. Пустая или
 * отрицательная сумма — ничего не распределено.
 */
export function allocateInOrder<L extends { amount: Tyiyn }>(
  lines: readonly L[],
  total: Tyiyn | null,
): { line: L; amount: Tyiyn }[] {
  let left = total !== null && total > 0 ? total : 0;
  const out: { line: L; amount: Tyiyn }[] = [];
  for (const line of lines) {
    const amount = Math.min(left, line.amount);
    if (amount <= 0) continue;
    out.push({ line, amount });
    left -= amount;
  }
  return out;
}
