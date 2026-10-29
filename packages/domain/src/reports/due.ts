import { addDays, type IsoDate } from '../common/dates';
import type { PayRule } from '../dicts/report-types';
import type { ReportKind, ReportPeriod } from '../platform-dicts/catalog';
import { nextWorkingDay, type ProductionCalendar } from '../platform-dicts/calendar';
import {
  dateOf,
  periodEnd,
  periodMonths,
  periodStartOf,
  periodWindow,
  type PeriodRef,
} from './periods';

/*
 * Сроки сдачи и оплаты отчёта (ТЗ «Отчеты для сдачи» → «Срок сдачи и срок оплаты считаются по правилам
 * справочника», «Вариант срока» в назначении; «Налоговые льготы и особые статусы» → «Меняет сроки»;
 * «Производственный календарь КР»; прототип core/reference.js: ruleDate, dueOf, payDueOf, tOv, tEff;
 * modules/contractors.js: assignTypes). Ответы сверены с прототипом: scripts/oracle-due.mjs.
 */

/** Правило сроков вида отчёта (поля `report_types`). */
export interface ReportTypeRule extends PayRule {
  code: string;
  kind: ReportKind;
  shiftToWorkday: boolean;
  skipQuarters: readonly number[];
  periodPerAssignment: boolean;
}

/** «Меняет сроки» у статуса контрагента (`tax_benefit_due_rules`): пусто — как у вида. */
export interface StatusDueRule {
  benefitCode: string;
  dueDay: number | null;
  dueAfter: number | null;
  dueMonth: number | null;
  payDay: number | null;
  payAfter: number | null;
}

/**
 * Срок в назначении: «Вариант срока» (`dueDay`: «до N-го числа», 31 — последний день; пусто — как в
 * каталоге) или, у видов с периодичностью в назначении, своя периодичность и срок: `ownPeriod`,
 * `ownDay`, `ownMonth` — месяц после конца периода, у годовых — месяц срока следующего года.
 */
export interface AssignmentDue {
  dueDay: number | null;
  ownPeriod: ReportPeriod | null;
  ownDay: number | null;
  ownMonth: number | null;
}

/** Правило, по которому считаются сроки отчёта; `benefitCode` — статус, давший срок. */
export interface EffectiveRule extends ReportTypeRule {
  benefitCode: string | null;
}

/** Периодичность и срок задаются в назначении: внутренняя отчётность и виды с этой отметкой. */
export const periodInAssignment = (rule: Pick<ReportTypeRule, 'kind' | 'periodPerAssignment'>) =>
  rule.kind === 'internal' || rule.periodPerAssignment;

/** Варианты срока в назначении (прототип asgDlg): «до 10-го» … «до 25-го» и «до последнего дня». */
// ОТКЛОНЕНИЕ: docs/deviations.md#А-4
export const ASSIGNMENT_DUE_DAYS = [10, 15, 20, 25, 31] as const;

/**
 * Правило сроков отчёта контрагента (прототип tEff ∘ tOv): у статуса со своим сроком — его срок; у
 * назначения с «Вариантом срока» — число из назначения (оно важнее статуса, срок оплаты статуса
 * остаётся); у вида с периодичностью в назначении — периодичность и срок назначения.
 */
export function effectiveRule(
  type: ReportTypeRule,
  assignment: AssignmentDue | null,
  benefit: StatusDueRule | null,
): EffectiveRule {
  let rule: EffectiveRule = { ...type, benefitCode: null };
  if (benefit) {
    rule = {
      ...rule,
      dueDay: benefit.dueDay ?? type.dueDay,
      dueAfter: benefit.dueAfter ?? type.dueAfter,
      dueMonth: benefit.dueMonth ?? type.dueMonth,
      ...(benefit.payDay !== null
        ? { payDay: benefit.payDay, payAfter: benefit.payAfter ?? type.dueAfter, payMonth: null }
        : {}),
      benefitCode: benefit.benefitCode,
    };
  }
  if (!assignment) return rule;
  if (!periodInAssignment(type)) {
    return assignment.dueDay !== null
      ? { ...rule, dueDay: assignment.dueDay, benefitCode: null }
      : rule;
  }
  if (!assignment.ownPeriod) return rule;
  const year = assignment.ownPeriod === 'Y';
  return {
    ...rule,
    period: assignment.ownPeriod,
    dueDay: assignment.ownDay ?? rule.dueDay,
    dueAfter: year ? 0 : assignment.ownMonth,
    dueMonth: year ? assignment.ownMonth : rule.dueMonth,
  };
}

