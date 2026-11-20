import { addDays, type IsoDate } from '../common/dates';
import { SUBSCRIPTION_GB_MB, SUBSCRIPTION_MB_BYTES } from './subscriptions';

/*
 * Расчёт подписки (доработки 20.11.2026, блок 1, пункт 8; блок 2, пункт 4; блок 3, пункт 3; блок 4,
 * пункт 1) — прототип `core/subs.js`: `subCalc`, `subMonthsLeft`, `subPaidToAfter`, `subAddM`,
 * `subAddDisc`. Суммы — целые тыйыны: где прототип округляет сомы до копеек (`subR2`), здесь
 * округляется до тыйына. Сумму к оплате считает сервер: число из окна оплаты на веру не берётся.
 * Один расчёт на окно оплаты владельца и на подтверждение чека во вкладке «Подписки» Админки.
 */

/** «Цены и реквизиты» платформы — часть, нужная расчёту (таблица `subscription_settings`). */
export interface SubscriptionPrices {
  /** Цена за контрагента в месяц без скидки, тыйыны (100 сом). */
  seatPrice: number;
  /** Цена 1 ГБ памяти сверх в месяц без скидки, тыйыны (100 сом). */
  gbPrice: number;
  /** Шаг пакета (10). */
  seatStep: number;
  /** Память организации, МБ (2 000). */
  baseMb: number;
  /** Память за место пакета, МБ (200). */
  seatMb: number;
  /** Скидка первого месяца, % (50). */
  firstMonthPct: number;
  /** Дополнительная скидка действует с пакета больше этого числа (150). */
  extraDiscountOver: number;
}

/** Вид подписки: срок и скидка за срок (справочник «Виды подписок», `subscription_plans`). */
export interface SubscriptionPlanTerms {
  id: string;
  months: number;
  discountPct: number;
}

/**
 * Подписка организации сейчас: пакет и память — с «Со следующего месяца», когда он наступил (их отдаёт
 * `app.org_usage`); без подписки — null.
 */
export interface SubscriptionNow {
  planId: string;
  seats: number;
  extraGb: number;
  /** «Оплачено до», включительно. */
  paidUntil: IsoDate;
  /** Дополнительная скидка организации, % (ставит администратор платформы). */
  extraDiscountPct: number;
  /** Первый месяц уже оплачен: скидки первого месяца больше нет. */
  firstPaid: boolean;
}

export type SubscriptionPayKind = 'renew' | 'grow' | 'mem';
export type SubscriptionStartMode = 'now' | 'next';

/**
 * Строка расчёта (в «Истории оплат» — поле `lines`, до 20 строк): что считается, по чём и сколько.
 * Подпись строки собирает экран по словарю: `seats` — «Контрагенты: 60 × 95,00 × 3 мес.», `gb` — «Память
 * сверх: 2 ГБ × 95,00 × 3 мес.», `grow` — «Расширение пакета: +10 × …», `mem` — «Память сверх: +1 ГБ ×
 * …», `extra` — «Дополнительная скидка 10 %», `first` — «Скидка первого месяца 50 %». Итог — отдельно
 * (`total`), строкой «Итого к оплате».
 */
export interface SubscriptionCalcLine {
  k: 'seats' | 'gb' | 'grow' | 'mem' | 'extra' | 'first';
  /** Сколько мест или ГБ. */
  n?: number;
  /** Цена за место или ГБ в месяц, тыйыны. */
  price?: number;
  /** Месяцев. */
  months?: number;
  /** Процент скидки. */
  pct?: number;
  /** Сумма строки, тыйыны: скидки — меньше нуля. */
  sum: number;
}

export interface SubscriptionCalc {
  lines: SubscriptionCalcLine[];
  /** Итого к оплате, тыйыны, не меньше нуля. */
  total: number;
  /** Месяцев оплаты: срок вида при продлении, оставшиеся месяцы срока при расширении и памяти. */
  months: number;
  /** Цена за контрагента в месяц со скидкой за срок, тыйыны. */
  price: number;
  /** Цена ГБ в месяц со скидкой за срок, тыйыны. */
  gbPrice: number;
  /** Какая дополнительная скидка учтена, %. */
  extraDiscountPct: number;
}

export interface SubscriptionCalcInput {
  kind: SubscriptionPayKind;
  prices: SubscriptionPrices;
  /** Продление — выбранный вид; расширение и память — вид подписки (доплата по его цене). */
  plan: SubscriptionPlanTerms;
  sub: SubscriptionNow | null;
  /** Пакет после оплаты (продление и расширение). */
  seats: number;
  /** Память сверх после оплаты, ГБ (продление и память). */
  extraGb: number;
  /** Расширение и память: «Сейчас» (с доплатой за текущий месяц) или «Со следующего месяца». */
  startMode: SubscriptionStartMode;
  today: IsoDate;
}

