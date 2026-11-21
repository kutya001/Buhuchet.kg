import { addDays, diffDays, isIsoDate, type IsoDate } from '../common/dates';
import { subscriptionNextFrom, subscriptionPaidUntilAfter } from './calc';
import type { SubscriptionEdit } from './edit';
import type { SubscriptionStatus } from './subscriptions';

/*
 * Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6; прототип admin/subs-admin.js и
 * core/subs.js: `subSortKey`, `subPayLate`, `subPayOk`, `subSet`, `subKindDlg`, `subPricesPart`).
 * Проверку чеков, «Изменить подписку», виды подписок и цены ведёт только администратор платформы.
 */

/**
 * Порядок статусов в списке «Организации» (прототип `SUB_ST`): «Ждёт подтверждения», «Просрочена»,
 * «Скоро истекает», «Нет подписки», «Активна»; демо-организация — последней.
 */
export const SUBSCRIPTION_STATUS_ORDER: Readonly<Record<SubscriptionStatus, number>> = {
  pending: 0,
  overdue: 1,
  expiring: 2,
  none: 3,
  active: 4,
  demo: 5,
};

/** Чек ждёт проверки дольше срока (прототип `subPayLate`): дней после дня прикрепления больше срока. */
export const subscriptionPayLate = (sentDay: IsoDate, today: IsoDate, checkDays: number): boolean =>
  diffDays(today, sentDay) > checkDays;

/** Подписка организации — как строка `org_subscriptions`. */
export interface SubscriptionState {
  planId: string;
  seats: number;
  extraGb: number;
  /** «Оплачено до»; пусто — подписки ещё нет (ставится вместе с первой). */
  paidUntil: IsoDate | null;
  extraDiscountPct: number;
  firstPaid: boolean;
  free: boolean;
  nextSeats: number | null;
  nextExtraGb: number | null;
  nextFrom: IsoDate | null;
}

/** Заявка владельца с чеком, которую подтверждают (строка `subscription_payments`). */
export interface SubscriptionPendingPayment {
  kind: 'renew' | 'grow' | 'mem';
  startMode: 'now' | 'next';
  planId: string;
  months: number;
  seats: number;
  extraGb: number;
  /** День прикрепления чека по Бишкеку: с него считается продление после закрытия доступа. */
  sentDay: IsoDate;
}

/**
 * «Оплачено до» в окне «Подтвердить оплату» по числу месяцев (прототип `subPayOkDlg` → `calc`):
 * продление — `subPaidToAfter` от дня чека; расширение и память — нынешнее «Оплачено до» (нет — сегодня).
 */
export function subscriptionConfirmUntil(
  sub: Pick<SubscriptionState, 'paidUntil'> | null,
  p: Pick<SubscriptionPendingPayment, 'kind' | 'sentDay'>,
  months: number,
  today: IsoDate,
): IsoDate {
  if (p.kind === 'renew')
    return subscriptionPaidUntilAfter(sub?.paidUntil ?? null, months, p.sentDay);
  return sub?.paidUntil ?? today;
}

/** «Число месяцев» продления при подтверждении: от 1 до 36 (прототип `subPayOkDlg`). */
export const SUBSCRIPTION_CONFIRM_MONTHS_MAX = 36;

/**
 * «Подтвердить оплату» (прототип `subPayOk`; блок 6, пункт 3). Продление ставит вид, пакет, память и
 * «Оплачено до» из заявки, первый месяц — оплачен, бесплатный период и «Со следующего месяца» снимает.
 * Расширение и память «Со следующего месяца» ждут в `next*` с начала следующего месяца подписки, «Сейчас» —
 * сразу. «Оплачено до», поправленное администратором, у расширения и памяти тоже ставится.
 * «Со следующего месяца», который уже наступил, сначала становится пакетом и памятью подписки: иначе
 * расширение «Сейчас» не перекрыло бы его (docs/deviations.md п. О-91).
 */
