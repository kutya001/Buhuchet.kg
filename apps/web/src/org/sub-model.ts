import {
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  pluralForm,
  SUBSCRIPTION_MB_BYTES,
  subscriptionCalc,
  subscriptionDiscounted,
  subscriptionMemLimitMb,
  subscriptionMinSeats,
  subscriptionPaidUntilAfter,
  subscriptionPayProblem,
  type IsoDate,
  type SubscriptionCalc,
  type SubscriptionCalcLine,
  type SubscriptionStatus,
  type UiTextKey,
} from '@buhuchet/domain';
import type {
  OrgSubscriptionView,
  SubscriptionPayChoice,
  SubscriptionPayment,
} from '@buhuchet/shared';
import type { IconName } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/*
 * Правила экрана «Подписка» и окна оплаты без React (доработки 20.11.2026, блок 5; прототип v154
 * `modules/org-sub.js`, `core/subs.js`; этап 1, П7, поток И): подписи по словарю, расчёт и проверка
 * окна — те же правила домена, что у сервера (`subscriptionCalc`, `subscriptionPayProblem`); сумму
 * заявки всё равно считает сервер.
 */

export type SubView = OrgSubscriptionView;
export type SubPay = SubscriptionPayment;
export type PayMode = 'renew' | 'grow' | 'mem';
export type PillTone = 'plain' | 'ok' | 'bad' | 'caution' | 'info';