/** Процент от тыйынов с округлением до тыйына (как `subR2` прототипа — до копейки). */
const pctOf = (amount: number, pct: number): number => Math.round((amount * pct) / 100);

/** Цена со скидкой за срок, тыйыны. */
export const subscriptionDiscounted = (price: number, discountPct: number): number =>
  pctOf(price, 100 - discountPct);

/**
 * Дата + n месяцев с тем же числом (прототип `subAddM`): 31 января + 1 месяц = 28 февраля (29 — в
 * високосный год).
 */
export function addSubscriptionMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/**
 * Сколько месяцев срока осталось, считая текущий месяц подписки (прототип `subMonthsLeft`; блок 3,
 * пункт 3): месяц подписки — от числа начала до того же числа следующего месяца. Срок прошёл или
 * подписки нет — 0.
 */
export function subscriptionMonthsLeft(paidUntil: IsoDate | null, today: IsoDate): number {
  if (!paidUntil || paidUntil < today) return 0;
  const end = addDays(paidUntil, 1);
  let n = 0;
  while (n < 120 && addSubscriptionMonths(end, -(n + 1)) > today) n++;
  return n + 1;
}

/**
 * «Оплачено до» после продления на `months` месяцев (прототип `subPaidToAfter`; блок 4, пункт 1): до
 * конца срока — со дня после «Оплачено до», после закрытия доступа — со дня `from` (день чека).
 */
export function subscriptionPaidUntilAfter(
  paidUntil: IsoDate | null,
  months: number,
  from: IsoDate,
): IsoDate {
  const start = paidUntil && paidUntil >= from ? addDays(paidUntil, 1) : from;
  return addDays(addSubscriptionMonths(start, months), -1);
}

/**
 * С какого дня действует «Со следующего месяца» (прототип `subPayOk`, `from: 'next'`): начало
 * следующего месяца подписки.
 */
export function subscriptionNextFrom(paidUntil: IsoDate, today: IsoDate): IsoDate {
  const left = subscriptionMonthsLeft(paidUntil, today);
  return addSubscriptionMonths(addDays(paidUntil, 1), -Math.max(0, left - 1));
}

/** Дополнительная скидка — только при пакете больше порога (блок 1, пункт 6; прототип `subAddDisc`). */
export function subscriptionExtraDiscount(
  sub: Pick<SubscriptionNow, 'extraDiscountPct'> | null,
  seats: number,
  prices: Pick<SubscriptionPrices, 'extraDiscountOver'>,
): number {
  return sub && seats > prices.extraDiscountOver ? Math.max(0, sub.extraDiscountPct) : 0;
}

/** Предел памяти пакета, МБ: 2 ГБ, 200 МБ за место и купленное сверх (1 ГБ = 1 000 МБ; блок 2, пункт 2). */
export const subscriptionMemLimitMb = (
  prices: Pick<SubscriptionPrices, 'baseMb' | 'seatMb'>,
  seats: number,
  extraGb: number,
): number => prices.baseMb + prices.seatMb * seats + extraGb * SUBSCRIPTION_GB_MB;

/** Тот же предел в байтах (как `bytes_limit` у `app.org_usage`). */
export const subscriptionMemLimitBytes = (
  prices: Pick<SubscriptionPrices, 'baseMb' | 'seatMb'>,
  seats: number,
  extraGb: number,
): number => subscriptionMemLimitMb(prices, seats, extraGb) * SUBSCRIPTION_MB_BYTES;

/** Наименьший пакет: по шагу, не меньше шага и не меньше активных контрагентов (блок 1, пункт 2; блок 3, пункт 4). */
export const subscriptionMinSeats = (active: number, step: number): number =>
  Math.max(step, Math.ceil(active / step) * step);

/**
 * Сумма к оплате (прототип `subCalc`). Продление: контрагенты и память сверх за срок вида по цене со
 * скидкой за срок, дополнительная скидка — от полной цены и только на контрагентов, скидка первого
 * месяца — от цены со всеми скидками, только на контрагентов и один раз. Расширение и память: доплата
 * за разницу по цене вида подписки — за текущий месяц целиком и оставшиеся месяцы срока («Сейчас») или
 * без текущего («Со следующего месяца»).
 */
