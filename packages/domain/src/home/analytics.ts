import type { IsoDate } from '../common/dates';
import type { YearMonth } from '../common/months';
import type { Tyiyn } from '../common/money';

/*
 * «Главная» → «Аналитика»: выручка по контрагентам (задача 2.34; ТЗ «Главная» → «Вкладка «Аналитика»»;
 * прототип modules/analytics.js: `revenueData`, `renderAnalytics`, `monthChart`, `shareChart`).
 * Выручка — оплаты от контрагентов за обслуживание, по проектам и за разовые услуги по дате оплаты;
 * налоги контрагентов сюда не входят. Начисления за обслуживание — по правилам платы за обслуживание
 * (`contractorFees`), долг — долг за обслуживание и недоплата разовых услуг сейчас.
 */

/** Виды выручки по порядку (прототип `REV`): обслуживание, проекты, разовые услуги. */
export const REVENUE_KINDS = ['fee', 'proj', 'svc'] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];

/** Суммы месяца по видам выручки: [обслуживание, проекты, разовые услуги]. */
export type RevenueMonth = [Tyiyn, Tyiyn, Tyiyn];

/** Контрагент для аналитики: начисления за обслуживание по месяцам и долги сейчас. */
export interface RevenueContractor {
  id: string;
  name: string;
  responsible: string | null;
  oneOff: boolean;
  archived: boolean;
  /** Начисления за обслуживание по месяцам (`contractorFees(...).months`); у разового — нет. */
  charges: readonly { month: YearMonth; charge: Tyiyn }[];
  /** Долг за обслуживание сейчас (прототип `c.feeDebt`). */
  feeDebt: Tyiyn;
  /** Недоплата разовых услуг сейчас (прототип `svcDebt`). */
  serviceDebt: Tyiyn;
}

/** Оплата от контрагента: вид выручки, дата оплаты и сумма. */
export interface RevenuePayment {
  contractorId: string;
  kind: RevenueKind;
  date: IsoDate;
  amount: Tyiyn;
}

/** Строка выручки контрагента за год (прототип `revenueData`: строка `rows`). */
export interface RevenueRow {
  id: string;
  name: string;
  responsible: string | null;
  oneOff: boolean;
  archived: boolean;
  /** Начислено за обслуживание за год (по текущий месяц, если год текущий). */
  feeCh: Tyiyn;
  fee: Tyiyn;
  proj: Tyiyn;
  svc: Tyiyn;
  /** Итого получено: обслуживание + проекты + разовые услуги. */
  total: Tyiyn;
  /** Долг сейчас: за обслуживание и по разовым услугам. */
  debt: Tyiyn;
  /** Выручка по месяцам года (12 месяцев). */
  months: RevenueMonth[];
}

const emptyMonths = (): RevenueMonth[] => Array.from({ length: 12 }, () => [0, 0, 0]);

/** Последний месяц года, который уже наступил: текущий в текущем году, иначе декабрь. */
export function revenueLastMonth(year: number, today: IsoDate): YearMonth {
  return String(year) === today.slice(0, 4) ? today.slice(0, 7) : `${year}-12`;
}

/**
 * Выручка контрагентов за год (прототип `revenueData`): оплаты по месяцам и видам, начислено за
 * обслуживание за месяцы года по последний наступивший, долг сейчас. Оплаты чужих контрагентов (вне
 * области) не учитываются.
 */
