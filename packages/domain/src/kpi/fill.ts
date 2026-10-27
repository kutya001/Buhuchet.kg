import { diffDays, type IsoDate } from '../common/dates';
import { DUE_DAY_DEFAULT, type IndicatorScope } from './indicators';
import { addMonths, monthDay, monthOf, monthRange, type YearMonth } from './months';

/*
 * Кому и за какие месяцы показатель обязателен, статус заполнения месяца, «Не заполнено» и индикатор
 * незаполненных (ТЗ «Показатели контрагентов» → «Кому вести», «Значение показателя», «Индикатор
 * незаполненных показателей»; прототип modules/kpi.js: kOn, kStart, kOpen, kApplies, kEarly, kReq,
 * kDue, kFilled, kSync, kMissing, kMissCnt, kStats, kMonCnt, kMonList, kPeriodBar).
 */

/** Контрагент глазами показателей. */
export interface KpiContractor {
  id: string;
  /** Разовый контрагент: показатели у него не ведутся. */
  oneOff: boolean;
  archived: boolean;
  /** Периоды обслуживания по месяцам; `to` — null, пока обслуживается. Между периодами — приостановка. */
  periods: readonly { from: YearMonth; to: YearMonth | null }[];
}

/** Показатель глазами заполнения. */
export interface KpiIndicator {
  id: string;
  /** «Обязательно заполнять каждый месяц». */
  required: boolean;
  dueDay: number;
  /** «Вести с». */
  start: YearMonth;
  archived: boolean;
  scope: IndicatorScope;
  autoNew: boolean;
  /** Порядок показателей (перетаскиванием). */
  order: number;
}

/**
 * «Кому вести» у одного контрагента: ведётся ли показатель и его месяц «с <месяц>». Записи нет —
 * контрагент для показателя новый: при «Всем контрагентам» показатель ведётся, при «Выбранным» —
 * если стоит «Включать новых контрагентов автоматически».
 */
export interface KpiTarget {
  on: boolean;
  /** Свой месяц «с <месяц>»; null — поздний из «Вести с» и начала обслуживания. */
  from: YearMonth | null;
  /** Когда выключили — пометка «Не ведётся с <месяц>». */
  offSince: YearMonth | null;
}

/** Данные организации, по которым считается заполнение. */
export interface KpiBook {
  /** Все показатели организации (и в архиве). */
  indicators: readonly KpiIndicator[];
  target(indicatorId: string, contractorId: string): KpiTarget | undefined;
  hasValue(contractorId: string, indicatorId: string, month: YearMonth): boolean;
}

/** Статус заполнения месяца по контрагенту: 1 Не заполнено → 2 Заполнено → 3 Проверено. */
export type FillStatus = 'empty' | 'filled' | 'checked';

/** Не дальше скольких месяцев назад ищутся незаполненные месяцы (прототип `K_BACK`). */
export const KPI_LOOKBACK_MONTHS = 35;

/** Ведётся ли показатель у контрагента (прототип `kOn`). */
export function indicatorOn(
  indicator: Pick<KpiIndicator, 'scope' | 'autoNew'>,
  target: KpiTarget | undefined,
): boolean {
  if (target) return target.on;
  return indicator.scope === 'all' || indicator.autoNew;
}

/** Первый месяц обслуживания; пусто — периодов нет (прототип `kSvc0`). */
export function firstServiceMonth(contractor: KpiContractor): YearMonth | null {
  const months = contractor.periods.map((p) => p.from).sort();
  return months[0] ?? null;
}

/** Обслуживается ли контрагент в месяце (прототип `inService`). */
export function inService(contractor: KpiContractor, month: YearMonth): boolean {
  return contractor.periods.some((p) => p.from <= month && (p.to === null || month <= p.to));
}

/**
 * Месяц «с <месяц>» показателя у контрагента (прототип `kStart`): свой, иначе поздний из «Вести с»
 * и начала обслуживания.
 */
export function indicatorStart(
  indicator: KpiIndicator,
  target: KpiTarget | undefined,
  contractor: KpiContractor,
): YearMonth {
  if (target?.from) return target.from;
  const service = firstServiceMonth(contractor);
  return service && service > indicator.start ? service : indicator.start;
}

/** Показатель открыт для контрагента: не в архиве, контрагент не разовый и не в архиве, ведётся. */
function open(indicator: KpiIndicator, target: KpiTarget | undefined, c: KpiContractor): boolean {
  return !indicator.archived && !c.oneOff && !c.archived && indicatorOn(indicator, target);
}

/**
 * Требуется ли показатель за месяц (прототип `kApplies`): ведётся, месяц не раньше «с <месяц>» и
 * контрагент обслуживается (или месяц раньше начала обслуживания, а «с <месяц>» поставили раньше).
 * Приостановленный месяц не требуется.
 */