/**
 * Дата по правилу (прототип ruleDate): `dueDay`-е число (31 и больше дней месяца — последний день)
 * `dueAfter`-го месяца после конца периода (`dueFrom` = start — от его начала); у годовых — месяца
 * `dueMonth` следующего года (от начала — того же).
 */
function ruleDate(
  rule: Pick<PayRule, 'dueDay' | 'dueAfter' | 'dueMonth' | 'dueFrom'>,
  ref: PeriodRef,
): IsoDate {
  const fromStart = rule.dueFrom === 'start';
  const year = Number(ref.start.slice(0, 4));
  if (ref.period === 'Y')
    return dateOf(year + (fromStart ? 0 : 1), rule.dueMonth ?? 1, rule.dueDay);
  const { first, last } = periodMonths(ref);
  return dateOf(year, (fromStart ? first : last) + (rule.dueAfter ?? 0), rule.dueDay);
}

/** Сроки отчёта: по закону (`base`), сдачи после переноса с нерабочего дня (`due`) и оплаты. */
export interface ReportDue {
  base: IsoDate;
  due: IsoDate;
  /** Срок оплаты; у вида «Сдача» — пусто. */
  payDue: IsoDate | null;
}

/**
 * Сроки отчёта за период (прототип dueOf, payDueOf): у разового — дней от даты события; срок на
 * нерабочем дне переносится на следующий рабочий по календарю, если так у вида. Срок оплаты — своё
 * правило вида или статуса, иначе как срок сдачи.
 */
export function reportDue(
  rule: EffectiveRule,
  ref: PeriodRef,
  calendar: ProductionCalendar,
): ReportDue {
  const shift = (date: IsoDate) => (rule.shiftToWorkday ? nextWorkingDay(calendar, date) : date);
  const base = ref.event ? addDays(ref.event, rule.dueDay) : ruleDate(rule, ref);
  const due = shift(base);
  if (rule.act === 'sub') return { base, due, payDue: null };
  if (rule.payDay === null || ref.event) return { base, due, payDue: due };
  const payDue = shift(
    ruleDate(
      {
        dueDay: rule.payDay,
        dueAfter: rule.payAfter ?? rule.dueAfter,
        dueMonth: rule.payMonth ?? rule.dueMonth,
        dueFrom: rule.dueFrom,
      },
      ref,
    ),
  );
  return { base, due, payDue };
}

// ОТКЛОНЕНИЕ: docs/deviations.md#А-3
/**
 * Периоды, за которые по назначению должен быть отчёт сегодня (прототип assignTypes): у месячных —
 * текущий месяц и следующий, у остальных — периоды окна, срок которых ещё не прошёл. Отчёты за периоды
 * раньше «с какого периода» и позже «до какого» не создаются. Разовые виды по периодам не создаются.
 */
export function periodsDue(
  rule: EffectiveRule,
  window: { today: IsoDate; from: IsoDate | null; until: IsoDate | null },
  calendar: ProductionCalendar,
): IsoDate[] {
  if (rule.oneOff) return [];
  const { today, from, until } = window;
  const month = periodStartOf('M', today);
  return periodWindow(rule.period, today, rule.skipQuarters).filter((start) => {
    const ref = { period: rule.period, start };
    if (from && periodEnd(ref) < from) return false;
    if (until && start > until) return false;
    return rule.period === 'M' ? start >= month : reportDue(rule, ref, calendar).due >= today;
  });
}

/**
 * «С какого периода» нового назначения по умолчанию: первый период, за который сегодня должен быть
 * отчёт (у квартального 18.10 — III квартал, срок которого 25.10 ещё впереди), иначе текущий период.
 */
export function defaultAssignmentFrom(
  rule: EffectiveRule,
  today: IsoDate,
  calendar: ProductionCalendar,
): IsoDate {
  return (
    periodsDue(rule, { today, from: null, until: null }, calendar)[0] ??
    periodStartOf(rule.period, today)
  );
}
