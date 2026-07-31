import type { UserProfile, RolePermissions } from '@/types/database.types';

export type ModuleName = 'documents' | 'files' | 'counterparties' | 'employees' | 'company' | 'export';
export type ActionName = 'view' | 'create' | 'edit' | 'delete' | 'send' | 'accept' | 'recall' | 'manage' | 'upload';

/**
 * Единый централизованный движок проверки прав доступа (RBAC / ACL)
 */
export function hasPermission(
  profile: UserProfile | null | undefined,
  module: ModuleName,
  action: ActionName
): boolean {
  if (!profile) return false;

  // 1. Суперадминистратор имеет 100% полный доступ ко всем функциям
  if (profile.is_super_admin) return true;

  // 2. Владелец компании (owner) или системная роль Владельца имеют полный доступ
  if (profile.role === 'owner' || profile.company_roles?.is_system) return true;

  // 3. Проверка матрицы прав роли компании (company_roles.permissions)
  const permissions = profile.company_roles?.permissions as RolePermissions | undefined;

  if (permissions && permissions[module]) {
    const modPerms = permissions[module] as Record<string, boolean | undefined>;
    if (modPerms && typeof modPerms[action] === 'boolean') {
      return modPerms[action] === true;
    }
  }

  // 4. Безопасные правила по умолчанию для обычных сотрудников без явно заданных прав:
  // Если у сотрудника роль еще не настроена (role_id === null):
  // По умолчанию разрешен просмотр базовых модулей ('documents.view', 'files.view', 'counterparties.view', 'company.view')
  if (!profile.role_id) {
    if (action === 'view' && module !== 'employees') {
      return true;
    }
    if (module === 'documents' && (action === 'create' || action === 'send' || action === 'accept')) {
      return true;
    }
    if (module === 'files' && action === 'upload') {
      return true;
    }
  }

  return false;
}
