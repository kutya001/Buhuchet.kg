import { addDays, type IsoDate } from '../common/dates';
import type { Tyiyn } from '../common/money';
import { monthOf, type YearMonth } from '../common/months';
import type { FeeMonth } from '../fees/charges';
import type { ReconciliationVerdict } from '../money/tax';
import type { PageSection } from '../org/policy';
import type { ReportStatus } from '../reports/rules';

/*
 * Разделы и компоновка открытой страницы контрагента (задача 2.43; ТЗ «Страница контрагента по
 * ссылке» → «Что видит контрагент», «Компоновка страницы»; прототип modules/cp-page.js, pubBody,
 * pubMoney, pubFeeTill, pubPer, pubNote). Что попадает на страницу, считает сервер по разделам,
 * которые организация и карточка контрагента не скрыли; выбор года, плашки-фильтры и «По видам / По
 * срокам» считает экран теми же функциями.
 */

/** Отметка отчёта на странице (прототип `fk`): сдан, просрочен (срок прошёл, не сдан) или впереди. */
export type PageReportMark = 'sub' | 'late' | 'next';

/** Отчёт глазами страницы: без «Не требуется» и прежних версий уточнённых (прототип `all`). */
export interface PageReportFacts {
  id: string;
  type: string;
  status: ReportStatus;
  due: IsoDate;
}

export function pageReportMark(r: Pick<PageReportFacts, 'status' | 'due'>, today: IsoDate) {
  if (r.status === 'submitted') return 'sub' as const;
  return r.due < today ? ('late' as const) : ('next' as const);
}

/** Статус на странице (прототип `pubSt`): «Требует исправления» показывается как «В работе». */
export const pageReportStatus = (
  status: PageReportStatus,
): Exclude<PageReportStatus, 'needs_fix'> => (status === 'needs_fix' ? 'in_progress' : status);

/** Статусы отчётов на странице: «Не требуется» на страницу не попадает. */
export const PAGE_REPORT_STATUSES = ['todo', 'in_progress', 'needs_fix', 'submitted'] as const;
export type PageReportStatus = (typeof PAGE_REPORT_STATUSES)[number];

/** Отчёты страницы по сроку сдачи; при равном сроке — в порядке списка (прототип `byDue`). */
export function pageReportsByDue<R extends Pick<PageReportFacts, 'due'>>(
  reports: readonly R[],
): R[] {
  return reports
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.due < b.r.due ? -1 : a.r.due > b.r.due ? 1 : a.i - b.i))
    .map(({ r }) => r);
}

const yearOf = (date: IsoDate) => date.slice(0, 4);

/** Годы срока сдачи для выбора над «Отчётами»: текущий и годы отчётов, сначала поздние. */
export function pageReportYears(reports: readonly Pick<PageReportFacts, 'due'>[], today: IsoDate) {
  return [...new Set([yearOf(today), ...reports.map((r) => yearOf(r.due))])].sort().reverse();
}

/** Отчёты года срока сдачи. */
export const pageYearReports = <R extends Pick<PageReportFacts, 'due'>>(
  reports: readonly R[],
  year: string,
): R[] => reports.filter((r) => yearOf(r.due) === year);

/** Плашки «Сдано», «Впереди», «Просрочено» — по отчётам года. */
export function pageReportCounts(
  reports: readonly Pick<PageReportFacts, 'status' | 'due'>[],
  today: IsoDate,
): Record<PageReportMark, number> {
  const out = { sub: 0, next: 0, late: 0 };
  for (const r of reports) out[pageReportMark(r, today)]++;
  return out;
}

/** Год последнего просроченного отчёта: «просрочено N» в строке состояния открывает этот год. */
export function pageLateYear(
  reports: readonly Pick<PageReportFacts, 'status' | 'due'>[],
  today: IsoDate,
): string | null {
  const late = pageReportsByDue(reports).filter((r) => pageReportMark(r, today) === 'late');
  return late.length ? yearOf(late[late.length - 1]!.due) : null;
}

/** Плитка вида отчёта в «Отчётах» (прототип: «По видам»). */
export interface PageTypeTile<R> {
  type: string;
  /** Периоды выбранного года с учётом плашки-фильтра. */
  reports: R[];
  /** «сдано N из M» и «просрочено N» — по всем отчётам вида за год. */
  submitted: number;
  total: number;
  late: number;
  /** «следующий срок …» — ближайший несданный со сроком впереди. */
  next: IsoDate | null;
}