export function subscriptionConfirm(
  current: SubscriptionState | null,
  p: SubscriptionPendingPayment,
  o: { months: number; paidUntil: IsoDate },
  today: IsoDate,
): { sub: SubscriptionState; months: number; paidUntil: IsoDate } {
  let s: SubscriptionState = current
    ? { ...current }
    : {
        planId: p.planId,
        seats: 0,
        extraGb: 0,
        paidUntil: null,
        extraDiscountPct: 0,
        firstPaid: false,
        free: false,
        nextSeats: null,
        nextExtraGb: null,
        nextFrom: null,
      };
  if (s.nextFrom && s.nextFrom <= today) {
    s = {
      ...s,
      seats: s.nextSeats ?? s.seats,
      extraGb: s.nextExtraGb ?? s.extraGb,
      nextSeats: null,
      nextExtraGb: null,
      nextFrom: null,
    };
  }
  if (p.kind === 'renew') {
    return {
      sub: {
        ...s,
        planId: p.planId,
        seats: p.seats,
        extraGb: p.extraGb,
        paidUntil: o.paidUntil,
        firstPaid: true,
        free: false,
        nextSeats: null,
        nextExtraGb: null,
        nextFrom: null,
      },
      months: o.months,
      paidUntil: o.paidUntil,
    };
  }
  if (p.startMode === 'next') {
    s = {
      ...s,
      nextSeats: p.kind === 'grow' ? p.seats : (s.nextSeats ?? s.seats),
      nextExtraGb: p.kind === 'mem' ? p.extraGb : (s.nextExtraGb ?? s.extraGb),
      nextFrom: s.paidUntil ? subscriptionNextFrom(s.paidUntil, today) : today,
    };
  } else if (p.kind === 'grow') {
    s = { ...s, seats: p.seats };
  } else {
    s = { ...s, extraGb: p.extraGb };
  }
  return { sub: { ...s, paidUntil: o.paidUntil }, months: p.months, paidUntil: o.paidUntil };
}

/** Поле подписки в истории «Изменить подписку» (прототип `subSet`: Вид, Пакет, Память сверх, …). */
export const SUBSCRIPTION_HISTORY_FIELDS = [
  'planId',
  'seats',
  'extraGb',
  'paidUntil',
  'extraDiscountPct',
] as const;
export type SubscriptionHistoryField = (typeof SUBSCRIPTION_HISTORY_FIELDS)[number];

export interface SubscriptionChange {
  field: SubscriptionHistoryField | 'free';
  from?: string | number | boolean | null;
  to: string | number | boolean | null;
}

/**
 * «Изменить подписку» (прототип `subSet`; блок 6, пункт 4): что меняется («было → стало» по полям),
 * новая подписка и нужна ли строка «Бесплатный период до …» в «Истории оплат». Дополнительная скидка при
 * пакете не больше порога — 0. Без изменений и без бесплатного периода — `null` («Изменений нет»).
 * Бесплатный период снимается, когда без него сменили «Оплачено до».
 */
export function subscriptionEdit(
  current: SubscriptionState | null,
  x: SubscriptionEdit & { free: boolean },
  extraDiscountOver: number,
): { sub: SubscriptionState; changes: SubscriptionChange[] } | null {
  const next = {
    planId: x.planId,
    seats: x.seats,
    extraGb: x.extraGb,
    paidUntil: x.paidUntil as IsoDate,
    extraDiscountPct: x.seats > extraDiscountOver ? x.extraDiscountPct : 0,
  };
  const changes: SubscriptionChange[] = [];
  for (const f of SUBSCRIPTION_HISTORY_FIELDS) {
    const was = current ? current[f] : undefined;
    if (was !== next[f]) {
      changes.push(
        current ? { field: f, from: was ?? null, to: next[f] } : { field: f, to: next[f] },
      );
    }
  }
  if (x.free) changes.push({ field: 'free', to: true });
  if (!changes.length) return null;
  const free = x.free || (!!current?.free && current.paidUntil === next.paidUntil);
  if (current?.free && !free) changes.push({ field: 'free', from: true, to: false });
  const base: SubscriptionState = current ?? {
    planId: x.planId,
    seats: x.seats,
    extraGb: 0,
    paidUntil: null,
    extraDiscountPct: 0,
    firstPaid: false,
    free: false,
    nextSeats: null,
    nextExtraGb: null,
    nextFrom: null,
  };
  return { sub: { ...base, ...next, free }, changes };
}

/* ── «Виды подписок» (блок 6, пункт 5; прототип subKindDlg) ── */

export interface SubscriptionPlanInput {
  name: string;
  months: number;
  discountPct: number;
  perks: string[];
  sortOrder: number;
  active: boolean;
}

export const SUBSCRIPTION_PLAN_FIELDS = [
  'name',
  'months',
  'discountPct',
  'perks',
  'sortOrder',
  'active',
] as const;

export type SubscriptionPlanProblemCode =
  | 'sub_kind_name'
  | 'sub_kind_name_long'
  | 'sub_kind_name_taken'
  | 'sub_kind_months'
  | 'sub_kind_discount'
  | 'sub_kind_perks'
  | 'sub_kind_order';

