import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/role-locks.json';
import type { AccessSubject } from './access';
import {
  copiedRolePermissions,
  hasOwnerGrantedPermission,
  ROLE_CHANGE_MESSAGES,
  ROLE_LOCK_MESSAGES,
  roleChangeProblem,
  rolePermissionCount,
  rolePermissionLock,
  roleWithinRights,
  type RoleLock,
} from './editing';
import { PERMISSION_IDS, type PermissionId } from './permissions';

const LOCK_BY_MESSAGE = new Map(
  Object.entries(ROLE_LOCK_MESSAGES).map(([lock, message]) => [message, lock as RoleLock]),
);

const set = (...p: PermissionId[]) => new Set<PermissionId>(p);

const ownerSubject: AccessSubject = {
  employeeId: 'e-owner',
  isOwner: true,
  permissions: set(),
  scopes: {},
};
/** Кадровик: «Сотрудники и роли», контрагенты — «Все», отчёты — «Свои», финансов и «Видеть все» нет. */
const hrSubject: AccessSubject = {
  employeeId: 'e-hr',
  isOwner: false,
  permissions: set(
    'cpView',
    'createCp',
    'repView',
    'assign',
    'tasksCreate',
    'staffView',
    'staff',
    'dicts',
    'export',
  ),
  scopes: { cps: 'all', reports: 'own' },
};
const owner = { isOwner: true, roleId: 'owner', subject: ownerSubject };
const hr = { isOwner: false, roleId: 'hr', subject: hrSubject };
const accRole = { id: 'acc', isOwner: false };

describe('rolePermissionLock — как roleLock прототипа', () => {
  const roles = fixture.roles as Record<string, { isOwner: boolean; permissions: PermissionId[] }>;
  const editors = new Map(fixture.editors.map((e) => [e.employee, e]));

  it(`${fixture.cases.length} ответов прототипа на ролях demoDB совпадают`, () => {
    for (const [employee, roleId, permission, selected, message] of fixture.cases as [
      string,
      string,
      PermissionId,
      'role' | 'empty',
      string,
    ][]) {
      const editor = editors.get(employee)!;
      const role = roles[roleId]!;
      const set = new Set(selected === 'role' ? role.permissions : []);
      const lock = rolePermissionLock(
        { isOwner: editor.isOwner, roleId: editor.roleId },
        { id: roleId, isOwner: role.isOwner },
        permission,
        set,
      );
      expect(
        { employee, roleId, permission, selected, lock },
        `${employee} → ${roleId}.${permission}`,
      ).toEqual({
        employee,
        roleId,
        permission,
        selected,
        lock: message ? LOCK_BY_MESSAGE.get(message) : null,
      });
    }
  });

  it('без набора отмеченных «Сначала дайте просмотр» не проверяется', () => {
    expect(rolePermissionLock(owner, accRole, 'createCp')).toBeNull();
    expect(rolePermissionLock(owner, accRole, 'createCp', new Set())).toBe('view_required');
  });
});