/** ГБ из МБ одним знаком после запятой (прототип `subGb`): 2 000 МБ → «2», 1 450 МБ → «1,5». */
export const gbText = (mb: number): string =>
  (Math.round(mb / 100) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export const bytesMb = (bytes: number): number => bytes / SUBSCRIPTION_MB_BYTES;

/** Цвет и значок статуса подписки (прототип `SUB_PILL`). */
export const SUB_STATUS_PILL: Record<SubscriptionStatus, { tone: PillTone; icon: IconName }> = {
  active: { tone: 'ok', icon: 'check' },
  expiring: { tone: 'caution', icon: 'clock' },
  pending: { tone: 'info', icon: 'clock' },
  overdue: { tone: 'bad', icon: 'alert' },
  none: { tone: 'plain', icon: 'ban' },
  demo: { tone: 'plain', icon: 'info' },
};

/** Цвет и значок статуса оплаты (прототип `SUB_PAY_PILL`). */
export const SUB_PAY_PILL: Record<SubPay['status'], { tone: PillTone; icon: IconName }> = {
  pending: { tone: 'info', icon: 'clock' },
  confirmed: { tone: 'ok', icon: 'check' },
  rejected: { tone: 'bad', icon: 'ban' },
};

export const subDays = (t: Translate, n: number): string => t(`sub.days.${pluralForm(n)}`, { n });

export const whatText = (t: Translate, kind: SubPay['kind']): string => t(`sub.what.${kind}`);

/** «Срок» строки «Истории оплат» (прототип `subPayTermOwn`). */
export function termText(t: Translate, p: Pick<SubPay, 'kind' | 'months' | 'paidUntil'>): string {
  if (p.kind === 'free')
    return p.paidUntil ? t('sub.term.until', { date: formatDateRu(p.paidUntil) }) : '—';
  return p.months ? t('sub.term.months', { n: p.months }) : '—';
}

/** Название подписки (прототип `subKindLabel`). */
export function kindLabel(t: Translate, sub: SubView['sub']): string {
  if (!sub) return t('sub.kind.none');
  if (sub.free) return t('sub.kind.free', { date: formatDateRu(sub.paidUntil) });
  return sub.planName;
}

/** Строка расчёта словами (прототип `subCalc` → `lines[].label`). */
export function lineText(t: Translate, line: SubscriptionCalcLine): string {
  const price = line.price === undefined ? '' : formatSom(line.price);
  const params = { n: line.n ?? 0, price, months: line.months ?? 0, pct: line.pct ?? 0 };
  return t(`sub.line.${line.k}`, params);
}

/** Кто отправил (прототип `subWho`): бесплатный период — «Система», без сотрудника — администратор. */
export function whoText(t: Translate, p: Pick<SubPay, 'kind' | 'by'>): string {
  if (p.by) return p.by;
  return t(p.kind === 'free' ? 'sub.by.system' : 'sub.by.admin');
}

export const pendingOf = (view: SubView): SubPay | null =>
  view.payments.find((p) => p.status === 'pending') ?? null;

/** Цена за контрагента в месяц со скидкой за срок, тыйыны (прототип `subR2(cp*(100-disc)/100)`). */
export const planPrice = (view: SubView, discountPct: number): number =>
  subscriptionDiscounted(view.prices.seatPrice, discountPct);

/** Виды подписки окна: действующие и нынешний (прототип `kinds`). */
export const payPlans = (view: SubView) =>
  view.plans.filter((p) => p.active || p.id === view.sub?.planId);

/** Выбор окна оплаты (прототип `subPayDlg` → `st`). */
export interface PayState {
  planId: string;
  seats: number;
  extraGb: number;
  startMode: 'now' | 'next';
}

/** Значения окна по умолчанию; `pre` — отклонённая оплата («Прикрепить другой чек»). */
export function payDefaults(view: SubView, mode: PayMode, pre?: SubPay | null): PayState {
  const step = view.prices.seatStep;
  const min = subscriptionMinSeats(view.usage.seatsUsed, step);
  const plans = payPlans(view);
  const current = view.sub ? plans.find((p) => p.id === view.sub!.planId && p.active) : undefined;
  const planId = pre?.planId ?? current?.id ?? plans.find((p) => p.active)?.id ?? '';
  const nowSeats = view.usage.seats;
  const seats = pre
    ? pre.seats
    : mode === 'grow'
      ? Math.max(nowSeats + step, min)
      : view.sub
        ? Math.max(view.sub.seats, min)
        : min;
  const extraGb = pre
    ? pre.extraGb
    : mode === 'mem'
      ? view.usage.extraGb + 1
      : (view.sub?.extraGb ?? 0);
  const startMode = pre?.startMode === 'next' && view.monthsLeft > 1 ? 'next' : 'now';
  return { planId, seats, extraGb, startMode };
}

/** Что уйдёт на сервер: расширение не меняет память, память — пакет (прототип `subPaySend`). */
export function payChoice(view: SubView, mode: PayMode, st: PayState): SubscriptionPayChoice {
  return {
    kind: mode,
    planId: mode === 'renew' ? st.planId : null,
    seats: mode === 'mem' ? view.usage.seats : st.seats,
    extraGb: mode === 'grow' ? view.usage.extraGb : st.extraGb,
    startMode: mode === 'renew' ? 'now' : st.startMode,
  };
}

/** Что мешает оплате: поле окна и текст (прототип `errs`); null — можно считать сумму. */
export function payProblem(
  t: Translate,
  view: SubView,
  mode: PayMode,
  st: PayState,
): { field: 'plan' | 'seats' | 'extraGb'; text: string } | null {
  const choice = payChoice(view, mode, st);
  const plan = view.plans.find((p) => p.id === st.planId);
  const p = subscriptionPayProblem({
    kind: mode,
    prices: view.prices,
    planOk: mode !== 'renew' || !!plan?.active,
    nowSeats: view.usage.seats,
    nowExtraGb: view.usage.extraGb,
    active: view.usage.seatsUsed,
    usedBytes: view.usage.bytesUsed,
    seats: choice.seats,
    extraGb: choice.extraGb,
  });
  if (!p) return null;
  const text = ((): string => {
    switch (p.code) {
      case 'sub_plan_required':
        return t('sub.err.kind');
      case 'sub_seats_step':
        return t('sub.err.step', { step: p.step, a: p.step, b: p.step * 2, c: p.step * 3 });
      case 'sub_seats_active':
        return t(`sub.err.active.${pluralForm(p.n)}`, { n: p.n, active: p.active });
      case 'sub_seats_not_more':
        return t('sub.err.not_more', { now: p.now });
      case 'sub_gb_invalid':
        return t('sub.err.gb');
      case 'sub_gb_not_more':
        return t('sub.err.gb_more', { now: p.now });
      case 'sub_gb_used':
        return t('sub.err.gb_used', { used: gbText(p.usedMb), limit: gbText(p.limitMb) });
    }
  })();
  return { field: p.field, text };
}

/** Сумма окна (тот же расчёт, что у сервера); null — вид не выбран. */
export function payCalc(view: SubView, mode: PayMode, st: PayState): SubscriptionCalc | null {
  const planId = mode === 'renew' ? st.planId : view.sub?.planId;
  const plan = view.plans.find((p) => p.id === planId);
  if (!plan) return null;
  const choice = payChoice(view, mode, st);
  return subscriptionCalc({
    kind: mode,
    prices: view.prices,
    plan,
    sub: view.sub && {
      planId: view.sub.planId,
      seats: view.usage.seats,
      extraGb: view.usage.extraGb,
      paidUntil: view.sub.paidUntil,
      extraDiscountPct: view.sub.extraDiscountPct,
      firstPaid: view.sub.firstPaid,
    },
    seats: choice.seats,
    extraGb: choice.extraGb,
    startMode: choice.startMode,
    today: view.today,
  });
}

/** Память после оплаты, МБ (прототип `memAfter`). */
export function memAfterMb(view: SubView, mode: PayMode, st: PayState): number {
  const choice = payChoice(view, mode, st);
  return subscriptionMemLimitMb(view.prices, choice.seats, choice.extraGb);
}

/** Пояснение под расчётом (прототип `calcHtml`): когда и что изменится после чека. */
export function calcHint(
  t: Translate,
  view: SubView,
  mode: PayMode,
  st: PayState,
  calc: SubscriptionCalc,
): string {
  const gb = gbText(memAfterMb(view, mode, st));
  if (mode === 'renew') {
    const plan = view.plans.find((p) => p.id === st.planId);
    const until = subscriptionPaidUntilAfter(
      view.sub?.paidUntil ?? null,
      calc.months,
      view.today as IsoDate,
    );
    return t('sub.calc.renew', {
      kind: plan?.name ?? '',
      date: formatDateRu(until),
      pack: st.seats,
      gb,
    });
  }
  if (st.startMode === 'next') {
    return mode === 'grow'
      ? t('sub.calc.next_grow', { pack: st.seats })
      : t('sub.calc.next_mem', { gb });
  }
  const head =
    mode === 'grow'
      ? t('sub.calc.now_grow', { n: st.seats - view.usage.seats })
      : t('sub.calc.now_mem', { n: st.extraGb - view.usage.extraGb });
  return `${head} ${t(`sub.calc.months.${pluralForm(calc.months)}`, { n: calc.months })}`;
}

/** Назначение платежа уже с названием и ИНН (собирает сервер). */
export interface Requisite {
  key: 'to' | 'inn' | 'bank' | 'bik' | 'acc' | 'purpose';
  value: string | null;
  mono: boolean;
}

export function requisites(view: SubView): Requisite[] {
  const r = view.requisites;
  return [
    { key: 'to', value: r.recipient, mono: false },
    { key: 'inn', value: r.recipientInn, mono: true },
    { key: 'bank', value: r.bank, mono: false },
    { key: 'bik', value: r.bik, mono: true },
    { key: 'acc', value: r.account, mono: true },
    { key: 'purpose', value: r.purpose, mono: false },
  ];
}

/** «Скопировать всё» (прототип `sp-cpall`): строки «Подпись: значение», сумма — когда посчитана. */
export function requisitesText(t: Translate, view: SubView, total: number | null): string {
  const r = view.requisites;
  const rows: [UiTextKey, string | null][] = [
    ['sub.req.to', r.recipient],
    ['sub.req.inn_short', r.recipientInn],
    ['sub.req.bank', r.bank],
    ['sub.req.bik', r.bik],
    ['sub.req.acc', r.account],
    ['sub.req.purpose', r.purpose],
    ['sub.req.sum', total === null ? null : formatSomWithUnit(total)],
  ];
  return rows
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${t(k)}: ${v}`)
    .join('\n');
}

/** Что на экране вместо кнопок: чек на проверке, доступ закрыт (прототип `title` кнопок). */
export function payBlocked(view: SubView, mode: PayMode): 'wait' | 'closed' | null {
  if (pendingOf(view)) return 'wait';
  if (mode !== 'renew' && (!view.sub || view.closed)) return 'closed';
  return null;
}

/** «Прикрепить другой чек» (сервер ставит `again`): та оплата, которую можно повторить. */
export const againOf = (view: SubView): SubPay | null => view.payments.find((p) => p.again) ?? null;