/**
 * Плитки по видам (ТЗ «Порядок плиток: сначала виды с просрочкой, затем со сроком в ближайшие 30 дней,
 * остальные — по порядку видов»; прототип `rk`): `year` — отчёты года по сроку, `shown` — они же после
 * плашки-фильтра, `order` — коды видов в порядке каталога.
 */
export function pageTypeTiles<R extends PageReportFacts>(
  year: readonly R[],
  shown: readonly R[],
  order: readonly string[],
  today: IsoDate,
): PageTypeTile<R>[] {
  const soon = addDays(today, 30);
  const rank = (type: string) => {
    const rs = year.filter((r) => r.type === type);
    if (rs.some((r) => pageReportMark(r, today) === 'late')) return 0;
    return rs.some((r) => pageReportMark(r, today) === 'next' && r.due <= soon) ? 1 : 2;
  };
  const place = (type: string) => {
    const i = order.indexOf(type);
    return i < 0 ? order.length : i;
  };
  const types = [...new Set(shown.map((r) => r.type))].sort(
    (a, b) => rank(a) - rank(b) || place(a) - place(b),
  );
  return types.map((type) => {
    const all = year.filter((r) => r.type === type);
    return {
      type,
      reports: shown.filter((r) => r.type === type),
      submitted: all.filter((r) => pageReportMark(r, today) === 'sub').length,
      total: all.length,
      late: all.filter((r) => pageReportMark(r, today) === 'late').length,
      next: all.find((r) => pageReportMark(r, today) === 'next')?.due ?? null,
    };
  });
}

/** Группа месяца срока в «По срокам». */
export interface PageMonthGroup<R> {
  month: YearMonth;
  reports: R[];
  late: number;
}

/** «По срокам» — группы по месяцам срока (по порядку месяцев). */
export function pageMonthGroups<R extends PageReportFacts>(
  shown: readonly R[],
  today: IsoDate,
): PageMonthGroup<R>[] {
  const months = [...new Set(shown.map((r) => monthOf(r.due)))].sort();
  return months.map((month) => {
    const reports = shown.filter((r) => monthOf(r.due) === month);
    return {
      month,
      reports,
      late: reports.filter((r) => pageReportMark(r, today) === 'late').length,
    };
  });
}

/** Раскрытый сразу месяц «По срокам»: текущий или ближайший будущий, иначе последний. */
export function pageOpenMonth(months: readonly YearMonth[], today: IsoDate): YearMonth | null {
  return months.find((m) => m >= monthOf(today)) ?? months[months.length - 1] ?? null;
}

/** Периодичность вида на плитке (прототип `pubPer`). */
export type PagePeriodicity = 'M' | 'Q' | 'H' | 'Y' | 'oneoff';

export const pagePeriodicity = (t: { period: 'M' | 'Q' | 'H' | 'Y'; oneOff: boolean }) =>
  t.oneOff ? ('oneoff' as const) : t.period;

/**
 * «Что это» у вида (прототип `pubNote`): «Пояснение для контрагента», у вида без него — первое
 * предложение описания.
 */
export function pageTypeNote(t: { clientNote: string; description: string }): string {
  if (t.clientNote.trim()) return t.clientNote.trim();
  const desc = t.description;
  return (/^.*?[.!?](?=\s|$)/.exec(desc)?.[0] ?? desc).trim();
}

/* ───────────── Строка состояния и «Главное» ───────────── */

/** Замечания строки состояния (прототип `iss`); 0 — замечания нет. */
export interface PageIssues {
  /** Просроченных отчётов — при показанных «Отчётах». */
  late: number;
  /** Не хватает на налоги — при показанных «Деньгах на налоги». */
  short: Tyiyn;
  /** Долг за обслуживание — при показанной «Оплате за обслуживание». */
  feeDebt: Tyiyn;
}

/**
 * Цвет строки состояния (ТЗ «красная — если есть просроченные отчёты, жёлтая — если просрочек нет, а
 * есть только нехватка денег на налоги или долг за обслуживание»), иначе зелёная.
 */
export function pageStateTone(i: PageIssues): 'ok' | 'warn' | 'bad' {
  if (i.late > 0) return 'bad';
  return i.short > 0 || i.feeDebt > 0 ? 'warn' : 'ok';
}

