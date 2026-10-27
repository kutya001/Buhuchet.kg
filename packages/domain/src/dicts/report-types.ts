import { pluralForm } from '../common/list';
import type { Translate, UiTextKey } from '../l10n/texts';
import {
  LAST_DAY_OF_MONTH,
  type DueFrom,
  type ReportAct,
  type ReportPeriod,
} from '../platform-dicts/catalog';

/*
 * Модуль «Справочники» → «Виды отчётов» (ТЗ «Справочники»; прототип core/reference.js, modules/dicts.js):
 * как вид отчёта из каталога платформы показывается организации — срок сдачи и оплаты словами,
 * периодичность, «Что сделать» и «Что уплачивается». Тексты — из словаря: функция получает `t`.
 */

/** Правило срока сдачи вида отчёта (поля `report_types`). */
export interface DueRule {
  period: ReportPeriod;
  dueDay: number;
  dueAfter: number | null;
  dueMonth: number | null;
  dueFrom: DueFrom;
  oneOff: boolean;
  act: ReportAct;
}

/** Правило срока оплаты: своё (`payDay`…), график платежей или «как срок сдачи». */
export interface PayRule extends DueRule {
  payDay: number | null;
  payAfter: number | null;
  payMonth: number | null;
  paySchedule: readonly (readonly [number, number])[] | null;
}

const PERIOD_GENITIVE = {
  M: 'rule.period_gen.m',
  Q: 'rule.period_gen.q',
  H: 'rule.period_gen.h',
} as const satisfies Record<Exclude<ReportPeriod, 'Y'>, UiTextKey>;

const monthGenitive = (month: number): UiTextKey => `rule.month_gen.${month}` as UiTextKey;

/** «20-го числа» или «последнего дня» (день 31 и больше — последний день месяца). */
function dayText(day: number, t: Translate): string {
  return day >= LAST_DAY_OF_MONTH ? t('rule.last_day') : t('rule.day_n', { day });
}

/**
 * Срок сдачи словами, как в прототипе (`ruleText`): «до 20-го числа месяца после отчётного», «до 31
 * марта следующего года», «в течение 10 дней после события». У вида «Уплата» с оплатой в том же месяце —
 * «оплата до …».
 */
export function dueRuleText(rule: DueRule, t: Translate): string {
  const { dueDay: day } = rule;
  if (rule.oneOff) return t(`rule.after_event.${pluralForm(day)}`, { n: day });
  const dd = dayText(day, t);
  // У годовых «месяца после» нет (срок — месяц и число), поэтому «оплата до …» — только при нуле.
  if (rule.act === 'pay' && rule.dueAfter === 0) return t('rule.pay_same_month', { dd });
  if (rule.period === 'Y') {
    return t('rule.year', {
      day,
      month: t(monthGenitive(rule.dueMonth ?? 1)),
      which: t(rule.dueFrom === 'start' ? 'rule.year.same' : 'rule.year.next'),
    });
  }
  const after = rule.dueAfter ?? 0;
  if (rule.dueFrom === 'start' && rule.period !== 'M') {
    const of = t(PERIOD_GENITIVE[rule.period]);
    return after === 0
      ? t('rule.start_first_month', { dd, of })
      : t('rule.start_nth_month', { dd, n: after + 1, of });
  }
  if (after === 0) return t('rule.same_month', { dd });
  if (after === 1) {
    const of = rule.period === 'M' ? t('rule.reporting') : t(PERIOD_GENITIVE[rule.period]);
    return t('rule.month_after', { dd, of });
  }
  return t('rule.nth_month_after', { dd, n: after, of: t(PERIOD_GENITIVE[rule.period]) });
}

/** «15.04; 15.07» — даты графика платежей: [месяц, число]. */
function scheduleText(schedule: readonly (readonly [number, number])[]): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return schedule.map(([month, day]) => `${two(day)}.${two(month)}`).join('; ');
}

/**
 * Срок оплаты словами (прототип `payRuleText`): график платежей («4 платежа: до 15.04; …»), своё
 * правило оплаты тем же языком, что срок сдачи, или «как срок сдачи».
 */
export function payRuleText(rule: PayRule, t: Translate): string {
  const schedule = rule.paySchedule ?? [];
  if (schedule.length) {
    return t(`rule.installments.${pluralForm(schedule.length)}`, {
      n: schedule.length,
      dates: scheduleText(schedule),
    });
  }
  if (rule.payDay === null) return t('rule.pay_as_due');
  return dueRuleText(
    {
      ...rule,
      dueDay: rule.payDay,
      dueAfter: rule.payAfter ?? rule.dueAfter,
      dueMonth: rule.payMonth ?? rule.dueMonth,
      // Срок оплаты пишется как срок сдачи, без «оплата до …» (прототип: payOnly: false).
      act: 'both',
    },
    t,
  );
}

/** Платёж вида отчёта для «Что уплачивается»: название и орган-получатель (название органа). */
export interface PaymentText {
  name: string;
  authority: string;
}

/**
 * «Что уплачивается» (прототип `paysTxt`): платежи через «; », орган в скобках — если платежей
 * несколько или получатель не тот орган, куда сдают отчёт.
 */
export function paysText(payments: readonly PaymentText[], authority: string): string {
  return payments
    .map((p) =>
      p.authority && (payments.length > 1 || p.authority !== authority)
        ? `${p.name} (${p.authority})`
        : p.name,
    )
    .join('; ');
}
