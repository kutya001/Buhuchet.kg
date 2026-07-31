import type { UserProfile, RolePermissions } from '@/types/database.types';

export type ModuleName = 'documents' | 'files' | 'counterparties' | 'employees' | 'company';
export type ActionName =
  | 'view'
  | 'view_details'
  | 'create'
  | 'edit'
  | 'delete'
  | 'send'
  | 'accept'
  | 'recall'
  | 'manage'
  | 'upload'
  | 'download'
  | 'request_partnership'
  | 'respond_partnership'
  | 'create_manual'
  | 'terminate'
  | 'create_employee'
  | 'edit_employee'
  | 'reset_password'
  | 'manage_roles';

/**
 * Справочник русскоязычных названий модулей и кнопок в интерфейсе
 */
export const MODULE_CONFIG: Record<
  ModuleName,
  { label: string; actions: { key: ActionName; label: string }[] }
> = {
  documents: {
    label: 'Электронный документооборот',
    actions: [
      { key: 'view', label: 'Просмотр списка документов' },
      { key: 'view_details', label: 'Просмотр деталей и содержимого скана' },
      { key: 'create', label: 'Создание B2B Отправки (Черновик)' },
      { key: 'send', label: 'Отправка документа контрагенту' },
      { key: 'edit', label: 'Редактирование черновиков' },
      { key: 'accept', label: 'Принятие и подтверждение документа' },
      { key: 'recall', label: 'Отзыв отправленной первички' },
      { key: 'delete', label: 'Удаление документов' },
    ],
  },
  files: {
    label: 'Облачный архив',
    actions: [
      { key: 'view', label: 'Просмотр архива файлов' },
      { key: 'download', label: 'Скачивание оригиналов файлов' },
      { key: 'upload', label: 'Загрузка новых сканов' },
      { key: 'edit', label: 'Редактирование описаний и категорий' },
      { key: 'delete', label: 'Удаление файлов из архива' },
    ],
  },
  counterparties: {
    label: 'Единый Реестр Контрагентов',
    actions: [
      { key: 'view', label: 'Просмотр списка партнеров компании' },
      { key: 'request_partnership', label: 'Отправка заявки на сотрудничество' },
      { key: 'respond_partnership', label: 'Принятие или отклонение заявок' },
      { key: 'create_manual', label: 'Ручное добавление контрагентов по ИНН' },
      { key: 'terminate', label: 'Прекращение сотрудничества' },
    ],
  },
  employees: {
    label: 'Сотрудники и Доступы',
    actions: [
      { key: 'view', label: 'Просмотр списка сотрудников' },
      { key: 'create_employee', label: 'Создание новых аккаунтов сотрудников' },
      { key: 'edit_employee', label: 'Изменение должности и статусов' },
      { key: 'reset_password', label: 'Сброс пароля сотрудникам' },
      { key: 'manage_roles', label: 'Управление ролями и матрицей прав' },
    ],
  },
  company: {
    label: 'Профиль Моей Организации',
    actions: [
      { key: 'view', label: 'Просмотр карточки организации' },
      { key: 'edit', label: 'Редактирование реквизитов и логотипа' },
    ],
  },
};

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

  // 4. Безопасные правила по умолчанию для обычных сотрудников без явно заданных прав (role_id === null)
  if (!profile.role_id) {
    if (action === 'view' && module !== 'employees') {
      return true;
    }
    if (module === 'documents' && (action === 'create' || action === 'send' || action === 'accept' || action === 'view_details')) {
      return true;
    }
    if (module === 'files' && (action === 'upload' || action === 'download')) {
      return true;
    }
  }

  return false;
}
