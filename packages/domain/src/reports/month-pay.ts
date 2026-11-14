import { formatDateRu, type IsoDate } from '../common/dates';
import { formatSomWithUnit, type Tyiyn } from '../common/money';
import { monthLabel, type YearMonth } from '../common/months';
import type { MonthPlanGroup, MonthPlanOptions, MonthPlanReport } from './month-plan';

/**
 * «К оплате клиенту» за месяц отчёта (доработки 13.11.2026, задача К4; прототип v94
 * `modules/cp-telegram.js`: `rmToPay`, `rmPayList`, `rmPayText`). Один расчёт — для блока «К оплате
 * клиенту» под месяцем в карточке контрагента, текста «Скопировать для клиента» и сообщения «К оплате»
 * в Telegram. Месяц и строки — из правила «по месяцам» (`monthPlanGroup`), своего правила месяца нет.
 */

/** Налог к оплате: отчёт, остаток и срок оплаты (без срока оплаты — срок сдачи). */
export type MonthPayRow<R extends MonthPlanReport = MonthPlanReport> = {
  report: R;
  /** Остаток к оплате; без «Учёта оплаты налогов» — вся сумма. */
  left: Tyiyn;
  due: IsoDate;
};

export type MonthPay<R extends MonthPlanReport = MonthPlanReport> = {
  month: YearMonth;
  /** От ближайшего срока оплаты. */
  rows: MonthPayRow<R>[];
  total: Tyiyn;
  /** У скольких отчётов сумма ещё не указана: в расчёт и в сообщение они не входят. */
  noAmount: number;
  /** Ближайший срок оплаты; платить нечего — `null`. */
  due: IsoDate | null;
};

/**
 * Что клиенту оплатить за месяц (прототип `rmToPay`): налоги месяца с указанной суммой, у которых
 * остался неоплаченный остаток; без «Учёта оплаты налогов» оплата не отмечается — входит вся сумма.
 * `tie` — порядок при равном сроке (прототип — по номеру отчёта); без него — как в плане месяца.
 */
export function monthToPay<R extends MonthPlanReport>(
  group: MonthPlanGroup<R>,
  options: MonthPlanOptions & { tie?: (a: R, b: R) => number },
): MonthPay<R> {
  const rows = group.items
    .filter((x) => x.pay && x.amount > 0 && (!options.taxpay || x.left > 0))
    .map((x, i) => ({
      i,
      row: {
        report: x.report,
        left: options.taxpay ? x.left : x.amount,
        due: x.report.payDue ?? x.report.dueDate,
      },
    }))
    .sort(
      (a, b) =>
        (a.row.due < b.row.due ? -1 : a.row.due > b.row.due ? 1 : 0) ||
        (options.tie ? options.tie(a.row.report, b.row.report) : 0) ||
        a.i - b.i,
    )
    .map((x) => x.row);
  return {
    month: group.month,
    rows,
    total: rows.reduce((sum, x) => sum + x.left, 0),
    noAmount: group.noAmount,
    due: rows[0]?.due ?? null,
  };
}

/**
 * Почему текста для клиента нет (коды отказов «Скопировать для клиента»): платить нечего; реквизит
 * ответственного сотруднику не виден (docs/deviations.md п. В-1, В-25); часть отчётов месяца — вне
 * области сотрудника, итог был бы неполным.
 */
export const MONTH_PAY_MESSAGES = {
  month_pay_empty: 'За этот месяц клиенту платить нечего',
  month_pay_requisite_hidden:
    'Реквизиты ответственного видят только он сам, владелец и главный бухгалтер: текст для клиента составляет тот, кто их видит',
  month_pay_partial:
    'Часть отчётов этого месяца ведут другие сотрудники: текст для клиента составляет тот, кто видит все отчёты контрагента',
} as const;

/** Отказ составить текст, когда платить есть что. */
export const MONTH_PAY_REFUSALS = ['month_pay_requisite_hidden', 'month_pay_partial'] as const;
export type MonthPayRefusal = (typeof MONTH_PAY_REFUSALS)[number];

/** Строка налога для текста: короткое название вида, остаток и срок. */
export type MonthPayLine = { name: string; left: Tyiyn; due: IsoDate };

/** «НДС — 5 000 сом (до 25.11.2026), ЕН — 1 250,50 сом (до 20.11.2026)» (прототип `rmPayList`). */
export const monthPayList = (lines: readonly MonthPayLine[]): string =>
  lines
    .map((x) => `${x.name} — ${formatSomWithUnit(x.left)} (до ${formatDateRu(x.due)})`)
    .join(', ');

/** Шаблон «Скопировать для клиента», пока в справочнике платформы его нет (refDB.json, waPayMonth). */
export const PAY_MONTH_TEMPLATE =
  'Уважаемые {контрагент}! Налоги к оплате за {месяц}: {список}. Итого — {сумма}. Просим перечислить до {срок} на: {реквизиты}';

/**
 * Текст «Скопировать для клиента» (шаблон waPayMonth справочника платформы; прототип `rmPayText`):
 * {контрагент}, {месяц} — «октябрь 2026», {список} — налоги с остатками и сроками через запятую,
 * {сумма} — итог, {срок} — ближайший срок оплаты, {реквизиты} — реквизит для налогов или «—».
 */
export function monthPayText(
  template: string,
  values: {
    contractor: string;
    month: YearMonth;
    lines: readonly MonthPayLine[];
    total: Tyiyn;
    due: IsoDate;
    requisite: string | null;
  },
): string {
  const parts: Record<string, string> = {
    контрагент: values.contractor,
    месяц: monthLabel(values.month),
    список: monthPayList(values.lines),
    сумма: formatSomWithUnit(values.total),
    срок: formatDateRu(values.due),
    реквизиты: values.requisite || '—',
  };
  // Один проход: метка внутри подставленного значения (в названии контрагента) не заменяется, знаки
  // «$» в значении остаются как есть.
  return template.replace(/\{([а-яё]+)\}/gu, (mark, key: string) => parts[key] ?? mark);
}
