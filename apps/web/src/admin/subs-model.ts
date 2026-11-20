import {
  bishkekDate,
  bishkekTime,
  clampPage,
  formatDateRu,
  formatSom,
  formatSomWithUnit,
  matchesSearch,
  pageLimit,
  subscriptionGbText,
  type IsoDate,
  type SubscriptionPaymentKind,
  type SubscriptionPaymentStatus,
  type SubscriptionStatus,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  ListQueryParams,
  parseListQuery,
  type AdminSubscriptionCard,
  type AdminSubscriptionPayment,
} from '@buhuchet/shared';
import type { GridPage, PlateColor, TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/*
 * Тексты вкладки «Подписки» Админки (прототип admin/subs-admin.js и core/subs.js): что оплачено, срок,
 * строки расчёта, статусы, «История изменений» подписки и видов с ценами. Только словарь — без своих
 * строк; правила считает сервер.
 */

type Payment = AdminSubscriptionPayment;
type HistoryEntry = AdminSubscriptionCard['history'][number];
type CalcLine = Payment['lines'][number];

/** ГБ одним знаком после запятой, как «9,4 из 14 ГБ» (прототип `subGb`): правило домена. */
export const subGb = subscriptionGbText;

/**
 * Отказ сервера по полю формы подписки (`sub_*`, `details.field`): ошибка — под этим полем, если блок
 * включён и такое поле в форме есть; иначе null — отказ показывается уведомлением.
 */
export function subFieldError(
  on: boolean,
  fields: object,
  field: string | null,
  message: string,
): Record<string, string> | null {
  return on && field && field in fields ? { [field]: message } : null;
}

/** Предел памяти: нет предела — «∞» (только демо-организация; без подписки — «из 2 ГБ» с сервера). */
export const subGbLimit = (bytes: number | null) => (bytes === null ? '∞' : subGb(bytes));

const date = (d: string) => formatDateRu(d as IsoDate);

/** Статус подписки словами. */
export const subStatusText = (t: Translate, st: SubscriptionStatus) => t(`subs.st.${st}`);

/** Цвет и значок статуса (прототип `SUB_PILL`; «—» демо-организации — серым). */
export const SUB_STATUS_TONE: Record<
  SubscriptionStatus,
  { tone: 'ok' | 'bad' | 'warn' | 'info' | 'plain'; icon: 'check' | 'alert' | 'clock' | 'ban' }
> = {
  active: { tone: 'ok', icon: 'check' },
  expiring: { tone: 'warn', icon: 'clock' },
  overdue: { tone: 'bad', icon: 'alert' },
  pending: { tone: 'info', icon: 'clock' },
  none: { tone: 'plain', icon: 'ban' },
  demo: { tone: 'plain', icon: 'ban' },
};

/** Статус оплаты: цвет и значок (прототип `subPaySt`). */
export const SUB_PAY_TONE: Record<
  SubscriptionPaymentStatus,
  { tone: 'ok' | 'bad' | 'info'; icon: 'check' | 'ban' | 'clock' }
> = {
  pending: { tone: 'info', icon: 'clock' },
  confirmed: { tone: 'ok', icon: 'check' },
  rejected: { tone: 'bad', icon: 'ban' },
};

export const subPayStatusText = (t: Translate, st: SubscriptionPaymentStatus) =>
  t(`subs.pay.${st}`);

/** Что оплачено (прототип `subPayWhat`). */
export function subPayWhat(
  t: Translate,
  p: Pick<Payment, 'kind' | 'planName' | 'paidUntil' | 'seats' | 'extraGb' | 'startMode'>,
): string {
  const next = p.startMode === 'next' ? t('subs.what.next') : '';
  switch (p.kind) {
    case 'renew':
      return t('subs.what.renew', { kind: p.planName });
    case 'free':
      return t('subs.what.free', { date: p.paidUntil ? date(p.paidUntil) : '—' });
    case 'grow':
      return t('subs.what.grow', { n: p.seats }) + next;
    case 'mem':
      return t('subs.what.mem', { n: p.extraGb }) + next;
    case 'admin':
      return t('subs.what.admin');
  }
}

/** Срок (прототип `subPayTerm`): «до 20.12.2026», «3 мес.» или «—». */
export function subPayTerm(
  t: Translate,
  p: Pick<Payment, 'kind' | 'months' | 'paidUntil'>,
): string {
  if (p.kind === 'free')
    return t('subs.term.until', { date: p.paidUntil ? date(p.paidUntil) : '—' });
  return p.months ? t('subs.term.months', { n: p.months }) : '—';
}

/** Строка расчёта суммы: «Контрагенты: 60 × 95,00 × 3 мес.» (прототип `subCalc` → `lines`). */
export function subLineText(t: Translate, l: CalcLine): string {
  const price = formatSom(l.price ?? 0);
  const months = l.months ?? 0;
  const n = l.n ?? 0;
  switch (l.k) {
    case 'seats':
      return t('subs.line.seats', { n, price, months });
    case 'gb':
      return t('subs.line.gb', { n, price, months });
    case 'grow':
      return t('subs.line.grow', { n, price, months });
    case 'mem':
      return t('subs.line.mem', { n, price, months });
    case 'extra':
      return t('subs.line.extra', { pct: l.pct ?? 0 });
    case 'first':
      return t('subs.line.first', { pct: l.pct ?? 0 });
  }
}

/** Кто отправил или проверил оплату (прототип `subWho`). */
export function subPayWho(
  t: Translate,
  who: { name: string | null; admin: boolean; system?: boolean } | null,
): string {
  if (!who) return '—';
  if (who.name) return who.name;
  if (who.admin) return t('subs.who.admin');
  return t('subs.who.system');
}

/** Цвета плашек (прототип `subOrgsPart`): есть такие — свой цвет, нет — зелёный. */
export function subPlateColors(byStatus: Partial<Record<SubscriptionStatus, number>>): {
  pending: PlateColor;
  overdue: PlateColor;
  expiring: PlateColor;
} {
  return {
    pending: byStatus.pending ? 'blue' : 'green',
    overdue: byStatus.overdue ? 'red' : 'green',
    expiring: byStatus.expiring ? 'yellow' : 'green',
  };
}

/* ── «История изменений» подписки (прототип core/subs.js: subPayOk, subPayRej, subSet) ── */

const HIST_FIELD: Record<string, UiTextKey> = {
  planId: 'subs.hist.f.plan_id',
  seats: 'subs.hist.f.seats',
  extraGb: 'subs.hist.f.extra_gb',
  paidUntil: 'subs.hist.f.paid_until',
  extraDiscountPct: 'subs.hist.f.extra_discount_pct',
};

const PAY_KIND: Partial<Record<SubscriptionPaymentKind, UiTextKey>> = {
  renew: 'subs.hist.kind.renew',
  grow: 'subs.hist.kind.grow',
  mem: 'subs.hist.kind.mem',
};

const change = (h: HistoryEntry, field: string) => h.changes.find((c) => c.field === field);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));
const str = (v: unknown) =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);

