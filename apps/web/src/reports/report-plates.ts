import { addDays, type ListFilterValue } from '@buhuchet/domain';

/** Плашки «Сдано в этом месяце» и «К уплате за <месяц>» ставят фильтр на «Все отчёты» (адрес `?plate=`). */
export type PlateFilter = 'submitted' | 'to_pay';

export const isPlateFilter = (v: string | null): v is PlateFilter =>
  v === 'submitted' || v === 'to_pay';

/** Последний день месяца по его первому числу. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** Фильтры плашки (прототип renderReports: `subm` — статус и дата сдачи, `sum` — срок оплаты). */
export function plateFilters(plate: PlateFilter, month: string): Record<string, ListFilterValue> {
  const range = { type: 'date' as const, from: month, to: monthEnd(month) };
  return plate === 'submitted'
    ? { status: { type: 'enum', vals: ['submitted'] }, submitted: range }
    : { payDue: range };
}
