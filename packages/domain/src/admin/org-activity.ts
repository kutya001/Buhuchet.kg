/*
 * Админка → «Организации» → «Активность» (прототип v84, modules/activity.js — `actOrg`, `renderOrgAct`):
 * по каждой организации — числа за период: сколько пользователей работали, дни с активностью, входы,
 * действия, сданные отчёты и новые контрагенты. Период, его границы и столбики — общие с «Главной»
 * (`home/activity.ts`). Сами записи организаций администратору платформы не отдаются.
 */

/** Строка списка. `last` — «ГГГГ-ММ-ДД ЧЧ:ММ» по Бишкеку или null — «не было». */
export interface OrgActivityRow {
  id: string;
  name: string;
  active: boolean;
  last: string | null;
  /** Пользователей с активностью в периоде — не больше действующих сотрудников (прототип `Math.min`). */
  users: number;
  /** Действующих сотрудников. */
  staff: number;
  days: number;
  in: number;
  n: number;
  sub: number;
  cps: number;
}

/** Плашки (прототип `renderOrgAct`): организаций с активностью из стольких и суммы по организациям. */
export interface OrgActivityTotals {
  orgs: number;
  active: number;
  users: number;
  in: number;
  n: number;
  sub: number;
  cps: number;
}

export function orgActivityTotals(rows: readonly OrgActivityRow[]): OrgActivityTotals {
  const sum = (get: (r: OrgActivityRow) => number) => rows.reduce((a, r) => a + get(r), 0);
  return {
    orgs: rows.length,
    active: rows.filter((r) => r.days > 0).length,
    users: sum((r) => r.users),
    in: sum((r) => r.in),
    n: sum((r) => r.n),
    sub: sum((r) => r.sub),
    cps: sum((r) => r.cps),
  };
}