/** Значение поля подписки словами (прототип `subSet`, F: вид названием, ГБ, дата, %). */
function subFieldValue(
  t: Translate,
  field: string,
  v: unknown,
  planName: (id: string) => string,
): string {
  if (v === null || v === undefined) return '—';
  switch (field) {
    case 'planId':
      return planName(str(v));
    case 'extraGb':
      return t('subs.gb.n', { n: num(v) });
    case 'paidUntil':
      return str(v) ? date(str(v)) : '—';
    case 'extraDiscountPct':
      return `${num(v)} %`;
    default:
      return str(v);
  }
}

/**
 * Строка «Истории изменений» подписки: «Оплата подтверждена: продление, 5 700 сом, 3 мес., оплачено до
 * 20.02.2027 (было: Ждёт подтверждения)», «Чек отклонён: …. Причина: …», «Подписка изменена: Пакет: 10 →
 * 20. Причина: …», «Бесплатный период до …». `paidUntil` — нынешнее «Оплачено до» (для бесплатного
 * периода без смены даты).
 */
export function subHistoryText(
  t: Translate,
  h: HistoryEntry,
  ctx: { planName: (id: string) => string; paidUntil: string | null },
): string {
  if (h.action === 'sub_paid' || h.action === 'sub_rejected') {
    const kind = str(change(h, 'kind')?.to) as SubscriptionPaymentKind;
    const key = PAY_KIND[kind];
    const what = key ? t(key) : kind;
    const sum = formatSomWithUnit(num(change(h, 'amount')?.to));
    if (h.action === 'sub_rejected') {
      return t('subs.hist.rejected', { what, sum, reason: h.reason ?? '' });
    }
    const until = str(change(h, 'paidUntil')?.to);
    const term =
      kind === 'renew'
        ? t('subs.hist.paid_term', {
            months: num(change(h, 'months')?.to),
            date: until ? date(until) : '—',
          })
        : '';
    const was = str(change(h, 'status')?.from) as SubscriptionStatus;
    return t('subs.hist.paid', { what, sum, term, was: was ? subStatusText(t, was) : '—' });
  }
  const free = h.changes.some((c) => c.field === 'free' && c.to === true);
  const until = str(change(h, 'paidUntil')?.to) || ctx.paidUntil;
  const head = free
    ? t('subs.hist.free', { date: until ? date(until) : '—' })
    : t('subs.hist.changed');
  const list = h.changes
    .filter((c) => HIST_FIELD[c.field])
    .map((c) => {
      const label = t(HIST_FIELD[c.field]!);
      const from = 'from' in c ? subFieldValue(t, c.field, c.from, ctx.planName) : '—';
      return `${label}: ${from} → ${subFieldValue(t, c.field, c.to, ctx.planName)}`;
    });
  return `${head}${list.length ? `: ${list.join('; ')}` : ''}${h.reason ? t('subs.hist.reason', { reason: h.reason }) : ''}`;
}

