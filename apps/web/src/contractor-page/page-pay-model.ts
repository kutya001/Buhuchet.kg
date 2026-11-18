import {
  bishkekDate,
  pageFeeDue,
  pageFeeLate,
  pageFeeOpen,
  pageTaxView,
  type PageTaxView,
  type PayClaimPurpose,
} from '@buhuchet/domain';
import type { PagePay, PublicPageBody } from '@buhuchet/shared';

/*
 * «Оплата» страницы контрагента простыми словами (доработки 17.11.2026; прототип v135 modules/cp-page.js
 * `pubBody`, cp-paid.js `pubPayPlan`): что нужно перевести, куда и из чего сумма — чистые функции над
 * ответом страницы. Это не онлайн-оплата: клиент переводит деньги в своём банке и отправляет чек.
 */

type Page = PublicPageBody;

/** Строка «Что нужно сделать» и «Оплаты»: сумма, просрочена ли, куда переводить, ждущий чек. */
export interface PayLine {
  /** Сколько перевести; 0 — платить не нужно. */
  due: number;
  late: boolean;
  /** Реквизит; null — раздел «Как оплатить» скрыт или реквизита нет. */
  account: PagePay | null;
  waiting: PagePay['waiting'];
}

/** Что видно в «Оплате» (прототип `M`, `due`, `aTax`, `aFee`, `fee`). */
export interface PayView {
  /** «Налоги»: расчёт — при показанных «Деньгах на налоги»; строка есть и с одним реквизитом. */
  tax: (PayLine & { money: PageTaxView | null }) | null;
  /** «Услуги бухгалтера» — при показанной «Оплате за обслуживание». */
  fee: PayLine | null;
}

export function payView(page: Page): PayView {
  const { today } = page;
  const aTax = page.pay?.tax ?? null;
  const money = page.money ? pageTaxView(page.money, today) : null;
  const tax =
    money || aTax
      ? {
          due: money?.due ?? 0,
          late: money?.late ?? false,
          account: aTax,
          waiting: aTax?.waiting ?? null,
          money,
        }
      : null;
  const aFee = page.fee ? (page.pay?.fee ?? null) : null;
  const fee = page.fee
    ? {
        due: Math.max(0, page.fee.debt),
        late: pageFeeLate(page.fee, today),
        account: aFee,
        waiting: aFee?.waiting ?? null,
      }
    : null;
  return { tax, fee };
}

/** Строка «Из чего сумма» окна «Оплатить». */
export interface PayPlanRow {
  id: string;
  /** Вид отчёта и период или месяц услуг бухгалтера (`month` — тогда подпись делает экран). */
  type: string | null;
  period: string | null;
  month: string | null;
  sum: number;
  /** Срок оплаты; null — не задан. */
  due: string | null;
}

/** План окна «Оплатить» (прототип `pubPayPlan`): сумма, месяц сообщения об оплате и из чего сумма. */
export interface PayPlan {
  purpose: PayClaimPurpose;
  sum: number;
  /** Месяц, который уйдёт в «Я оплатил»; null — без месяца. */
  month: string | null;
  /** Месяц в заголовке «Оплатить налоги за …»; null — без месяца. */
  titleMonth: string | null;
  rows: PayPlanRow[];
  /** «Налоги до … — X, ваши деньги у нас — Y»: срок и две суммы; null — строки нет. */
  calc: { until: string; need: number; ours: number } | null;
}

/**
 * Что перевести (прототип `pubPayPlan`): услуги бухгалтера — долг и месяцы с остатком (месяц сообщения —
 * самый старый); налоги с месяцем — остаток месяца из «Отчёты» → «По месяцам»; налоги без месяца —
 * «Не хватает» и отчёты со сроком оплаты до конца месяца.
 */
export function payPlan(page: Page, purpose: PayClaimPurpose, month: string | null): PayPlan {
  if (purpose === 'fee') {
    const fee = page.fee;
    const open = fee ? pageFeeOpen(fee.months) : [];
    return {
      purpose,
      sum: fee && fee.debt > 0 ? fee.debt : 0,
      month: open[0]?.month ?? null,
      titleMonth: null,
      rows: open.map((m) => ({
        id: m.month,
        type: null,
        period: null,
        month: m.month,
        sum: m.charge - m.got,
        due: fee ? pageFeeDue(m.month, fee.feeDay) : null,
      })),
      calc: null,
    };
  }
  if (month) {
    const p = page.reports?.months?.find((m) => m.month === month);
    const types = new Map((page.reports?.types ?? []).map((x) => [x.code, x.short]));
    return {
      purpose,
      sum: p && p.left > 0 ? p.left : 0,
      month,
      titleMonth: month,
      rows: (p?.rows ?? []).map((r) => ({
        id: r.id,
        type: types.get(r.type) ?? r.type,
        period: r.period,
        month: null,
        sum: r.left,
        due: r.payDue,
      })),
      calc: null,
    };
  }
  const M = page.money;
  const v = M ? pageTaxView(M, page.today) : null;
  return {
    purpose,
    sum: v?.due ?? 0,
    month: null,
    titleMonth: null,
    rows: (M?.due ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      period: r.period,
      month: null,
      sum: r.left,
      due: r.payDue,
    })),
    calc: M && v ? { until: M.monthEnd, need: M.dueSum, ours: v.ours } : null,
  };
}

/** Сумма и месяц «Я оплатил» по умолчанию (прототип `pubPaidDlg`, `reset`). */
export function paidDefaults(
  page: Page,
  purpose: PayClaimPurpose,
  month: string | null,
): { month: string | null; sum: number } {
  const plan = payPlan(page, purpose, purpose === 'tax' ? month : null);
  return { month: plan.month, sum: plan.sum };
}

/** День отправки чека по Бишкеку — для «Чек отправлен 17 ноября». */
export const waitingDay = (w: NonNullable<PagePay['waiting']>) => bishkekDate(new Date(w.at));