export interface SubscriptionPlanProblem {
  field: Exclude<(typeof SUBSCRIPTION_PLAN_FIELDS)[number], 'active'>;
  code: SubscriptionPlanProblemCode;
}

/** Тексты отказов (`err.<код>` словаря — те же). */
export const SUBSCRIPTION_PLAN_MESSAGES: Record<SubscriptionPlanProblemCode, string> = {
  sub_kind_name: 'Введите название',
  sub_kind_name_long: 'Не длиннее 40 знаков',
  sub_kind_name_taken: 'Такой вид уже есть',
  sub_kind_months: 'От 1 до 36 месяцев',
  sub_kind_discount: 'От 0 до 90 %',
  sub_kind_perks: 'Не больше 10 строк по 120 знаков',
  sub_kind_order: 'Целое число от 1',
};

/** Преимущества — строки окна без пустых и пробелов по краям. */
export const subscriptionPerksOf = (text: string): string[] =>
  text
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Что не так в виде подписки (прототип `subKindDlg`): название — до 40 знаков и не повторяет другой вид
 * без учёта регистра, срок 1–36 месяцев, скидка 0–90 %, преимущества — до 10 строк по 120 знаков,
 * порядок — целое от 1. `others` — названия остальных видов.
 */
export function subscriptionPlanProblems(
  x: SubscriptionPlanInput,
  others: readonly string[],
): SubscriptionPlanProblem[] {
  const out: SubscriptionPlanProblem[] = [];
  const name = x.name.trim();
  const lower = name.toLowerCase();
  if (!name) out.push({ field: 'name', code: 'sub_kind_name' });
  else if (name.length > 40) out.push({ field: 'name', code: 'sub_kind_name_long' });
  else if (others.some((o) => o.trim().toLowerCase() === lower)) {
    out.push({ field: 'name', code: 'sub_kind_name_taken' });
  }
  if (!Number.isInteger(x.months) || x.months < 1 || x.months > SUBSCRIPTION_CONFIRM_MONTHS_MAX) {
    out.push({ field: 'months', code: 'sub_kind_months' });
  }
  if (!Number.isInteger(x.discountPct) || x.discountPct < 0 || x.discountPct > 90) {
    out.push({ field: 'discountPct', code: 'sub_kind_discount' });
  }
  if (x.perks.length > 10 || x.perks.some((p) => p.length > 120)) {
    out.push({ field: 'perks', code: 'sub_kind_perks' });
  }
  if (!Number.isInteger(x.sortOrder) || x.sortOrder < 1 || x.sortOrder > 100000) {
    out.push({ field: 'sortOrder', code: 'sub_kind_order' });
  }
  return out;
}

/** Поля вида подписки, которые изменились (строка истории «Виды подписок: …»). */
export function subscriptionPlanChanges(
  was: SubscriptionPlanInput,
  now: SubscriptionPlanInput,
): { field: string; from: string | number | boolean; to: string | number | boolean }[] {
  const out: { field: string; from: string | number | boolean; to: string | number | boolean }[] =
    [];
  for (const f of SUBSCRIPTION_PLAN_FIELDS) {
    const a = f === 'perks' ? was.perks.join('\n') : was[f];
    const b = f === 'perks' ? now.perks.join('\n') : now[f];
    if (a !== b) out.push({ field: f, from: a, to: b });
  }
  return out;
}

/* ── «Цены и реквизиты» (блок 6, пункт 6; прототип SUB_PF, SUB_RF, subPricesPart) ── */

/** Цены и сроки окна: сомы с копейками у цен, остальное — целые; поле — ключ прототипа. */
export const SUBSCRIPTION_PRICE_FIELDS = [
  { key: 'seatPrice', min: 1, max: 100000, money: true },
  { key: 'seatStep', min: 1, max: 1000 },
  { key: 'gbPrice', min: 0, max: 100000, money: true },
  { key: 'baseGb', min: 0, max: 1000 },
  { key: 'seatMb', min: 0, max: 100000 },
  { key: 'firstMonthPct', min: 0, max: 100 },
  { key: 'extraDiscountOver', min: 0, max: 100000 },
  { key: 'remindDays', min: 1, max: 60 },
  { key: 'checkDays', min: 1, max: 30 },
] as const;
export type SubscriptionPriceField = (typeof SUBSCRIPTION_PRICE_FIELDS)[number]['key'];

/** Реквизиты платформы для оплаты: обязательные — все, кроме ИНН получателя. */
export const SUBSCRIPTION_REQUISITE_FIELDS = [
  { key: 'recipient', required: true, max: 200 },
  { key: 'recipientInn', required: false, max: 14 },
  { key: 'bank', required: true, max: 200 },
  { key: 'bik', required: true, max: 6 },
  { key: 'account', required: true, max: 24 },
  { key: 'purpose', required: true, max: 210 },
] as const;
export type SubscriptionRequisiteField = (typeof SUBSCRIPTION_REQUISITE_FIELDS)[number]['key'];

