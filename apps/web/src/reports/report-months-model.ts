import {
  formatDateRu,
  formatSom,
  inMonthPlan,
  monthPlan,
  monthPlanQuick,
  type MonthPlanGroup,
  type MonthPlanQuick,
  type MonthPlanReport,
  type UiTextKey,
} from '@buhuchet/domain';
import type { IconName } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { prefCookie } from '../shell/prefs';

/*
 * «К сдаче и к оплате по месяцам» на экране (прототип v90 modules/report-months.js): тексты итога
 * месяца, план карточки контрагента и запомненный вид вкладки «Отчёты к сдаче». Само правило —
 * `packages/domain/src/reports/month-plan.ts`.
 */

/** «За октябрь 2026» (прототип `rmTitle`). */
export function monthTitle(t: Translate, month: string): string {
  return t('report.months.title', {
    month: t(`report.month.${Number(month.slice(5, 7))}` as UiTextKey).toLowerCase(),
    y: month.slice(0, 4),
  });
}

/** Итоги месяца, которых хватает строке итога: у группы плана и у ответа `month-summary`. */
export type MonthTotals = Pick<
  MonthPlanGroup,
  'late' | 'submitCount' | 'submitDone' | 'amount' | 'left' | 'noAmount' | 'from' | 'to'
>;

export interface MonthPill {
  key: 'late' | 'submitted' | 'amount' | 'no_amount';
  tone: 'bad' | 'ok' | 'info' | 'violet' | 'warn';
  icon: IconName;
  text: string;
  title?: string;
}

/**
 * Итог месяца одной строкой (прототип `rmSumHtml`): «просрочено N», «сдано N из M» (всё сдано —
 * зелёным), «к уплате … · осталось …» (при «Учёте оплаты налогов»; оплачено всё — зелёным), «без суммы N».
 */
export function monthPills(t: Translate, g: MonthTotals, taxpay: boolean): MonthPill[] {
  const out: MonthPill[] = [];
  if (g.late) {
    out.push({
      key: 'late',
      tone: 'bad',
      icon: 'alert',
      text: t('report.months.late', { n: g.late }),
    });
  }
  if (g.submitCount) {
    const all = g.submitDone === g.submitCount;
    out.push({
      key: 'submitted',
      tone: all ? 'ok' : 'info',
      icon: all ? 'check' : 'send',
      text: t('report.months.submitted', { done: g.submitDone, n: g.submitCount }),
    });
  }
  if (g.amount > 0) {
    const amount = formatSom(g.amount);
    out.push({
      key: 'amount',
      tone: taxpay && g.left === 0 ? 'ok' : 'violet',
      icon: 'coins',
      text: !taxpay
        ? t('report.months.to_pay', { amount })
        : g.left > 0
          ? t('report.months.to_pay_left', { amount, left: formatSom(g.left) })
          : t('report.months.to_pay_paid', { amount }),
    });
  }
  if (g.noAmount) {
    out.push({
      key: 'no_amount',
      tone: 'warn',
      icon: 'alert',
      text: t('report.months.no_amount', { n: g.noAmount }),
      title: t('report.months.no_amount_title'),
    });
  }
  return out;
}

/** «срок 20.11» или «сроки 20.11–25.11.2026» (прототип `rmSumHtml`); сроков нет — пусто. */
export function monthDueText(t: Translate, g: Pick<MonthTotals, 'from' | 'to'>): string {
  if (!g.from || !g.to) return '';
  const short = (d: string) => formatDateRu(d).slice(0, 5);
  return g.from === g.to
    ? t('report.months.due_one', { date: short(g.from) })
    : t('report.months.due_range', { from: short(g.from), to: formatDateRu(g.to) });
}

type PlanRow = MonthPlanReport & { type: { shortName: string } };

export interface ContractorPlan<R extends PlanRow> {
  /** Отчётов в плане нет совсем. */
  none: boolean;
  /** Числа плашек «Все / Сдать / Уплатить». */
  counts: Record<MonthPlanQuick, number>;
  /** Сколько месяцев закрыто и сколько осталось оплатить по всем месяцам. */
  closed: number;
  left: number;
  /** Месяцы на экране: при «Все» закрытые — только по галочке «Закрытые месяцы». */
  months: MonthPlanGroup<R>[];
}

/**
 * План вкладки «Отчёты к сдаче» карточки (прототип `rmCardHtml`): месяцы от старых к новым; «Сдать» и
 * «Уплатить» — только несделанное; при равном сроке — по краткому названию вида.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-1 — в прототипе при равном сроке порядок видов каталога, здесь — по краткому названию.
export function contractorPlan<R extends PlanRow>(
  rows: readonly R[],
  o: { taxpay: boolean; quick: MonthPlanQuick; showClosed: boolean },
): ContractorPlan<R> {
  const rs = rows.filter(inMonthPlan);
  const names = [...new Set(rs.map((r) => r.type.shortName))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const order = (r: R) => names.indexOf(r.type.shortName);
  const options = { taxpay: o.taxpay, order };
  const all = monthPlan(rs, options);
  const count = (q: MonthPlanQuick) => rs.filter((r) => monthPlanQuick(r, q)).length;
  const months =
    o.quick === 'all'
      ? all.filter((g) => o.showClosed || !g.done)
      : monthPlan(
          rs.filter((r) => monthPlanQuick(r, o.quick)),
          options,
        );
  return {
    none: rs.length === 0,
    counts: { all: count('all'), sub: count('sub'), pay: count('pay') },
    closed: all.filter((g) => g.done).length,
    left: all.reduce((a, g) => a + g.left, 0),
    months,
  };
}

/**
 * Выбор в «По месяцам» карточки контрагента (прототип `st.rq`, `st.rmAll`, `st.rmTg`): плашка «Все /
 * Сдать / Уплатить», «Закрытые месяцы» и раскрытые месяцы. Живёт, пока карточка открыта: смена вкладки
 * и вида его не сбрасывает.
 */
export type MonthsCardView = {
  quick: MonthPlanQuick;
  showClosed: boolean;
  toggled: Readonly<Record<string, boolean>>;
};

export const MONTHS_CARD_VIEW: MonthsCardView = { quick: 'all', showClosed: false, toggled: {} };

/** Вид вкладки «Отчёты к сдаче» карточки: «По месяцам» (по умолчанию) или «Списком». */
export type ReportsMode = 'months' | 'list';

/** Выбор вида запоминает браузер (прототип `store` `cp.repmode`): cookie, как остальной выбор на устройстве. */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-1 — вид запоминается в cookie, а не в хранилище браузера.
export const REPORTS_MODE_COOKIE = 'bh_repmode';

export function parseReportsMode(cookies: string): ReportsMode {
  const found = cookies
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REPORTS_MODE_COOKIE}=`));
  return found?.slice(REPORTS_MODE_COOKIE.length + 1) === 'list' ? 'list' : 'months';
}

export const reportsModeCookie = (mode: ReportsMode, secure: boolean): string =>
  prefCookie(REPORTS_MODE_COOKIE, mode, secure);
