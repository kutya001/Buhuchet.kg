import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/role-locks.json';
import {
  copiedRolePermissions,
  hasOwnerGrantedPermission,
  ROLE_LOCK_MESSAGES,
  roleChangeProblem,
  rolePermissionCount,
  rolePermissionLock,
  type RoleLock,
} from './editing';
import { PERMISSION_IDS, type PermissionId } from './permissions';

const LOCK_BY_MESSAGE = new Map(
  Object.entries(ROLE_LOCK_MESSAGES).map(([lock, message]) => [message, lock as RoleLock]),
);

const owner = { isOwner: true, roleId: 'owner' };
const chief = { isOwner: false, roleId: 'chief' };
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
  const set = (...p: PermissionId[]) => new Set<PermissionId>(p);

  it('роль владельца не меняется никем; свою роль не владелец не меняет', () => {
    expect(roleChangeProblem(owner, { id: 'owner', isOwner: true }, set(), set())).toEqual({
      lock: 'owner_role',
    });
    expect(roleChangeProblem(chief, { id: 'chief', isOwner: false }, set(), set())).toEqual({
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

  it('права, которые выдаёт только владелец: не владелец не добавляет и не снимает', () => {
    expect(roleChangeProblem(chief, accRole, set(), set('rollback'))).toEqual({
      lock: 'owner_granted',
      permission: 'rollback',
    });
    expect(roleChangeProblem(chief, accRole, set('staffView', 'staff'), set('staffView'))).toEqual({
      lock: 'owner_granted',
      permission: 'staff',
    });
    // Оставить такое право в роли можно: меняются другие галочки.
    expect(
      roleChangeProblem(chief, accRole, set('rollback'), set('rollback', 'export')),
    ).toBeNull();
    expect(
      roleChangeProblem(owner, accRole, set('staffView', 'staff'), set('staffView')),
    ).toBeNull();
    expect(
      roleChangeProblem(owner, accRole, set(), set('staffView', 'staff', 'rollback')),
    ).toBeNull();
  });

  it('снять просмотр можно, права группы без него остаются и не действуют', () => {
    expect(
      roleChangeProblem(chief, accRole, set('cpView', 'createCp'), set('createCp')),
    ).toBeNull();
    expect(roleChangeProblem(chief, accRole, set('cpView', 'createCp'), set())).toBeNull();
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
    expect(copiedRolePermissions(owner, { isOwner: false, permissions: chiefRole })).toEqual(
      chiefRole,
    );
    const fromOwner = copiedRolePermissions(owner, { isOwner: true, permissions: [] });
    expect(fromOwner).toEqual(PERMISSION_IDS.filter((p) => p !== 'org'));
  });

  it('не владелец не копирует права, которые выдаёт только владелец', () => {
    expect(copiedRolePermissions(chief, { isOwner: false, permissions: chiefRole })).toEqual([
      'cpView',
      'createCp',
      'staffView',
      'export',
    ]);
    expect(copiedRolePermissions(chief, { isOwner: true, permissions: [] })).not.toContain(
      'archiveRest',
    );
  });

  it('порядок — как в каталоге, повторы и право «org» отбрасываются', () => {
    expect(
      copiedRolePermissions(owner, {
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
