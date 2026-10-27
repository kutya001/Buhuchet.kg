import type { IsoDate } from '../common/dates';
import { indicatorOn, type KpiIndicator, type KpiTarget } from './fill';
import type { IndicatorScope } from './indicators';
import { monthOf, type YearMonth } from '../common/months';

/*
 * «Кому вести»: включение и выключение показателя у контрагента — галочкой во вкладке «Кому вести»,
 * переключателем «Вести» в карточке контрагента, массово по фильтру и при сохранении окна показателя
 * (ТЗ «Показатели контрагентов» → «Кому вести»; прототип modules/kpi.js: kSetOn, kWhoApply).
 *
 * Запись «Кому вести» есть только там, где она что-то меняет: при «Всем контрагентам» — у выключенных
 * и у тех, кому поставили свой месяц «с <месяц>»; при «Выбранным» — у каждого контрагента, который был
 * на момент выбора (отмечен — ведётся, нет — не ведётся). Нет записи — контрагент для показателя новый.
 * Разовых контрагентов в «Кому вести» нет: записей у них нет, показатель у них не требуется.
 */

/**
 * С какого месяца показатель требуется, когда его снова включают у контрагента (ТЗ: «он требуется с
 * текущего месяца (месяц можно изменить в «с <месяц>»)»).
 * Решение заказчика 27.10.2026 (docs/deviations.md п. В-3): как в ТЗ; прототип ставит прошлый месяц.
 */
export function reenableMonth(today: IsoDate): YearMonth {
  return monthOf(today);
}

/**
 * Включить или выключить показатель у одного контрагента (прототип `kSetOn`). Уже так — `null`
 * (ничего не меняется, в историю не пишется). Включение снимает пометку «Не ведётся с …» и ставит
 * «с <месяц>» — текущий месяц; выключение ставит «Не ведётся с <текущий месяц>», внесённые значения
 * остаются.
 */
export function toggleTarget(
  indicator: Pick<KpiIndicator, 'scope' | 'autoNew'>,
  current: KpiTarget | undefined,
  on: boolean,
  today: IsoDate,
): KpiTarget | null {
  if (indicatorOn(indicator, current) === on) return null;
  if (on) return { on: true, from: reenableMonth(today), offSince: null };
  return { on: false, from: current?.from ?? null, offSince: monthOf(today) };
}

/** «Включать новых контрагентов автоматически»: при «Всем контрагентам» включено всегда. */
export function whoAutoNew(scope: IndicatorScope, autoNew: boolean): boolean {
  return scope === 'all' || autoNew;
}

/** Контрагент после сохранения «Кому вести» в окне показателя. */
export interface WhoChange {
  contractorId: string;
  /** Вёлся ли до сохранения; `null` — показатель новый. */
  before: boolean | null;
  after: boolean;
  /** Запись «Кому вести» после сохранения; `null` — записи нет (снять, если была). */
  target: KpiTarget | null;
}

/**
 * Сохранение «Кому вести» из окна показателя (прототип `kWhoApply`). `previous` — показатель до правки,
 * `null` — новый. «Всем» → «Всем» не меняет выключенных; переход на «Всем» включает всех, а у тех, кто
 * не вёлся, ставит «с <месяц>» — текущий месяц; «Выбранным» ведётся у отмеченных, у остальных — нет,
 * у снятых — «Не ведётся с <текущий месяц>». `contractors` — все неразовые контрагенты организации (и в
 * архиве). В историю показателя и контрагента пишутся строки, где `before` не `null` и не равно `after`.
 */
export function applyWho(
  previous: Pick<KpiIndicator, 'scope' | 'autoNew'> | null,
  scope: IndicatorScope,
  selected: ReadonlySet<string>,
  contractors: readonly { id: string }[],
  targetOf: (contractorId: string) => KpiTarget | undefined,
  today: IsoDate,
): WhoChange[] {
  const stayAll = previous?.scope === 'all' && scope === 'all';
  return contractors.map((c) => {
    const t = previous ? targetOf(c.id) : undefined;
    const before = previous ? indicatorOn(previous, t) : null;
    const after = scope === 'selected' ? selected.has(c.id) : stayAll ? before! : true;
    let from = t?.from ?? null;
    let offSince = scope === 'all' && !stayAll ? null : (t?.offSince ?? null);
    if (after) {
      offSince = null;
      if (before === false) from = reenableMonth(today);
    } else if (before) offSince = monthOf(today);
    const keep = scope === 'selected' || !after || from !== null;
    return {
      contractorId: c.id,
      before,
      after,
      target: keep ? { on: after, from, offSince } : null,
    };
  });
}
