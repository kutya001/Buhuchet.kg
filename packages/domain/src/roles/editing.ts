import {
  OWNER_GRANTED_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PERMISSION_IDS,
  viewPermissionOf,
  type PermissionId,
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

/** Что мешает сохранить роль: причина и право, на котором она возникла. */
export interface RoleChangeProblem {
  lock: RoleLock;
  permission?: PermissionId;
}

/**
 * Проверка сохранения роли на сервере — то же правило, что у галочек формы. Роль владельца и свою
 * роль (не владельцу) не меняют вовсе: ни права, ни область, ни название — иначе сотрудник расширил
 * бы себе область «Свои → Все» (ОТКЛОНЕНИЕ: docs/deviations.md#15). Добавленное право проверяется
 * целиком, «Сначала дайте просмотр» — по новому набору. Снятое право не держит только «выдаёт только
 * владелец»: прототип не даёт снять право группы без просмотра, но такое право и не действует
 * (`hasPermission`), так что снять его можно.
 */
export function roleChangeProblem(
  editor: RoleEditor,
  role: EditedRole,
  before: ReadonlySet<PermissionId>,
  after: ReadonlySet<PermissionId>,
): RoleChangeProblem | null {
  if (role.isOwner) return { lock: 'owner_role' };
  if (!editor.isOwner && editor.roleId === role.id) return { lock: 'own_role' };
  for (const permission of PERMISSION_IDS) {
    if (after.has(permission) && !before.has(permission)) {
      const lock = rolePermissionLock(editor, role, permission, after);
      if (lock) return { lock, permission };
    } else if (before.has(permission) && !after.has(permission)) {
      if (!editor.isOwner && OWNER_GRANTED_PERMISSIONS.includes(permission)) {
        return { lock: 'owner_granted', permission };
      }
    }
  }
  return null;
}

/**
 * Права новой роли из роли-образца («Скопировать права из», прототип modules/staff.js, roleAddDlg):
 * без прав только владельца, а у сотрудника не владельца — и без прав, которые выдаёт только
 * владелец. У роли владельца права не перечисляются — копируются все. Область не копируется: у новой
 * роли везде «Свои контрагенты», как в прототипе.
 */
export function copiedRolePermissions(
  editor: Pick<RoleEditor, 'isOwner'>,
  source: { isOwner: boolean; permissions: readonly PermissionId[] },
): PermissionId[] {
  const from = new Set(source.isOwner ? PERMISSION_IDS : source.permissions);
  return PERMISSION_IDS.filter(
    (p) =>
      from.has(p) &&
      !OWNER_ONLY_PERMISSIONS.includes(p) &&
      (editor.isOwner || !OWNER_GRANTED_PERMISSIONS.includes(p)),
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