/** Кто изменил подписку: сотрудник организации, администратор платформы или «Система». */
export function subHistoryWho(t: Translate, h: HistoryEntry): string {
  if (h.actor) return h.actor;
  return t(h.actorAdmin ? 'subs.who.admin' : 'subs.who.system');
}

const at = (iso: string) => {
  const d = new Date(iso);
  return { date: formatDateRu(bishkekDate(d)), time: bishkekTime(d) };
};

/** Лента «Истории изменений» подписки: сверху новые (порядок ответа сервера). */
export function subHistoryItems(t: Translate, card: AdminSubscriptionCard): TimelineItem[] {
  const names = new Map(card.plans.map((p) => [p.id, p.name]));
  const ctx = {
    planName: (id: string) => names.get(id) ?? id,
    paidUntil: card.sub?.paidUntil ?? null,
  };
  return card.history.map((h) => ({
    id: h.id,
    ...at(h.at),
    text: subHistoryText(t, h, ctx),
    who: subHistoryWho(t, h),
  }));
}

/* ── «История изменений» видов подписок и цен (прототип `subCfgLog`) ── */

type ConfigEntry = {
  id: string;
  at: string;
  entity: 'subscription_plan' | 'subscription_settings';
  action: string;
  plan: string | null;
  changes: readonly { field: string; from?: unknown; to?: unknown }[];
};

const KIND_FIELD: Record<string, UiTextKey> = {
  name: 'subs.cfg.kind.name',
  months: 'subs.cfg.kind.months',
  discountPct: 'subs.cfg.kind.discount_pct',
  sortOrder: 'subs.cfg.kind.sort_order',
};

/** Подпись поля «Цен и реквизитов» (ключ словаря — snake_case поля). */
export const SUB_PRICE_LABEL: Record<string, UiTextKey> = {
  seatPrice: 'subs.prices.f.seat_price',
  seatStep: 'subs.prices.f.seat_step',
  gbPrice: 'subs.prices.f.gb_price',
  baseGb: 'subs.prices.f.base_gb',
  seatMb: 'subs.prices.f.seat_mb',
  firstMonthPct: 'subs.prices.f.first_month_pct',
  extraDiscountOver: 'subs.prices.f.extra_discount_over',
  remindDays: 'subs.prices.f.remind_days',
  checkDays: 'subs.prices.f.check_days',
  recipient: 'subs.prices.f.recipient',
  recipientInn: 'subs.prices.f.recipient_inn',
  bank: 'subs.prices.f.bank',
  bik: 'subs.prices.f.bik',
  account: 'subs.prices.f.account',
  purpose: 'subs.prices.f.purpose',
};

/** Цены хранятся тыйынами, на экране — сомы. */
const MONEY_FIELDS = new Set(['seatPrice', 'gbPrice']);
const TEXT_FIELDS = new Set(['recipient', 'recipientInn', 'bank', 'bik', 'account', 'purpose']);