export function revenueRows(
  contractors: readonly RevenueContractor[],
  payments: readonly RevenuePayment[],
  year: number,
  today: IsoDate,
): RevenueRow[] {
  const ys = String(year);
  const lastM = revenueLastMonth(year, today);
  const rows = contractors.map((c): RevenueRow => ({
    id: c.id,
    name: c.name,
    responsible: c.responsible,
    oneOff: c.oneOff,
    archived: c.archived,
    feeCh: c.oneOff
      ? 0
      : c.charges
          .filter((m) => m.month.startsWith(ys) && m.month <= lastM)
          .reduce((a, m) => a + m.charge, 0),
    fee: 0,
    proj: 0,
    svc: 0,
    total: 0,
    debt: c.feeDebt + c.serviceDebt,
    months: emptyMonths(),
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const p of payments) {
    if (!p.date.startsWith(ys)) continue;
    const r = byId.get(p.contractorId);
    if (!r) continue;
    const month = r.months[Number(p.date.slice(5, 7)) - 1]!;
    month[REVENUE_KINDS.indexOf(p.kind) as 0 | 1 | 2] += p.amount;
    r[p.kind] += p.amount;
  }
  for (const r of rows) r.total = r.fee + r.proj + r.svc;
  return rows;
}

/** Строка списка «Аналитики» (прототип: сетка `an-cps`): выручка за год, доля и прошлый год. */
export interface RevenueGridRow extends Omit<RevenueRow, 'months'> {
  /** Доля в выручке организации, %, с одним знаком (прототип `share`). */
  share: number;
  /** Итого получено за прошлый год. */
  prev: Tyiyn;
  /** Изменение к прошлому году, %; null — в прошлом году оплат не было. */
  change: number | null;
}

/**
 * Строки списка (прототип `rows` сетки `an-cps`): контрагенты, у которых в году есть выручка, начисления
 * или долг сейчас, или была выручка в прошлом году.
 */
export function revenueGridRows(
  rows: readonly RevenueRow[],
  prevRows: readonly RevenueRow[],
): RevenueGridRow[] {
  const tot = rows.reduce((a, r) => a + r.total, 0);
  const prev = new Map(prevRows.map((r) => [r.id, r.total]));
  return rows
    .filter((r) => r.total > 0 || r.feeCh > 0 || r.debt > 0 || (prev.get(r.id) ?? 0) > 0)
    .map(({ months: _months, ...r }) => {
      const p = prev.get(r.id) ?? 0;
      return {
        ...r,
        share: tot ? Math.round((r.total / tot) * 1000) / 10 : 0,
        prev: p,
        change: p ? Math.round(((r.total - p) / p) * 100) : null,
      };
    });
}

/** Контрагент в «Топ-10 по выручке»: суммы по видам и всего. */
export interface RevenueTop {
  id: string;
  name: string;
  fee: Tyiyn;
  proj: Tyiyn;
  svc: Tyiyn;
  total: Tyiyn;
}

/** Плашки, график и «Концентрация» «Аналитики» за год (прототип `renderAnalytics`). */
export interface RevenueOverview {
  year: number;
  /** Год текущий: «Выручка за 2026 (с начала года)», месяцы после текущего — бледные. */
  current: boolean;
  /** Последний наступивший месяц, 0–11. */
  lastMonth: number;
  feeCh: Tyiyn;
  fee: Tyiyn;
  proj: Tyiyn;
  svc: Tyiyn;
  total: Tyiyn;
  debt: Tyiyn;
  /** «оплачено N %» под «Начислено за обслуживание». */
  feePaidPercent: number;
  /** Доля вида в выручке, %; null — выручки нет (пояснения нет). */
  shares: Record<RevenueKind, number> | null;
  /** «+N % к тому же периоду» прошлого года; null — в прошлом году за те же месяцы оплат не было. */
  change: number | null;
  /** Выручка по месяцам и видам. */
  months: RevenueMonth[];
  /** Выручка прошлого года по месяцам — столбики сравнения. */
  prevMonths: Tyiyn[];
  top: RevenueTop[];
  /** «Платили в 2026»: контрагентов с выручкой за год. */
  paid: number;
  /** «Доля топ-5», %. */
  top5Percent: number;
  /** «Средний чек за год». */
  average: Tyiyn;
  /** «Долг за обслуживание сейчас»: у контрагентов не в архиве. */
  feeDebt: Tyiyn;
}

/** Сколько контрагентов в «Топ-10» (прототип `shareChart`: `slice(0, 10)`). */
export const REVENUE_TOP = 10;

/**
 * Итоги «Аналитики» (прототип `renderAnalytics`): суммы по видам, доля оплаченного начисленного,
 * изменение к тому же периоду прошлого года (месяцы прошлого года по последний наступивший месяц
 * выбранного), выручка по месяцам, «Топ-10», «Концентрация».
 */
export function revenueOverview(
  rows: readonly RevenueRow[],
  prevRows: readonly RevenueRow[],
  contractors: readonly Pick<RevenueContractor, 'archived' | 'feeDebt'>[],
  year: number,
  today: IsoDate,
): RevenueOverview {
  const sum = (k: 'feeCh' | 'fee' | 'proj' | 'svc' | 'total' | 'debt') =>
    rows.reduce((a, r) => a + r[k], 0);
  const total = sum('total');
  const feeCh = sum('feeCh');
  const fee = sum('fee');
  const current = String(year) === today.slice(0, 4);
  const lastMonth = current ? Number(today.slice(5, 7)) - 1 : 11;
  const months = emptyMonths();
  for (const r of rows) {
    r.months.forEach((m, i) => {
      const total = months[i]!;
      total[0] += m[0];
      total[1] += m[1];
      total[2] += m[2];
    });
  }
  const prevMonths = Array.from({ length: 12 }, (_, i) =>
    prevRows.reduce((a, r) => a + r.months[i]![0] + r.months[i]![1] + r.months[i]![2], 0),
  );
  const ytdPrev = prevMonths.slice(0, lastMonth + 1).reduce((a, v) => a + v, 0);
  const sorted = rows.filter((r) => r.total > 0).toSorted((a, b) => b.total - a.total);
  const top5 = sorted.slice(0, 5).reduce((a, r) => a + r.total, 0);
  const shareOf = (v: Tyiyn) => Math.round((v / total) * 100);
  return {
    year,
    current,
    lastMonth,
    feeCh,
    fee,
    proj: sum('proj'),
    svc: sum('svc'),
    total,
    debt: sum('debt'),
    feePaidPercent: feeCh ? Math.round((fee / feeCh) * 100) : 0,
    shares: total
      ? { fee: shareOf(fee), proj: shareOf(sum('proj')), svc: shareOf(sum('svc')) }
      : null,
    change: ytdPrev ? Math.round(((total - ytdPrev) / ytdPrev) * 100) : null,
    months,
    prevMonths,
    top: sorted
      .slice(0, REVENUE_TOP)
      .map(({ id, name, fee, proj, svc, total }) => ({ id, name, fee, proj, svc, total })),
    paid: sorted.length,
    top5Percent: total ? Math.round((top5 / total) * 100) : 0,
    average: sorted.length ? Math.round(total / sorted.length) : 0,
    feeDebt: contractors
      .filter((c) => !c.archived && c.feeDebt > 0)
      .reduce((a, c) => a + c.feeDebt, 0),
  };
}

/**
 * Шаг сетки графика (прототип `niceStep`): четверть максимума, округлённая до 1, 2, 2,5, 5 или 10 в
 * своём разряде.
 */
export function chartStep(max: number): number {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/**
 * Подпись оси графика в сомах (прототип `kSom`): от миллиона — «1,2 млн», от тысячи — «12 тыс.», иначе
 * число. `unit` — какой текст словаря подставить.
 */
export function chartAxisLabel(som: number): { n: string; unit: 'mln' | 'k' | null } {
  if (som >= 1e6) {
    return { n: (som / 1e6).toFixed(1).replace('.', ',').replace(',0', ''), unit: 'mln' };
  }
  if (som >= 1000) return { n: String(Math.round(som / 1000)), unit: 'k' };
  return { n: String(som), unit: null };
}

/** Годы, которые можно выбрать (прототип: текущий и прошлый). */
export function revenueYears(today: IsoDate): number[] {
  const y = Number(today.slice(0, 4));
  return [y, y - 1];
}
