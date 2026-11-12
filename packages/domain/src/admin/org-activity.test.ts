import { describe, expect, it } from 'vitest';
import { orgActivityTotals, type OrgActivityRow } from './org-activity';

const row = (patch: Partial<OrgActivityRow>): OrgActivityRow => ({
  id: 'o',
  name: 'Организация',
  active: true,
  last: null,
  users: 0,
  staff: 0,
  days: 0,
  in: 0,
  n: 0,
  sub: 0,
  cps: 0,
  ...patch,
});

describe('Админка → «Организации» → «Активность»: плашки', () => {
  it('организаций с активностью — у кого есть дни; остальное — суммы по организациям', () => {
    expect(
      orgActivityTotals([
        row({ id: 'a', days: 3, users: 2, staff: 4, in: 5, n: 40, sub: 6, cps: 1 }),
        row({ id: 'b', days: 1, users: 1, staff: 1, in: 1, n: 2 }),
        // Без входов и действий, но с отчётом, сданным за неё: в «организациях с активностью» её нет.
        row({ id: 'c', active: false, sub: 1 }),
      ]),
    ).toEqual({ orgs: 3, active: 2, users: 3, in: 6, n: 42, sub: 7, cps: 1 });
  });

  it('организаций нет — нули', () => {
    expect(orgActivityTotals([])).toEqual({
      orgs: 0,
      active: 0,
      users: 0,
      in: 0,
      n: 0,
      sub: 0,
      cps: 0,
    });
  });
});
