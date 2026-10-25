import {
  OWNER_ONLY_PERMISSIONS,
  PERMISSION_IDS,
  SCOPE_GROUPS,
  SCOPES,
  isPermissionId,
  type PermissionId,
  type Scope,
  type ScopeGroupId,
} from './permissions';

/** Название роли владельца: роль создаётся с организацией, изменить и удалить её нельзя. */
export const OWNER_ROLE_NAME = 'Владелец организации';

/** Шаблон роли платформы («Главный бухгалтер», «Бухгалтер»): таблица role_templates. */
export interface RoleTemplate {
  code: string;
  name: string;
  permissions: readonly string[];
  scopes: Readonly<Record<string, string>>;
}

/** Роль, которую получает новая организация. */
export interface NewRole {
  name: string;
  isOwner: boolean;
  templateCode: string | null;
  permissions: PermissionId[];
  scopes: Record<ScopeGroupId, Scope>;
}

/** Область по всем группам: неизвестные группы и значения отбрасываются, недостающие — «Свои». */
export function normalizeScopes(
  scopes: Readonly<Record<string, string>> | undefined,
): Record<ScopeGroupId, Scope> {
  const known = new Set<string>(SCOPES);
  return Object.fromEntries(
    SCOPE_GROUPS.map((g) => {
      const value = scopes?.[g];
      return [g, value !== undefined && known.has(value) ? (value as Scope) : 'own'];
    }),
  ) as Record<ScopeGroupId, Scope>;
}

/**
 * Права роли из шаблона: только известные коды, без прав «только у владельца», в порядке каталога.
 * Шаблоны ведёт администратор платформы, поэтому лишнее из них молча не переносится в роль.
 */
export function normalizeRolePermissions(permissions: readonly string[]): PermissionId[] {
  const wanted = new Set(permissions.filter(isPermissionId));
  return PERMISSION_IDS.filter((p) => wanted.has(p) && !OWNER_ONLY_PERMISSIONS.includes(p));
}

/**
 * Роли новой организации (ТЗ «Админка» → «Модуль организаций»): роль владельца и копии шаблонов
 * платформы. У роли владельца права не перечисляются — они все по признаку isOwner.
 */
export function rolesForNewOrganization(templates: readonly RoleTemplate[]): NewRole[] {
  return [
    {
      name: OWNER_ROLE_NAME,
      isOwner: true,
      templateCode: null,
      permissions: [],
      scopes: normalizeScopes(Object.fromEntries(SCOPE_GROUPS.map((g) => [g, 'all']))),
    },
    ...templates.map((t) => ({
      name: t.name,
      isOwner: false,
      templateCode: t.code,
      permissions: normalizeRolePermissions(t.permissions),
      scopes: normalizeScopes(t.scopes),
    })),
  ];
}
