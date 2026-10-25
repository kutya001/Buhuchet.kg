import { describe, expect, it } from 'vitest';
import {
  canSeeContractor,
  effectivePermissions,
  hasPermission,
  scopeOf,
  type AccessSubject,
} from './access';
import { PERMISSIONS, PERMISSION_IDS, SCOPE_GROUPS, type PermissionId } from './permissions';

/** Права ролей демо-организации (demoDB.json → roles). */
const ACCOUNTANT: PermissionId[] = [
  'cpView',
  'repView',
  'finView',
  'projView',
  'kpiView',
  'filesView',
  'createCp',
  'changeStatus',
  'changeSum',
  'money',
  'kpiEdit',
  'kpiImport',
  'filesUpload',
  'export',
];

function subject(
  over: Partial<Omit<AccessSubject, 'permissions'>> & { permissions?: PermissionId[] } = {},
): AccessSubject {
  return {
    employeeId: 'e3',
    isOwner: false,
    scopes: {},
    ...over,
    permissions: new Set(over.permissions ?? []),
  };
}

describe('каталог прав', () => {
  it('39 прав без повторов, у каждой группы с областью есть право просмотра', () => {
    expect(PERMISSIONS).toHaveLength(39);
    expect(new Set(PERMISSION_IDS).size).toBe(39);
    expect(SCOPE_GROUPS).toEqual(['cps', 'reports', 'fin', 'projects', 'kpi', 'files']);
  });
});

describe('hasPermission — как can() прототипа', () => {
  it('владелец имеет все 39 прав, даже без прав в роли', () => {
    const owner = subject({ isOwner: true });
    expect(effectivePermissions(owner)).toEqual([...PERMISSION_IDS]);
    expect(hasPermission(owner, 'org')).toBe(true);
  });

  it('бухгалтер: права роли действуют, чужие — нет', () => {
    const acc = subject({ permissions: ACCOUNTANT });
    expect(hasPermission(acc, 'changeStatus')).toBe(true);
    expect(hasPermission(acc, 'assign')).toBe(false);
    expect(hasPermission(acc, 'org')).toBe(false);
    expect(effectivePermissions(acc)).toHaveLength(ACCOUNTANT.length);
  });

  it('без «Просматривать …» остальные права группы не действуют', () => {
    const noView = subject({ permissions: ['projects', 'money', 'tasksCreate'] });
    expect(hasPermission(noView, 'projects')).toBe(false);
    expect(hasPermission(noView, 'money')).toBe(false);
    // У группы «Задачи» права просмотра нет — право действует само.
    expect(hasPermission(noView, 'tasksCreate')).toBe(true);
    expect(hasPermission(subject({ permissions: ['projView'] }), 'projView')).toBe(true);
  });
});

describe('scopeOf — как seeAll() прототипа', () => {
  it('по умолчанию «Свои контрагенты»', () => {
    expect(scopeOf(subject({ permissions: ACCOUNTANT }), 'cps')).toBe('own');
  });

  it('область задаётся по группам', () => {
    const s = subject({ permissions: ACCOUNTANT, scopes: { reports: 'all' } });
    expect(scopeOf(s, 'reports')).toBe('all');
    expect(scopeOf(s, 'cps')).toBe('own');
  });

  it('«Видеть все отчёты и всех контрагентов» ставит «Все» во всех группах', () => {
    const s = subject({ permissions: ['viewAll'], scopes: { cps: 'own' } });
    for (const g of SCOPE_GROUPS) expect(scopeOf(s, g)).toBe('all');
  });

  it('у владельца — «Все» во всех группах', () => {
    const owner = subject({ isOwner: true });
    for (const g of SCOPE_GROUPS) expect(scopeOf(owner, g)).toBe('all');
  });
});

describe('canSeeContractor — бухгалтер с областью «Свои» не видит чужих контрагентов и отчётов', () => {
  const mine = { responsibleEmployeeId: 'e3' };
  const foreign = { responsibleEmployeeId: 'e4' };
  const unassigned = { responsibleEmployeeId: null };

  it('«Свои»: только где сотрудник ответственный', () => {
    const acc = subject({ permissions: ACCOUNTANT });
    expect(canSeeContractor(acc, 'cps', mine)).toBe(true);
    expect(canSeeContractor(acc, 'reports', mine)).toBe(true);
    expect(canSeeContractor(acc, 'cps', foreign)).toBe(false);
    expect(canSeeContractor(acc, 'reports', foreign)).toBe(false);
    expect(canSeeContractor(acc, 'cps', unassigned)).toBe(false);
  });

  it('«Все»: все контрагенты организации', () => {
    const s = subject({ permissions: ACCOUNTANT, scopes: { cps: 'all' } });
    expect(canSeeContractor(s, 'cps', foreign)).toBe(true);
    expect(canSeeContractor(s, 'reports', foreign)).toBe(false);
  });

  it('без права просмотра группы не видно даже своих', () => {
    const s = subject({ permissions: ['cpView'], scopes: { reports: 'all' } });
    expect(canSeeContractor(s, 'reports', mine)).toBe(false);
  });

  it('владелец видит всех', () => {
    expect(canSeeContractor(subject({ isOwner: true }), 'fin', foreign)).toBe(true);
  });
});