export function indicatorApplies(
  indicator: KpiIndicator,
  target: KpiTarget | undefined,
  contractor: KpiContractor,
  month: YearMonth,
): boolean {
  if (!open(indicator, target, contractor)) return false;
  if (month < indicatorStart(indicator, target, contractor)) return false;
  const service = firstServiceMonth(contractor) ?? '';
  return inService(contractor, month) || month < service;
}

/** Месяц раньше «с <месяц>»: значение внести можно, но оно не обязательно (прототип `kEarly`). */
export function indicatorEarly(
  indicator: KpiIndicator,
  target: KpiTarget | undefined,
  contractor: KpiContractor,
  month: YearMonth,
): boolean {
  return (
    open(indicator, target, contractor) && month < indicatorStart(indicator, target, contractor)
  );
}

/** Действующие показатели по порядку. */
export function activeIndicators(book: KpiBook): KpiIndicator[] {
  return book.indicators.filter((i) => !i.archived).sort((a, b) => a.order - b.order);
}

/**
 * Показатели, по которым считается заполнение месяца (прототип `kReq`): требуемые за месяц
 * обязательные, а если обязательных нет — все требуемые.
 */
export function monthIndicators(
  book: KpiBook,
  contractor: KpiContractor,
  month: YearMonth,
): KpiIndicator[] {
  const applying = activeIndicators(book).filter((i) =>
    indicatorApplies(i, book.target(i.id, contractor.id), contractor, month),
  );
  const required = applying.filter((i) => i.required);
  return required.length > 0 ? required : applying;
}

/** Срок заполнения месяца (прототип `kDue`): ранний «срок заполнения» его показателей в следующем месяце. */
export function fillDue(book: KpiBook, contractor: KpiContractor, month: YearMonth): IsoDate {
  const list = monthIndicators(book, contractor, month);
  const day = list.length > 0 ? Math.min(...list.map((i) => i.dueDay)) : DUE_DAY_DEFAULT;
  return monthDay(addMonths(month, 1), day);
}

/** Месяц заполнен: внесены все его показатели (прототип `kFilled`). */
export function monthFilled(book: KpiBook, contractor: KpiContractor, month: YearMonth): boolean {
  const list = monthIndicators(book, contractor, month);
  return list.length > 0 && list.every((i) => book.hasValue(contractor.id, i.id, month));
}

/**
 * Статус месяца после изменения (прототип `kSync`): не всё внесено — «Не заполнено»; всё внесено —
 * «Заполнено» сам; «Проверено» остаётся, пока значения не меняли, а правка значения возвращает его на
 * «Заполнено» и требует повторной проверки.
 */
export function nextFillStatus(current: FillStatus, filled: boolean, edited: boolean): FillStatus {
  if (!filled) return 'empty';
  if (current === 'empty' || (edited && current === 'checked')) return 'filled';
  return current;
}

/**
 * Текущий месяц заполнения — прошлый календарный месяц (ТЗ «Индикатор незаполненных показателей»):
 * за идущий месяц значения вносить можно, но незаполненным он не считается, пока не закончится.
 * По умолчанию его же показывает «Ввод за месяц».
 * Решение заказчика 27.10.2026 (docs/deviations.md п. 50): как в ТЗ; прототип (`kPrev`) берёт идущий
 * месяц, если в прошлом месяце не обслуживался ни один контрагент.
 */
export function fillMonth(today: IsoDate): YearMonth {
  return addMonths(monthOf(today), -1);
}

/** Строка «Не заполнено»: контрагент, месяц, какие обязательные показатели не внесены, срок. */
export interface MissingMonth {
  contractorId: string;
  month: YearMonth;
  /** Номера невнесённых обязательных показателей — по порядку показателей. */
  missing: string[];
  due: IsoDate;
  /** Сколько дней просрочено; 0 — срок не прошёл. */
  overdueDays: number;
}

/**
 * Незаполненные месяцы (прототип `kMissing`): по обязательным показателям, которые ведутся у
 * контрагента, от его «с <месяц>» до текущего месяца заполнения, не дальше 35 месяцев назад; разовые,
 * архивные и приостановленные месяцы не учитываются. `contractors` — в пределах области права.
 */
