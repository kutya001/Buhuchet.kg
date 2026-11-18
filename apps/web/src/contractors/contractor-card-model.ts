/*
 * Правила карточки контрагента без React: маленькие карточки «что горит» вверху «Основного»
 * (прототип v142 `.cp-hot`, modules/contractor-card.js).
 */

/** Вкладка, которую открывает маленькая карточка. */
export type HotTab = 'reports' | 'money' | 'fee';

export type HotKind = 'overdue' | 'owe' | 'avail' | 'fee';

export interface HotPlate {
  kind: HotKind;
  tab: HotTab;
  /** Число отчётов или сумма в тыйынах. */
  value: number;
  /** Красная карточка с красным числом: просрочка и долг. */
  danger: boolean;
  /** «Осталось оплатить» больше, чем лежит на счёте: карточка оранжевая, иначе жёлтая. */
  short: boolean;
}

/**
 * Какие карточки показать и в каком порядке: «Просрочено отчётов», «Осталось оплатить», «На счёте»,
 * «Долг за обслуживание». Карточка есть, только когда число больше нуля и у сотрудника есть её вкладка
 * (вкладки нет — сервер числа не отдал: нет функции или права).
 */
export function hotPlates(o: {
  overdue: number;
  /** null — денег на налоги сотрудник не видит. */
  owe: number | null;
  avail: number | null;
  /** null — платы за обслуживание сотрудник не видит. */
  feeDebt: number | null;
  tabs: ReadonlySet<string>;
}): HotPlate[] {
  const hot: HotPlate[] = [];
  const owe = o.tabs.has('money') ? (o.owe ?? 0) : 0;
  const avail = o.tabs.has('money') ? (o.avail ?? 0) : 0;
  const debt = o.tabs.has('fee') ? (o.feeDebt ?? 0) : 0;
  if (o.overdue > 0 && o.tabs.has('reports')) {
    hot.push({ kind: 'overdue', tab: 'reports', value: o.overdue, danger: true, short: false });
  }
  if (owe > 0) {
    hot.push({ kind: 'owe', tab: 'money', value: owe, danger: false, short: owe > avail });
  }
  if (avail > 0) {
    hot.push({ kind: 'avail', tab: 'money', value: avail, danger: false, short: false });
  }
  if (debt > 0) hot.push({ kind: 'fee', tab: 'fee', value: debt, danger: true, short: false });
  return hot;
}
