import {
  effectivePermissions,
  hasPermission,
  scopeGroupView,
  scopeOf,
  type AccessSubject,
} from './access';
import {
  OWNER_GRANTED_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PERMISSION_IDS,
  SCOPE_GROUPS,
  viewPermissionOf,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from './permissions';

/** Кто меняет роли: владелец или сотрудник с правом «Сотрудники и роли» (у него своя роль). */
export interface RoleEditor {
  isOwner: boolean;
  roleId: string;
}

/** Роль, которую меняют. */
export interface EditedRole {
  id: string;
  isOwner: boolean;
}

/** Почему галочку права в роли поменять нельзя (прототип core/org.js, roleLock). */
export type RoleLock = 'owner_role' | 'view_required' | 'owner_only' | 'own_role' | 'owner_granted';

/** Причина под неактивной галочкой — тексты прототипа. */
export const ROLE_LOCK_MESSAGES: Record<RoleLock, string> = {
  owner_role: 'Права владельца не меняются',
  view_required: 'Сначала дайте просмотр',
  owner_only: 'Это право есть только у владельца организации',
  own_role: 'Права своей роли меняет владелец',
  owner_granted: 'Это право выдаёт только владелец',
};

/**
 * Можно ли менять галочку права в форме роли — проверки в том же порядке, что в прототипе
 * (core/org.js, roleLock): роль владельца; «Сначала дайте просмотр», если отмечено `selected` без
 * права просмотра группы; право только владельца; дальше владельцу можно всё, остальным — не своя
 * роль и не права, которые выдаёт только владелец.
 */
export function rolePermissionLock(
  editor: RoleEditor,
  role: EditedRole,
  permission: PermissionId,
  selected?: ReadonlySet<PermissionId>,
): RoleLock | null {
  if (role.isOwner) return 'owner_role';
  const view = viewPermissionOf(permission);
  if (selected && view && view !== permission && !selected.has(view)) return 'view_required';
  if (OWNER_ONLY_PERMISSIONS.includes(permission)) return 'owner_only';
  if (editor.isOwner) return null;
  if (editor.roleId === role.id) return 'own_role';
  if (OWNER_GRANTED_PERMISSIONS.includes(permission)) return 'owner_granted';
  return null;
}

/**
 * Почему роль не сохранить: причины галочек формы и правила сверх прототипа для сотрудника не
 * владельца (ОТКЛОНЕНИЕ: docs/deviations.md#15).
 */
export type RoleChangeLock =
  | RoleLock
  /** В роли есть права, которые выдаёт только владелец: такую роль меняет только он. */
  | 'owner_granted_role'
  /** Право, которого нет у того, кто правит: больше своих прав не выдают. */
  | 'beyond_own'
  /** Область «Все контрагенты» в группе, где у того, кто правит, — «Свои». */
  | 'beyond_own_scope';

export const ROLE_CHANGE_MESSAGES: Record<RoleChangeLock, string> = {
  ...ROLE_LOCK_MESSAGES,
  owner_granted_role: 'Роль с правами, которые выдаёт только владелец, меняет владелец',
  beyond_own: 'Можно выдать только те права, что есть у вас',
  beyond_own_scope: 'Область «Все контрагенты» можно дать только там, где она есть у вас',
};

/** Кто сохраняет роль: кроме своей роли — его действующие права и область (`AccessSubject`). */
export interface RoleSaveEditor extends RoleEditor {
  subject: AccessSubject;
}

/** Что мешает сохранить роль: причина и право или группа, на которых она возникла. */
export interface RoleChangeProblem {
  lock: RoleChangeLock;
  permission?: PermissionId;
  group?: ScopeGroupId;
}

/**
 * Проверка сохранения роли на сервере — то же правило, что у галочек формы. Роль владельца и свою
 * роль (не владельцу) не меняют вовсе: ни права, ни область, ни название — иначе сотрудник расширил
 * бы себе область «Свои → Все». Добавленное право проверяется целиком, «Сначала дайте просмотр» — по
 * новому набору. Снятое право не держит: прототип не даёт снять право группы без просмотра, но такое
 * право и не действует (`hasPermission`), так что снять его можно.
 *
 * Сверх прототипа сотруднику не владельцу (ОТКЛОНЕНИЕ: docs/deviations.md#15): роль с правами,
 * которые выдаёт только владелец, меняет только владелец — иначе такие права гасили бы снятием
 * просмотра группы, а двое их носителей расширяли бы роли друг другу; добавить можно только право,
 * которое действует у него самого, а область «Все контрагенты» — только в группе, где она у него
 * есть: через роль коллеги и созданного сотрудника он получил бы права шире своих. `scopes` — группы,
 * у которых область меняется.
 */
export function roleChangeProblem(
  editor: RoleSaveEditor,
  role: EditedRole,
  before: ReadonlySet<PermissionId>,
  after: ReadonlySet<PermissionId>,
  scopes: Readonly<Partial<Record<ScopeGroupId, Scope>>> = {},
): RoleChangeProblem | null {
  if (role.isOwner) return { lock: 'owner_role' };
  if (!editor.isOwner) {
    if (editor.roleId === role.id) return { lock: 'own_role' };
    if (hasOwnerGrantedPermission({ isOwner: false, permissions: before })) {
      return { lock: 'owner_granted_role' };
    }
  }
  for (const permission of PERMISSION_IDS) {
    if (!after.has(permission) || before.has(permission)) continue;
    const lock = rolePermissionLock(editor, role, permission, after);
    if (lock) return { lock, permission };
    if (!hasPermission(editor.subject, permission)) return { lock: 'beyond_own', permission };
  }
  for (const group of SCOPE_GROUPS) {
    if (scopes[group] === 'all' && scopeOf(editor.subject, group) !== 'all') {
      return { lock: 'beyond_own_scope', group };
    }
  }
  return null;
}

/** Права и область роли — то, что она даёт сотруднику. */
export interface RoleRights {
  isOwner: boolean;
  permissions: readonly PermissionId[];
  scopes: Readonly<Partial<Record<ScopeGroupId, Scope>>>;
}

/**
 * Не шире ли роль прав того, кто действует (ОТКЛОНЕНИЕ: docs/deviations.md#15): каждое действующее
 * право роли действует и у него, а область «Все контрагенты» в группе, которую роль видит, есть и у
 * него. Владельцу можно любую роль, роль владельца шире любой другой.
 */
export function roleWithinRights(subject: AccessSubject, role: RoleRights): boolean {
  if (subject.isOwner) return true;
  if (role.isOwner) return false;
  const holder: AccessSubject = {
    employeeId: '',
    isOwner: false,
    permissions: new Set(role.permissions),
    scopes: role.scopes,
  };
  if (effectivePermissions(holder).some((p) => !hasPermission(subject, p))) return false;
  return SCOPE_GROUPS.every(
    (g) =>
      scopeOf(subject, g) === 'all' ||
      scopeOf(holder, g) === 'own' ||
      !hasPermission(holder, scopeGroupView(g)),
  );
}

/**
 * Права новой роли из роли-образца («Скопировать права из», прототип modules/staff.js, roleAddDlg):
 * без прав только владельца, а у сотрудника не владельца — и без прав, которые выдаёт только
 * владелец, и без прав, которых нет у него самого (ОТКЛОНЕНИЕ: docs/deviations.md#15). У роли
 * владельца права не перечисляются — копируются все. Область не копируется: у новой роли везде «Свои
 * контрагенты», как в прототипе.
 */
export function copiedRolePermissions(
  editor: AccessSubject,
  source: { isOwner: boolean; permissions: readonly PermissionId[] },
): PermissionId[] {
  const from = new Set(source.isOwner ? PERMISSION_IDS : source.permissions);
  return PERMISSION_IDS.filter(
    (p) =>
      from.has(p) &&
      !OWNER_ONLY_PERMISSIONS.includes(p) &&
      (editor.isOwner || (!OWNER_GRANTED_PERMISSIONS.includes(p) && hasPermission(editor, p))),
  );
}

/** Есть ли среди прав роли те, что выдаёт и снимает только владелец. */
export function hasOwnerGrantedPermission(role: {
  isOwner: boolean;
  permissions: Iterable<PermissionId>;
}): boolean {
  if (role.isOwner) return true;
  for (const p of role.permissions) if (OWNER_GRANTED_PERMISSIONS.includes(p)) return true;
  return false;
}

/** Число прав роли для списка ролей: у роли владельца — все (прототип modules/staff.js, roleN). */
export function rolePermissionCount(role: {
  isOwner: boolean;
  permissions: readonly PermissionId[];
}): number {
  return role.isOwner ? PERMISSION_IDS.length : new Set(role.permissions).size;
}
