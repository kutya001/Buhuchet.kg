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
  roleDeleteRefusal,
  roleFormLock,
  rolePermissionLock,
  roleReadOnly,
  roleScopeLock,
  roleWithinRights,
  type RoleLock,
} from './editing';
import { UI_TEXTS } from '../l10n/texts';
import {
  PERMISSION_GROUPS,
  PERMISSION_IDS,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from './permissions';

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
  type Scopes = Partial<Record<ScopeGroupId, Scope>>;
  /** Сохранение роли: права до и после, область после (по умолчанию — как до, везде «Свои»). */
  const change = (
    editor: typeof owner,
    role: { id: string; isOwner: boolean },
    before: Set<PermissionId>,
    after: Set<PermissionId>,
    scopes: Scopes = {},
    scopesBefore: Scopes = {},
  ) =>
    roleChangeProblem(
      editor,
      role,
      { permissions: before, scopes: scopesBefore },
      { permissions: after, scopes: { ...scopesBefore, ...scopes } },
    );

  it('роль владельца не меняется никем; свою роль не владелец не меняет', () => {
    expect(change(owner, { id: 'owner', isOwner: true }, set(), set())).toEqual({
      lock: 'owner_role',
    });
    expect(change(hr, { id: 'hr', isOwner: false }, set(), set())).toEqual({
      lock: 'own_role',
    });
    expect(change(owner, { id: 'owner-role-of-other', isOwner: false }, set(), set())).toBeNull();
  });

  it('добавить право группы можно только вместе с просмотром', () => {
    expect(change(owner, accRole, set(), set('createCp'))).toEqual({
      lock: 'view_required',
      permission: 'createCp',
    });
    expect(change(owner, accRole, set(), set('cpView', 'createCp'))).toBeNull();
    // Права групп без просмотра («Задачи», «Справочники», «Общие права») — без условия.
    expect(change(owner, accRole, set(), set('tasksCreate', 'dicts', 'export'))).toBeNull();
  });

  it('право только владельца не выдаётся никому, даже владельцем', () => {
    expect(change(owner, accRole, set(), set('org'))).toEqual({
      lock: 'owner_only',
      permission: 'org',
    });
  });

  it('права, которые выдаёт только владелец: не владелец не добавляет', () => {
    expect(change(hr, accRole, set(), set('rollback'))).toEqual({
      lock: 'owner_granted',
      permission: 'rollback',
    });
    expect(change(owner, accRole, set(), set('staffView', 'staff', 'rollback'))).toBeNull();
  });

  it('роль с правами, которые выдаёт только владелец, меняет только владелец — целиком', () => {
    const problem = { lock: 'owner_granted_role' };
    // Снять само право, погасить его снятием просмотра, расширить такую роль — нельзя.
    expect(change(hr, accRole, set('staffView', 'staff'), set('staffView'))).toEqual(problem);
    expect(change(hr, accRole, set('staffView', 'staff'), set('staff'))).toEqual(problem);
    expect(change(hr, accRole, set('rollback'), set('rollback', 'export'))).toEqual(problem);
    expect(
      change(hr, accRole, set('cpView', 'archiveRest'), set('cpView', 'archiveRest'), {
        cps: 'all',
      }),
    ).toEqual(problem);
    expect(change(owner, accRole, set('staffView', 'staff'), set('staffView'))).toBeNull();
  });

  it('не владелец добавляет только права, которые действуют у него самого', () => {
    expect(change(hr, accRole, set(), set('cpView', 'createCp', 'export'))).toBeNull();
    expect(change(hr, accRole, set(), set('finView', 'money'))).toEqual({
      lock: 'beyond_own',
      permission: 'finView',
    });
    expect(change(hr, accRole, set('export'), set('export', 'viewAll'))).toEqual({
      lock: 'beyond_own',
      permission: 'viewAll',
    });
    expect(change(owner, accRole, set(), set('finView', 'money', 'viewAll'))).toBeNull();
  });

  it('область «Все контрагенты» не владелец даёт только там, где она есть у него', () => {
    expect(change(hr, accRole, set(), set(), { cps: 'all', reports: 'own' })).toBeNull();
    expect(change(hr, accRole, set(), set(), { reports: 'all' })).toEqual({
      lock: 'beyond_own_scope',
      group: 'reports',
    });
    expect(change(owner, accRole, set(), set(), { reports: 'all' })).toBeNull();
    // «Все» в своей роли без просмотра группы ничего не открывает — и выдать его нельзя.
    const blind = {
      ...hr,
      subject: { ...hrSubject, scopes: { cps: 'all' as const, fin: 'all' as const } },
    };
    expect(change(blind, accRole, set(), set(), { fin: 'all' })).toEqual({
      lock: 'beyond_own_scope',
      group: 'fin',
    });
  });

  it('возврат просмотра группы оживляет её права и область — они тоже не шире своих', () => {
    // В роли остались «Менять срок отчёта» и «Все» без просмотра отчётов; у кадровика их нет.
    expect(change(hr, accRole, set('repDue'), set('repDue', 'repView'))).toEqual({
      lock: 'beyond_own',
      permission: 'repDue',
    });
    expect(change(hr, accRole, set(), set('repView'), {}, { reports: 'all' })).toEqual({
      lock: 'beyond_own_scope',
      group: 'reports',
    });
    // В контрагентах у кадровика «Все» — оживить можно.
    expect(
      change(hr, accRole, set('createCp'), set('createCp', 'cpView'), {}, { cps: 'all' }),
    ).toBeNull();
    expect(
      change(owner, accRole, set('repDue'), set('repDue', 'repView'), {}, { reports: 'all' }),
    ).toBeNull();
  });

  it('снять право можно, права группы без просмотра остаются и не действуют', () => {
    expect(change(hr, accRole, set('cpView', 'createCp'), set('createCp'))).toBeNull();
    expect(change(hr, accRole, set('cpView', 'money'), set('cpView'))).toBeNull();
  });

  it('роль шире своей не владелец не меняет вовсе — ни снять право, ни переименовать', () => {
    const problem = { lock: 'beyond_own_role' };
    expect(change(hr, accRole, set('finView', 'money'), set())).toEqual(problem);
    expect(change(hr, accRole, set('finView'), set('finView'))).toEqual(problem);
    expect(change(hr, accRole, set('repView'), set(), {}, { reports: 'all' })).toEqual(problem);
    expect(change(owner, accRole, set('finView', 'money'), set())).toBeNull();
  });

  it('у каждой причины есть текст', () => {
    for (const lock of [
      ...Object.keys(ROLE_LOCK_MESSAGES),
      'owner_granted_role',
      'beyond_own',
      'beyond_own_scope',
      'beyond_own_role',
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

describe('roleReadOnly — какие роли не владелец видит только для чтения', () => {
  const role = (id: string, permissions: PermissionId[], scopes = {}) => ({
    id,
    isOwner: false,
    permissions,
    scopes,
  });

  it('свою, с правами «выдаёт только владелец» и шире своей; владельцу — все роли', () => {
    expect(roleReadOnly(hr, role('hr', ['cpView']))).toBe('own_role');
    expect(roleReadOnly(hr, role('chief', ['cpView', 'rollback']))).toBe('owner_granted_role');
    expect(roleReadOnly(hr, role('fin', ['finView']))).toBe('beyond_own_role');
    expect(roleReadOnly(hr, role('rep', ['repView'], { reports: 'all' }))).toBe('beyond_own_role');
    expect(roleReadOnly(hr, role('acc', ['cpView', 'createCp'], { cps: 'all' }))).toBeNull();
    // Права группы без её просмотра не действуют — роль не шире.
    expect(roleReadOnly(hr, role('acc', ['cpView', 'money']))).toBeNull();
    expect(roleReadOnly(owner, role('owner', ['cpView']))).toBeNull();
    expect(roleReadOnly(owner, role('chief', ['rollback', 'finView']))).toBeNull();
    // Роль владельца закрыта для всех своей причиной (`owner_role`).
    expect(roleReadOnly(hr, { id: 'o', isOwner: true, permissions: [], scopes: {} })).toBeNull();
  });
});

describe('roleFormLock и roleScopeLock — галочки и область в форме роли', () => {
  it('не владельцу закрыты права, которых у него нет; остальные причины — как у rolePermissionLock', () => {
    expect(roleFormLock(hr, accRole, 'finView')).toBe('not_own');
    expect(roleFormLock(hr, accRole, 'viewAll')).toBe('not_own');
    expect(roleFormLock(hr, accRole, 'export')).toBeNull();
    expect(roleFormLock(hr, accRole, 'rollback')).toBe('owner_granted');
    expect(roleFormLock(hr, accRole, 'createCp', set())).toBe('view_required');
    expect(roleFormLock(hr, { id: 'hr', isOwner: false }, 'export')).toBe('own_role');
    expect(roleFormLock(owner, accRole, 'finView')).toBeNull();
    expect(roleFormLock(owner, accRole, 'org')).toBe('owner_only');
  });

  it('«Все контрагенты» — только в группах, где это действует у него самого', () => {
    expect(roleScopeLock(hr, 'cps')).toBeNull();
    expect(roleScopeLock(hr, 'reports')).toBe('not_own_scope');
    expect(roleScopeLock(hr, 'fin')).toBe('not_own_scope');
    expect(roleScopeLock(owner, 'fin')).toBeNull();
    const seesAll = { ...hr, subject: { ...hrSubject, permissions: set('repView', 'viewAll') } };
    expect(roleScopeLock(seesAll, 'reports')).toBeNull();
  });
});

describe('roleDeleteRefusal — удаление роли', () => {
  const role = (id: string, permissions: PermissionId[]) => ({
    id,
    isOwner: false,
    permissions,
    scopes: {},
  });

  it('роль владельца не удаляется; роль только для чтения удаляет владелец', () => {
    expect(roleDeleteRefusal(owner, { id: 'o', isOwner: true, permissions: [], scopes: {} })).toBe(
      'owner_role',
    );
    expect(roleDeleteRefusal(hr, role('chief', ['cpView', 'rollback']))).toBe('owner_granted_role');
    expect(roleDeleteRefusal(hr, role('hr', ['cpView']))).toBe('own_role');
    expect(roleDeleteRefusal(hr, role('fin', ['finView']))).toBe('beyond_own_role');
    expect(roleDeleteRefusal(owner, role('chief', ['rollback']))).toBeNull();
    expect(roleDeleteRefusal(hr, role('acc', ['cpView', 'export']))).toBeNull();
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

describe('тексты формы роли в словаре', () => {
  const texts: Record<string, { ru: string }> = UI_TEXTS;

  it('причины под галочкой и отказы сохранения — те же тексты, что отдаёт сервер', () => {
    for (const [lock, message] of Object.entries(ROLE_CHANGE_MESSAGES)) {
      const key = lock in ROLE_LOCK_MESSAGES ? `roles.lock.${lock}` : `roles.err.${lock}`;
      expect(texts[key]?.ru, key).toBe(message);
    }
  });

  it('причины формы сверх сервера и пометка «Только для чтения» — в словаре', () => {
    for (const key of [
      'roles.lock.not_own',
      'roles.lock.not_own_scope',
      'roles.readonly.own_role',
      'roles.readonly.owner_granted_role',
      'roles.readonly.beyond_own_role',
    ]) {
      expect(texts[key]?.ru, key).toBeTruthy();
    }
  });

  it('у каждой группы прав есть название', () => {
    for (const g of PERMISSION_GROUPS) expect(texts[`roles.group.${g.id}`], g.id).toBeDefined();
  });
});