export function subscriptionCalc(o: SubscriptionCalcInput): SubscriptionCalc {
  const { prices, plan, sub } = o;
  const price = subscriptionDiscounted(prices.seatPrice, plan.discountPct);
  const gbPrice = subscriptionDiscounted(prices.gbPrice, plan.discountPct);
  const lines: SubscriptionCalcLine[] = [];
  let months = plan.months;
  let extra = 0;
  if (o.kind === 'renew') {
    extra = subscriptionExtraDiscount(sub, o.seats, prices);
    lines.push({ k: 'seats', n: o.seats, price, months, sum: price * o.seats * months });
    if (o.extraGb) {
      lines.push({
        k: 'gb',
        n: o.extraGb,
        price: gbPrice,
        months,
        sum: gbPrice * o.extraGb * months,
      });
    }
    if (extra) {
      lines.push({
        k: 'extra',
        pct: extra,
        sum: -pctOf(prices.seatPrice * o.seats * months, extra),
      });
    }
    if (!sub?.firstPaid && prices.firstMonthPct) {
      const all = Math.min(100, plan.discountPct + extra);
      const month = subscriptionDiscounted(prices.seatPrice, all) * o.seats;
      lines.push({
        k: 'first',
        pct: prices.firstMonthPct,
        sum: -pctOf(month, prices.firstMonthPct),
      });
    }
  } else {
    const left = subscriptionMonthsLeft(sub?.paidUntil ?? null, o.today);
    months = o.startMode === 'next' ? Math.max(0, left - 1) : left;
    if (o.kind === 'grow') {
      const d = Math.max(0, o.seats - (sub?.seats ?? 0));
      lines.push({ k: 'grow', n: d, price, months, sum: price * d * months });
      extra = subscriptionExtraDiscount(sub, o.seats, prices);
      if (extra && d) {
        lines.push({ k: 'extra', pct: extra, sum: -pctOf(prices.seatPrice * d * months, extra) });
      }
    } else {
      const d = Math.max(0, o.extraGb - (sub?.extraGb ?? 0));
      lines.push({ k: 'mem', n: d, price: gbPrice, months, sum: gbPrice * d * months });
    }
  }
  const total = Math.max(
    0,
    lines.reduce((a, l) => a + l.sum, 0),
  );
  return { lines, total, months, price, gbPrice, extraDiscountPct: extra };
}

/** Что мешает оплате в окне (прототип `subPayDlg` → `errs`): поле и код отказа. */
export type SubscriptionPayProblem =
  | { field: 'plan'; code: 'sub_plan_required' }
  | { field: 'seats'; code: 'sub_seats_step'; step: number }
  | { field: 'seats'; code: 'sub_seats_active'; n: number; active: number }
  | { field: 'seats'; code: 'sub_seats_not_more'; now: number }
  | { field: 'extraGb'; code: 'sub_gb_invalid' }
  | { field: 'extraGb'; code: 'sub_gb_not_more'; now: number }
  | { field: 'extraGb'; code: 'sub_gb_used'; usedMb: number; limitMb: number };

export interface SubscriptionPayCheck {
  kind: SubscriptionPayKind;
  prices: Pick<SubscriptionPrices, 'seatStep' | 'baseMb' | 'seatMb'>;
  /** Выбранный вид продления есть и действует. */
  planOk: boolean;
  /** Пакет и память сверх сейчас. */
  nowSeats: number;
  nowExtraGb: number;
  /** Активные контрагенты. */
  active: number;
  /** Занято памяти, байт. */
  usedBytes: number;
  seats: number;
  extraGb: number;
}

/**
 * Проверка окна оплаты (блок 1, пункт 2; блок 3, пункты 1–4): пакет — по шагу и не меньше активных,
 * расширение — больше нынешнего; память — целое число ГБ, докупка — больше нынешней, занятое должно
 * поместиться. Первый отказ по порядку полей окна; null — можно считать сумму.
 */
export function subscriptionPayProblem(c: SubscriptionPayCheck): SubscriptionPayProblem | null {
  const step = c.prices.seatStep;
  if (c.kind === 'renew' && !c.planOk) return { field: 'plan', code: 'sub_plan_required' };
  if (c.kind !== 'mem') {
    if (!Number.isInteger(c.seats) || c.seats < step || c.seats % step) {
      return { field: 'seats', code: 'sub_seats_step', step };
    }
    if (c.seats < c.active) {
      return { field: 'seats', code: 'sub_seats_active', n: c.active - c.seats, active: c.active };
    }
    if (c.kind === 'grow' && c.seats <= c.nowSeats) {
      return { field: 'seats', code: 'sub_seats_not_more', now: c.nowSeats };
    }
  }
  if (c.kind !== 'grow') {
    if (!Number.isInteger(c.extraGb) || c.extraGb < 0) {
      return { field: 'extraGb', code: 'sub_gb_invalid' };
    }
    if (c.kind === 'mem' && c.extraGb <= c.nowExtraGb) {
      return { field: 'extraGb', code: 'sub_gb_not_more', now: c.nowExtraGb };
    }
    const limitMb = subscriptionMemLimitMb(
      c.prices,
      c.kind === 'renew' ? c.seats : c.nowSeats,
      c.extraGb,
    );
    const usedMb = c.usedBytes / SUBSCRIPTION_MB_BYTES;
    if (limitMb < usedMb) return { field: 'extraGb', code: 'sub_gb_used', usedMb, limitMb };
  }
  return null;
}