/** Строка истории видов и цен: «Виды подписок: «Квартал» — скидка 5 → 7 %», «Цены и реквизиты: …». */
export function subConfigText(t: Translate, h: ConfigEntry): string {
  if (h.entity === 'subscription_settings') {
    const list = h.changes.map((c) => {
      const key = SUB_PRICE_LABEL[c.field];
      const label = key ? t(key) : c.field;
      if (TEXT_FIELDS.has(c.field)) {
        return t('subs.cfg.text', { label, from: str(c.from), to: str(c.to) });
      }
      const v = (x: unknown) =>
        MONEY_FIELDS.has(c.field) ? formatSom(num(x), 'auto') : String(num(x));
      return t('subs.cfg.num', { label, from: v(c.from), to: v(c.to) });
    });
    return t('subs.cfg.prices', { changes: list.join('; ') });
  }
  const get = (f: string) => h.changes.find((c) => c.field === f);
  if (h.action === 'create') {
    return t('subs.cfg.kind_added', {
      name: str(get('name')?.to) || h.plan || '',
      months: num(get('months')?.to),
      disc: num(get('discountPct')?.to),
    });
  }
  if (h.action === 'delete') {
    return t('subs.cfg.kind_deleted', { name: str(get('name')?.from) || h.plan || '' });
  }
  const list = h.changes.map((c) => {
    if (c.field === 'perks') return t('subs.cfg.kind.perks');
    if (c.field === 'active') return t(c.to === true ? 'subs.cfg.kind.on' : 'subs.cfg.kind.off');
    const key = KIND_FIELD[c.field];
    return key ? t(key, { from: str(c.from), to: str(c.to) }) : c.field;
  });
  const name = str(get('name')?.to) || h.plan || '';
  return t('subs.cfg.kind_changed', { name, changes: list.join(', ') });
}

/** Лента истории видов и цен (последние 50, сверху новые). */
export function subConfigItems(t: Translate, history: readonly ConfigEntry[]): TimelineItem[] {
  return history.map((h) => ({
    id: h.id,
    ...at(h.at),
    text: subConfigText(t, h),
    who: t('subs.who.admin'),
  }));
}

/** Цена за контрагента в месяц со скидкой вида (прототип `subR2(cp × (100 − disc) / 100)`), тыйыны. */
export const subPlanPrice = (seatPrice: number, discountPct: number) =>
  Math.round((seatPrice * (100 - discountPct)) / 100);

/** Столбец списка, который собирается в браузере: текст для поиска и значение для сортировки. */
export interface LocalColumn<Row> {
  key: string;
  text: (row: Row) => string;
  /** Число сортируется как число; без него — по тексту. */
  sortValue?: (row: Row) => number;
}

/**
 * Страница списка, все записи которого уже в браузере («Виды подписок» — несколько видов; прототип
 * `grid` над `SUB_KINDS()`): сортировка, поиск по видимым столбцам и страницы — по тем же параметрам,
 * что уходят на сервер у остальных списков. Без сортировки — в порядке записей.
 */
export function localGridPage<Row>(
  rows: readonly Row[],
  params: Record<string, string>,
  columns: readonly LocalColumn<Row>[],
): GridPage<Row> {
  const raw = ListQueryParams.safeParse(params);
  const parsed = raw.success ? parseListQuery(raw.data) : null;
  const query = parsed?.ok ? parsed.query : null;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  let list = [...rows];
  const search = query?.search;
  if (search) {
    const cols = search.keys.length
      ? search.keys.flatMap((k) => byKey.get(k) ?? [])
      : [...byKey.values()];
    list = list.filter((r) => cols.some((c) => matchesSearch(c.text(r), search.q)));
  }
  const sort = query?.sort;
  const col = sort ? byKey.get(sort.key) : undefined;
  if (sort && col) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const value = col.sortValue;
    list.sort((a, b) =>
      value ? (value(a) - value(b)) * dir : col.text(a).localeCompare(col.text(b), 'ru') * dir,
    );
  }
  const size = query?.size ?? 25;
  const page = clampPage(query?.page ?? 1, list.length, size);
  const limit = pageLimit(size);
  return {
    items: list.slice((page - 1) * limit, page * limit),
    total: list.length,
    page,
    totals: {},
  };
}