export function missingMonths(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  today: IsoDate,
): MissingMonth[] {
  const last = fillMonth(today);
  const lowest = addMonths(last, -KPI_LOOKBACK_MONTHS);
  const out: MissingMonth[] = [];
  for (const c of contractors) {
    const required = activeIndicators(book).filter(
      (i) => i.required && open(i, book.target(i.id, c.id), c),
    );
    if (required.length === 0) continue;
    let from = required.map((i) => indicatorStart(i, book.target(i.id, c.id), c)).sort()[0]!;
    if (from < lowest) from = lowest;
    for (const month of monthRange(from, last)) {
      const missing = required.filter(
        (i) =>
          indicatorApplies(i, book.target(i.id, c.id), c, month) &&
          !book.hasValue(c.id, i.id, month),
      );
      if (missing.length === 0) continue;
      const due = fillDue(book, c, month);
      out.push({
        contractorId: c.id,
        month,
        missing: missing.map((i) => i.id),
        due,
        overdueDays: today > due ? diffDays(today, due) : 0,
      });
    }
  }
  return out;
}

/** Индикатор незаполненных (прототип `kMissCnt`). */
export interface MissingSummary {
  /** Сколько контрагентов с незаполненными месяцами — число счётчика. */
  count: number;
  /** Есть просроченные — счётчик красный, иначе жёлтый (не заполнен только текущий месяц до срока). */
  overdue: boolean;
  /** По контрагентам: месяцы для подсказки значка «08.2026, 09.2026» и есть ли просрочка. */
  byContractor: Map<string, { months: YearMonth[]; overdue: boolean }>;
}

export function missingSummary(rows: readonly MissingMonth[]): MissingSummary {
  const byContractor = new Map<string, { months: YearMonth[]; overdue: boolean }>();
  for (const r of rows) {
    const x = byContractor.get(r.contractorId) ?? { months: [], overdue: false };
    x.months.push(r.month);
    if (r.overdueDays > 0) x.overdue = true;
    byContractor.set(r.contractorId, x);
  }
  return {
    count: byContractor.size,
    overdue: [...byContractor.values()].some((x) => x.overdue),
    byContractor,
  };
}

/** Сколько контрагентов не заполнили каждый месяц — «08.2026 · не заполнено 12» (прототип `kMonCnt`). */
export function missingByMonth(rows: readonly MissingMonth[]): Map<YearMonth, number> {
  const out = new Map<YearMonth, number>();
  for (const r of rows) out.set(r.month, (out.get(r.month) ?? 0) + 1);
  return out;
}

/**
 * Месяцы в выборе «Ввода за месяц», новые сверху (прототип `kMonList`): от текущего месяца на 24 месяца
 * назад, а если есть более ранние незаполненные — с самого раннего из них.
 */
export function monthChoices(rows: readonly MissingMonth[], today: IsoDate): YearMonth[] {
  const current = monthOf(today);
  let lowest = addMonths(current, -24);
  for (const r of rows) if (r.month < lowest) lowest = r.month;
  return monthRange(lowest, current).reverse();
}

/** Статистика модуля за месяц (прототип `kStats`). */
export interface FillStats {
  /** Контрагентов, у которых за месяц есть показатели. */
  all: number;
  /** «Заполнено» и «Проверено». */
  filled: number;
  empty: number;
  /** Не заполнено, срок прошёл. */
  overdue: number;
  checked: number;
}

/**
 * «Заполнено 86 из 104», не заполнено, просрочено, проверено. `statusOf` — сохранённый статус месяца
 * контрагента (нет — «Не заполнено»); `contractors` — в пределах области права.
 */
export function fillStats(
  book: KpiBook,
  contractors: readonly KpiContractor[],
  month: YearMonth,
  today: IsoDate,
  statusOf: (contractorId: string) => FillStatus | undefined,
): FillStats {
  const list = contractors.filter((c) => !c.oneOff && monthIndicators(book, c, month).length > 0);
  const stats: FillStats = { all: list.length, filled: 0, empty: 0, overdue: 0, checked: 0 };
  for (const c of list) {
    const status = statusOf(c.id) ?? 'empty';
    if (status === 'empty') {
      stats.empty += 1;
      if (today > fillDue(book, c, month)) stats.overdue += 1;
    } else stats.filled += 1;
    if (status === 'checked') stats.checked += 1;
  }
  return stats;
}

/** Быстрые варианты периода «За период» (прототип `kPeriodBar`). */
export type PeriodPreset = 'year' | 'prev_year' | 'last_12' | 'quarter';

export function periodPresets(
  today: IsoDate,
): { preset: PeriodPreset; from: YearMonth; to: YearMonth }[] {
  const year = Number(today.slice(0, 4));
  const last = fillMonth(today);
  const month = Number(today.slice(5, 7));
  const quarter = addMonths(monthOf(today), -((month - 1) % 3));
  return [
    { preset: 'year', from: `${year}-01`, to: `${year}-12` },
    { preset: 'prev_year', from: `${year - 1}-01`, to: `${year - 1}-12` },
    { preset: 'last_12', from: addMonths(last, -11), to: last },
    { preset: 'quarter', from: quarter, to: addMonths(quarter, 2) },
  ];
}