/** «Оплачено по <месяц>» — последний месяц, до которого начисления оплачены без пропусков (`pubFeeTill`). */
export function pageFeePaidTill(months: readonly Pick<FeeMonth, 'month' | 'charge' | 'got'>[]) {
  let till: YearMonth | null = null;
  for (const m of months) {
    if (m.charge > 0 && m.got < m.charge) break;
    if (m.charge > 0) till = m.month;
  }
  return till;
}

/** Плитка «Главного». */
export type PageTile =
  | { key: 'reports'; wide: boolean }
  | { key: 'next'; wide: boolean }
  | { key: 'taxes'; wide: boolean }
  | { key: 'fee'; wide: boolean };

/**
 * Плитки «Главного» (прототип `T1`): «Отчёты» и «Ближайший срок» — при показанных «Отчётах», «Налоги»
 * — во всю ширину, если есть отчёты года с суммой больше 0 и показаны «Отчёты» или «Деньги на налоги»,
 * «Обслуживание» — при показанной «Оплате за обслуживание»; нечётное число плиток в две колонки —
 * последняя во всю ширину.
 */
export function pageTiles(o: { reports: boolean; taxes: boolean; fee: boolean }): PageTile[] {
  const tiles: PageTile[] = [];
  if (o.reports) tiles.push({ key: 'reports', wide: false }, { key: 'next', wide: false });
  if (o.taxes) tiles.push({ key: 'taxes', wide: true });
  if (o.fee) tiles.push({ key: 'fee', wide: false });
  const narrow = tiles.filter((t) => t.key !== 'taxes').length;
  if (narrow % 2) tiles[tiles.length - 1]!.wide = true;
  return tiles;
}

/** Плитка «Налоги {год}, сом»: к уплате, получено и оплачено по отчётам года с суммой больше 0. */
export function pageTaxTotals(
  reports: readonly { due: IsoDate; hasSum: boolean; sum: Tyiyn | null; got: Tyiyn; paid: Tyiyn }[],
  year: string,
): { due: Tyiyn; got: Tyiyn; paid: Tyiyn; count: number } {
  const list = reports.filter((r) => yearOf(r.due) === year && r.hasSum && (r.sum ?? 0) > 0);
  return {
    due: list.reduce((a, r) => a + (r.sum ?? 0), 0),
    got: list.reduce((a, r) => a + r.got, 0),
    paid: list.reduce((a, r) => a + r.paid, 0),
    count: list.length,
  };
}

/* ───────────── «Деньги на налоги», «Показатели», нижняя панель ───────────── */

/** Итог сверки на странице (прототип `v`): «Недостача», «Достаточно», «Достаточно, излишек», «Излишек». */
export type PageMoneyVerdict = ReconciliationVerdict['state'];

/** Сумма итога сверки: недостача — сколько не хватает, излишек — сколько лишнего, «Достаточно» — 0. */
export const pageVerdictAmount = (v: ReconciliationVerdict): Tyiyn =>
  v.state === 'enough' ? 0 : v.amount;

/** Месяцы года показателей до текущего включительно (прототип `ms`). */
export function pageKpiMonths(year: string, today: IsoDate): YearMonth[] {
  const current = monthOf(today);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(
    (m) => m <= current,
  );
}

/** Годы для выбора над «Показателями»: текущий и годы значений контрагента, сначала поздние. */
export function pageKpiYears(valueMonths: readonly YearMonth[], today: IsoDate): string[] {
  return [...new Set([yearOf(today), ...valueMonths.map((m) => m.slice(0, 4))])].sort().reverse();
}

/**
 * Столбики мини-графика (прототип `pubSpark`): 12 месяцев года, будущие — пусто (`undefined`), месяц
 * без значения — чёрточка у основания, последний месяц со значением — цветом акцента; высота — доля
 * от наибольшего по модулю.
 */
export function pageSpark(
  values: readonly (number | null | undefined)[],
  height = 30,
): ({ x: number; h: number; kind: 'empty' | 'current' | 'value' } | null)[] {
  const filled = values.filter((v): v is number => v !== null && v !== undefined);
  const max = Math.max(0, ...filled.map(Math.abs));
  const last = values.reduce<number>((a, v, j) => (v !== null && v !== undefined ? j : a), -1);
  return values.map((v, j) => {
    if (v === undefined) return null;
    const h = v === null || !max ? 1.5 : Math.max(1.5, (Math.abs(v) / max) * (height - 2));
    return { x: j * 8 + 1, h, kind: v === null ? 'empty' : j === last ? 'current' : 'value' };
  });
}