describe('roleChangeProblem — сохранение роли на сервере', () => {
  it('роль владельца не меняется никем; свою роль не владелец не меняет', () => {
    expect(roleChangeProblem(owner, { id: 'owner', isOwner: true }, set(), set())).toEqual({
      lock: 'owner_role',
    });
    expect(roleChangeProblem(hr, { id: 'hr', isOwner: false }, set(), set())).toEqual({
      lock: 'own_role',
    });
    expect(
      roleChangeProblem(owner, { id: 'owner-role-of-other', isOwner: false }, set(), set()),
    ).toBeNull();
  });

  it('добавить право группы можно только вместе с просмотром', () => {
    expect(roleChangeProblem(owner, accRole, set(), set('createCp'))).toEqual({
      lock: 'view_required',
      permission: 'createCp',
    });
    expect(roleChangeProblem(owner, accRole, set(), set('cpView', 'createCp'))).toBeNull();
    // Права групп без просмотра («Задачи», «Справочники», «Общие права») — без условия.
    expect(
      roleChangeProblem(owner, accRole, set(), set('tasksCreate', 'dicts', 'export')),
    ).toBeNull();
  });

  it('право только владельца не выдаётся никому, даже владельцем', () => {
    expect(roleChangeProblem(owner, accRole, set(), set('org'))).toEqual({
      lock: 'owner_only',
      permission: 'org',
    });
  });

  it('права, которые выдаёт только владелец: не владелец не добавляет', () => {
    expect(roleChangeProblem(hr, accRole, set(), set('rollback'))).toEqual({
      lock: 'owner_granted',
      permission: 'rollback',
    });
    expect(
      roleChangeProblem(owner, accRole, set(), set('staffView', 'staff', 'rollback')),
    ).toBeNull();
  });

  it('роль с правами, которые выдаёт только владелец, меняет только владелец — целиком', () => {
    const problem = { lock: 'owner_granted_role' };
    // Снять само право, погасить его снятием просмотра, расширить такую роль — нельзя.
    expect(roleChangeProblem(hr, accRole, set('staffView', 'staff'), set('staffView'))).toEqual(
      problem,
    );
    expect(roleChangeProblem(hr, accRole, set('staffView', 'staff'), set('staff'))).toEqual(
      problem,
    );
    expect(roleChangeProblem(hr, accRole, set('rollback'), set('rollback', 'export'))).toEqual(
      problem,
    );
    expect(
      roleChangeProblem(hr, accRole, set('cpView', 'archiveRest'), set('cpView', 'archiveRest'), {
        cps: 'all',
      }),
    ).toEqual(problem);
    expect(
      roleChangeProblem(owner, accRole, set('staffView', 'staff'), set('staffView')),
    ).toBeNull();
  });

  it('не владелец добавляет только права, которые действуют у него самого', () => {
    expect(roleChangeProblem(hr, accRole, set(), set('cpView', 'createCp', 'export'))).toBeNull();
    expect(roleChangeProblem(hr, accRole, set(), set('finView', 'money'))).toEqual({
      lock: 'beyond_own',
      permission: 'finView',
    });
    expect(roleChangeProblem(hr, accRole, set('export'), set('export', 'viewAll'))).toEqual({
      lock: 'beyond_own',
      permission: 'viewAll',
    });
    expect(roleChangeProblem(owner, accRole, set(), set('finView', 'money', 'viewAll'))).toBeNull();
  });

  it('область «Все контрагенты» не владелец даёт только там, где она есть у него', () => {
    expect(roleChangeProblem(hr, accRole, set(), set(), { cps: 'all', reports: 'own' })).toBeNull();
    expect(roleChangeProblem(hr, accRole, set(), set(), { reports: 'all' })).toEqual({
      lock: 'beyond_own_scope',
      group: 'reports',
    });
    expect(roleChangeProblem(owner, accRole, set(), set(), { reports: 'all' })).toBeNull();
  });

  it('снять право можно, права группы без просмотра остаются и не действуют', () => {
    expect(roleChangeProblem(hr, accRole, set('cpView', 'createCp'), set('createCp'))).toBeNull();
    expect(roleChangeProblem(hr, accRole, set('finView', 'money'), set())).toBeNull();
  });

  it('у каждой причины есть текст', () => {
    for (const lock of [
      ...Object.keys(ROLE_LOCK_MESSAGES),
      'owner_granted_role',
      'beyond_own',
      'beyond_own_scope',
    ]) {
      expect(ROLE_CHANGE_MESSAGES[lock as keyof typeof ROLE_CHANGE_MESSAGES]).toBeTruthy();
    }
  });
});

