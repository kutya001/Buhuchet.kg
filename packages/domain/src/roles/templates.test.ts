import { describe, expect, it } from 'vitest';
import { effectivePermissions } from './access';
import { PERMISSION_IDS, SCOPE_GROUPS } from './permissions';
import {
  OWNER_ROLE_NAME,
  normalizeRolePermissions,
  normalizeScopes,
  rolesForNewOrganization,
  type RoleTemplate,
} from './templates';

/** Шаблоны ролей платформы (refDB.json → roleTemplates). */
const TEMPLATES: RoleTemplate[] = [
  {
    code: 'chief',
    name: 'Главный бухгалтер',
    permissions: [
      'cpView',
      'createCp',
      'cpImport',
      'cpPause',
      'fee',
      'tariff',
      'cpPage',
      'repView',
      'assign',
      'repDue',
      'changeStatus',
      'changeSum',
      'repConfirm',
      'finView',
      'money',
      'bonus',
      'projView',
      'projects',
      'kpiView',
      'kpiEdit',
      'kpiImport',
      'indSetup',
      'indCheck',
      'tasksCreate',
      'tasksAll',
      'tasksConfirm',
      'filesView',
      'filesUpload',
      'filesDelete',
      'staffView',
      'dicts',
      'kbLevels',
      'viewAll',
      'export',
    ],
    scopes: { cps: 'all', reports: 'all', fin: 'all', projects: 'all', kpi: 'all', files: 'all' },
  },
  {
    code: 'acc',
    name: 'Бухгалтер',
    permissions: [
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
    ],
    scopes: { cps: 'own', reports: 'own', fin: 'own', projects: 'own', kpi: 'own', files: 'own' },
  },
];

describe('rolesForNewOrganization', () => {
  const roles = rolesForNewOrganization(TEMPLATES);

  it('владелец и копии шаблонов «Главный бухгалтер» и «Бухгалтер»', () => {
    expect(roles.map((r) => [r.name, r.isOwner, r.templateCode])).toEqual([
      [OWNER_ROLE_NAME, true, null],
      ['Главный бухгалтер', false, 'chief'],
      ['Бухгалтер', false, 'acc'],
    ]);
  });

  it('владелец имеет все 39 прав', () => {
    const owner = roles[0]!;
    const all = effectivePermissions({
      employeeId: 'e1',
      isOwner: owner.isOwner,
      permissions: new Set(owner.permissions),
      scopes: owner.scopes,
    });
    expect(all).toHaveLength(39);
  });

  it('главный бухгалтер — всё, кроме прав владельца, «Сотрудников и ролей», отката и архива; «Все»', () => {
    const chief = roles[1]!;
    expect(PERMISSION_IDS.filter((p) => !chief.permissions.includes(p))).toEqual([
      'cpArchive',
      'archiveRest',
      'staff',
      'org',
      'rollback',
    ]);
    expect(Object.values(chief.scopes)).toEqual(SCOPE_GROUPS.map(() => 'all'));
  });

  it('бухгалтер — права шаблона и «Свои» во всех группах', () => {
    const acc = roles[2]!;
    expect(acc.permissions).toHaveLength(14);
    expect(acc.permissions).toContain('changeStatus');
    expect(Object.values(acc.scopes)).toEqual(SCOPE_GROUPS.map(() => 'own'));
  });
});

describe('нормализация шаблона', () => {
  it('неизвестные права и «только у владельца» не переносятся, порядок — как в каталоге', () => {
    expect(normalizeRolePermissions(['export', 'org', 'nope', 'cpView'])).toEqual([
      'cpView',
      'export',
    ]);
  });

  it('область: недостающие и неверные значения — «Свои»', () => {
    expect(normalizeScopes({ cps: 'all', reports: 'everything', zzz: 'all' })).toEqual({
      cps: 'all',
      reports: 'own',
      fin: 'own',
      projects: 'own',
      kpi: 'own',
      files: 'own',
    });
    expect(normalizeScopes(undefined).cps).toBe('own');
  });
});