/** Панель разделов внизу на телефоне (прототип `nav`): только показанные, если их больше одного. */
export const PAGE_NAV = ['main', 'pay', 'reports', 'kpi', 'contacts'] as const;
export type PageNavItem = (typeof PAGE_NAV)[number];

export function pageNav(shown: ReadonlySet<PageNavItem>): PageNavItem[] {
  const items = PAGE_NAV.filter((k) => shown.has(k));
  return items.length > 1 ? items : [];
}

/** Раздел страницы виден: организация и карточка его не скрыли, функция включена. */
export const pageHas = (sections: readonly PageSection[], section: PageSection) =>
  sections.includes(section);

/**
 * Пояснения открытой страницы (прототип `PGT(группа, подпись)`): в «Текстах элементов экрана»
 * (`kbUi.page`) они записаны по группе и подписи прототипа; страница получает их уже по своим
 * обозначениям — сервер переводит, на экране русских ключей нет.
 */
export const PAGE_TIPS = {
  'secs.main': ['secs', 'Главное'],
  'secs.pay': ['secs', 'Как оплатить'],
  'secs.acc': ['secs', 'Ваш бухгалтер'],
  'secs.reports': ['secs', 'Отчёты'],
  'secs.files': ['secs', 'Файлы'],
  'secs.money': ['secs', 'Деньги на налоги'],
  'secs.fee': ['secs', 'Оплата за обслуживание'],
  'secs.kpi': ['secs', 'Показатели'],
  'secs.contacts': ['secs', 'Контакты'],
  'secs.tg': ['secs', 'Telegram'],
  'state.ok': ['state', 'Всё в порядке'],
  'state.attention': ['state', 'Нужно внимание'],
  'main.reports': ['main', 'Отчёты'],
  'main.next': ['main', 'Ближайший срок'],
  'main.taxes': ['main', 'Налоги'],
  'main.fee': ['main', 'Обслуживание'],
  'pay.tax': ['pay', 'Налоги'],
  'pay.fee': ['pay', 'Обслуживание'],
  'pay.banks': ['pay', 'Банки и кошельки'],
  'report.todo': ['report', 'К сдаче'],
  'report.in_progress': ['report', 'В работе'],
  'report.submitted': ['report', 'Сдан'],
  'report.sub': ['report', 'Сдано'],
  'report.next': ['report', 'Впереди'],
  'report.late': ['report', 'Просрочено'],
  'taxPay.unpaid': ['taxPay', 'Не оплачено'],
  'taxPay.partial': ['taxPay', 'Оплачено частично'],
  'taxPay.paid': ['taxPay', 'Оплачено'],
  'money.need': ['money', 'Нужно оплатить'],
  'money.got': ['money', 'Поступило от вас'],
  'money.paid': ['money', 'Оплачено в бюджет'],
  'money.short': ['money', 'Недостача'],
  'money.enough': ['money', 'Достаточно'],
  'money.enough_surplus': ['money', 'Достаточно, излишек'],
  'money.surplus': ['money', 'Излишек'],
  'fee.tariff': ['fee', 'Текущая ставка'],
  'fee.debt': ['fee', 'Долг'],
  'fee.unpaid': ['fee', 'Не оплачено'],
  'fee.partial': ['fee', 'Оплачено частично'],
  'fee.paid': ['fee', 'Оплачено'],
  'contacts.data': ['contacts', 'Ваши данные у нас'],
  'head.as_of': ['head', 'Данные на'],
} as const satisfies Record<string, readonly [string, string]>;

export type PageTipId = keyof typeof PAGE_TIPS;

/** Пояснения страницы по её обозначениям из «Текстов элементов экрана»; пустых нет. */
export function pageTipTexts(
  screen: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Partial<Record<PageTipId, string>> {
  const out: Partial<Record<PageTipId, string>> = {};
  for (const [id, [group, label]] of Object.entries(PAGE_TIPS) as [
    PageTipId,
    readonly [string, string],
  ][]) {
    const text = screen[group]?.[label]?.trim();
    if (text) out[id] = text;
  }
  return out;
}