describe('roleWithinRights — роль не шире своих прав', () => {
  const role = (permissions: PermissionId[], scopes = {}) => ({
    isOwner: false,
    permissions,
    scopes,
  });

  it('владельцу можно любую роль; роль владельца не владельцу не по силам', () => {
    expect(roleWithinRights(ownerSubject, { isOwner: true, permissions: [], scopes: {} })).toBe(
      true,
    );
    expect(roleWithinRights(ownerSubject, role(['viewAll', 'money'], { fin: 'all' }))).toBe(true);
    expect(roleWithinRights(hrSubject, { isOwner: true, permissions: [], scopes: {} })).toBe(false);
  });

  it('считаются действующие права роли', () => {
    expect(roleWithinRights(hrSubject, role(['cpView', 'createCp', 'export']))).toBe(true);
    expect(roleWithinRights(hrSubject, role(['finView']))).toBe(false);
    expect(roleWithinRights(hrSubject, role(['export', 'viewAll']))).toBe(false);
    // «Вносить деньги» без «Просматривать финансы» не действует — роль не шире.
    expect(roleWithinRights(hrSubject, role(['cpView', 'money']))).toBe(true);
  });

  it('область «Все» — только в группах, где она есть у того, кто действует', () => {
    expect(roleWithinRights(hrSubject, role(['cpView'], { cps: 'all' }))).toBe(true);
    expect(roleWithinRights(hrSubject, role(['repView'], { reports: 'all' }))).toBe(false);
    // Область группы без её просмотра ничего не открывает.
    expect(roleWithinRights(hrSubject, role(['cpView'], { reports: 'all', projects: 'all' }))).toBe(
      true,
    );
    const seesAll: AccessSubject = { ...hrSubject, permissions: set('repView', 'viewAll') };
    expect(roleWithinRights(seesAll, role(['repView'], { reports: 'all' }))).toBe(true);
  });
});

describe('copiedRolePermissions — «Скопировать права из»', () => {
  const chiefRole: PermissionId[] = [
    'cpView',
    'createCp',
    'staffView',
    'staff',
    'export',
    'rollback',
  ];

  it('владелец копирует всё, кроме прав только владельца', () => {
    expect(copiedRolePermissions(ownerSubject, { isOwner: false, permissions: chiefRole })).toEqual(
      chiefRole,
    );
    const fromOwner = copiedRolePermissions(ownerSubject, { isOwner: true, permissions: [] });
    expect(fromOwner).toEqual(PERMISSION_IDS.filter((p) => p !== 'org'));
  });

  it('не владелец не копирует права, которые выдаёт только владелец, и права, которых у него нет', () => {
    expect(copiedRolePermissions(hrSubject, { isOwner: false, permissions: chiefRole })).toEqual([
      'cpView',
      'createCp',
      'staffView',
      'export',
    ]);
    expect(
      copiedRolePermissions(hrSubject, {
        isOwner: false,
        permissions: ['finView', 'money', 'export'],
      }),
    ).toEqual(['export']);
    expect(copiedRolePermissions(hrSubject, { isOwner: true, permissions: [] })).toEqual([
      'cpView',
      'createCp',
      'repView',
      'assign',
      'tasksCreate',
      'staffView',
      'dicts',
      'export',
    ]);
  });

  it('порядок — как в каталоге, повторы и право «org» отбрасываются', () => {
    expect(
      copiedRolePermissions(ownerSubject, {
        isOwner: false,
        permissions: ['export', 'org', 'cpView', 'export'],
      }),
    ).toEqual(['cpView', 'export']);
  });
});

describe('счётчики роли', () => {
  it('права «выдаёт только владелец» в роли', () => {
    expect(hasOwnerGrantedPermission({ isOwner: true, permissions: [] })).toBe(true);
    expect(hasOwnerGrantedPermission({ isOwner: false, permissions: ['cpView', 'staff'] })).toBe(
      true,
    );
    expect(hasOwnerGrantedPermission({ isOwner: false, permissions: ['cpView', 'org'] })).toBe(
      false,
    );
  });

  it('число прав: у владельца все 39', () => {
    expect(rolePermissionCount({ isOwner: true, permissions: [] })).toBe(39);
    expect(
      rolePermissionCount({ isOwner: false, permissions: ['cpView', 'export', 'cpView'] }),
    ).toBe(2);
  });
});