/** Подстановки назначения платежа. */
export const SUBSCRIPTION_PURPOSE_VARS = ['{организация}', '{ИНН}'] as const;

/** «Цены и реквизиты» из окна: цены — тыйыны, включённая память — целые ГБ. */
export type SubscriptionSettingsInput = Record<SubscriptionPriceField, number> &
  Record<SubscriptionRequisiteField, string>;

export type SubscriptionSettingsProblemCode =
  | 'sub_cfg_range'
  | 'sub_cfg_range_int'
  | 'sub_cfg_required'
  | 'sub_cfg_long'
  | 'sub_cfg_bik'
  | 'sub_cfg_inn'
  | 'sub_cfg_purpose';

export interface SubscriptionSettingsProblem {
  field: SubscriptionPriceField | SubscriptionRequisiteField;
  code: SubscriptionSettingsProblemCode;
  params?: Record<string, string | number>;
}

export const SUBSCRIPTION_SETTINGS_MESSAGES: Record<SubscriptionSettingsProblemCode, string> = {
  sub_cfg_range: 'От {min} до {max}',
  sub_cfg_range_int: 'От {min} до {max}, целое',
  sub_cfg_required: 'Заполните поле',
  sub_cfg_long: 'Не длиннее {max} знаков',
  sub_cfg_bik: 'БИК — 6 цифр',
  sub_cfg_inn: 'ИНН — 14 цифр',
  sub_cfg_purpose: 'Неизвестная подстановка: {bad}',
};

/**
 * Что не так в «Ценах и реквизитах» (прототип `subPricesPart` → «Сохранить»): числа — в пределах
 * `SUBSCRIPTION_PRICE_FIELDS` (цены — сомы с копейками, остальное — целые), обязательные реквизиты
 * заполнены, БИК — 6 цифр, ИНН — 14 цифр, в назначении — только {организация} и {ИНН}.
 */
export function subscriptionSettingsProblems(
  x: SubscriptionSettingsInput,
): SubscriptionSettingsProblem[] {
  const out: SubscriptionSettingsProblem[] = [];
  for (const f of SUBSCRIPTION_PRICE_FIELDS) {
    const money = 'money' in f && f.money;
    const v = x[f.key];
    const whole = money ? v / 100 : v;
    if (!Number.isInteger(v) || whole < f.min || whole > f.max) {
      out.push({
        field: f.key,
        code: money ? 'sub_cfg_range' : 'sub_cfg_range_int',
        params: { min: f.min, max: f.max },
      });
    }
  }
  for (const f of SUBSCRIPTION_REQUISITE_FIELDS) {
    const v = x[f.key].trim();
    if (f.required && !v) out.push({ field: f.key, code: 'sub_cfg_required' });
    else if (f.key === 'bik' && v && !/^\d{6}$/.test(v))
      out.push({ field: f.key, code: 'sub_cfg_bik' });
    else if (f.key === 'recipientInn' && v && !/^\d{14}$/.test(v)) {
      out.push({ field: f.key, code: 'sub_cfg_inn' });
    } else if (v.length > f.max) {
      out.push({ field: f.key, code: 'sub_cfg_long', params: { max: f.max } });
    } else if (f.key === 'purpose') {
      const bad = (v.match(/\{([^{}]*)\}/g) ?? []).filter(
        (t) => !(SUBSCRIPTION_PURPOSE_VARS as readonly string[]).includes(t),
      );
      if (bad.length)
        out.push({ field: f.key, code: 'sub_cfg_purpose', params: { bad: bad.join(', ') } });
    }
  }
  return out;
}

/** Назначение платежа организации (прототип `subPurpose`): {организация} и {ИНН} — её название и ИНН. */
export const subscriptionPurposeText = (purpose: string, org: { name: string; inn: string }) =>
  purpose.replace(/\{организация\}/g, org.name).replace(/\{ИНН\}/g, org.inn);

/** «Оплачено до» по умолчанию в «Изменить подписку» без подписки (прототип `subEditFields`: +30 дней). */
export const subscriptionEditDefaultUntil = (today: IsoDate): IsoDate => addDays(today, 30);

/** Дата строкой ГГГГ-ММ-ДД, настоящая. */
export const isRealIsoDate = (s: string): s is IsoDate =>
  isIsoDate(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
