import type { UserProfile, RolePermissions } from '@/types/database.types';

export type ModuleName = 'dashboard' | 'documents' | 'files' | 'counterparties' | 'employees' | 'company';

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
  | 'manage_roles'
  // Расширенные гранулярные экшены
  | 'view_all_statuses'
  | 'view_draft_only'
  | 'view_sent_only'
  | 'view_accepted_only'
  | 'tab_counterparties'
  | 'tab_partnerships'
  | 'tab_catalog'
  | 'tab_profile'
  | 'tab_legal_docs'
  | 'upload_legal_doc'
  | 'add_legal_doc'
  | 'edit_legal_doc'
  | 'delete_legal_doc'
  | 'tab_my_profile'
  | 'tab_employees'
  | 'tab_roles'
  | 'edit_my_profile'
  | 'create_role'
  | 'edit_role'
  | 'delete_role'
  | 'telegram_bind'
  | 'notify_documents'
  | 'notify_collaboration';

/**
 * Справочник русскоязычных названий модулей, вкладок и прав в интерфейсе матрицы
 */
export const MODULE_CONFIG: Record<
  ModuleName,
  { label: string; actions: { key: ActionName; label: string }[] }
> = {
  dashboard: {
    label: 'Главная страница аналитики',
    actions: [
      { key: 'view', label: 'Доступ к главной странице' },
    ],
  },
  documents: {
    label: 'Электронный документооборот',
    actions: [
      { key: 'view', label: 'Доступ к модулю (Отображение в меню)' },
      { key: 'view_details', label: 'Просмотр деталей и содержимого скана' },
      { key: 'create', label: 'Создание B2B Отправки (Черновик)' },
      { key: 'send', label: 'Отправка документа контрагенту' },
      { key: 'edit', label: 'Редактирование черновиков' },
      { key: 'accept', label: 'Принятие и подтверждение документа' },
      { key: 'recall', label: 'Отзыв отправленной первички' },
      { key: 'delete', label: 'Удаление документов' },
      { key: 'view_all_statuses', label: 'Видит документы ВСЕХ статусов' },
      { key: 'view_draft_only', label: 'Видит только Черновики' },
      { key: 'view_sent_only', label: 'Видит только Отправленные/Входящие' },
      { key: 'view_accepted_only', label: 'Видит только Принятые/Обработанные' },
    ],
  },
  counterparties: {
    label: 'Единый Реестр Контрагентов',
    actions: [
      { key: 'view', label: 'Доступ к модулю (Отображение в меню)' },
      { key: 'tab_counterparties', label: 'Видит вкладку «Мои контрагенты»' },
      { key: 'tab_partnerships', label: 'Видит вкладку «Заявки на сотрудничество»' },
      { key: 'tab_catalog', label: 'Видит вкладку «Каталог организаций КР»' },
      { key: 'request_partnership', label: 'Отправка заявки на сотрудничество' },
      { key: 'respond_partnership', label: 'Принятие или отклонение заявок' },
      { key: 'create_manual', label: 'Ручное добавление контрагентов по ИНН' },
      { key: 'terminate', label: 'Прекращение сотрудничества' },
    ],
  },
  files: {
    label: 'Реестр Файлов (Облачный архив R2)',
    actions: [
      { key: 'view', label: 'Доступ к модулю (Отображение в меню)' },
      { key: 'view_details', label: 'Доступ на просмотр данных внутри модуля' },
      { key: 'download', label: 'Скачивание оригиналов файлов' },
      { key: 'upload', label: 'Загрузка новых сканов' },
      { key: 'edit', label: 'Редактирование описаний и категорий' },
      { key: 'delete', label: 'Удаление файлов из архива' },
    ],
  },
  company: {
    label: 'Моя Организация',
    actions: [
      { key: 'view', label: 'Доступ к модулю (Отображение в меню)' },
      { key: 'tab_profile', label: 'Видит вкладку «Профиль & Реквизиты»' },
      { key: 'tab_legal_docs', label: 'Видит вкладку «Учредительные Документы»' },
      { key: 'upload_legal_doc', label: 'Загрузка уставных файлов' },
      { key: 'add_legal_doc', label: 'Добавление файлов в устав' },
      { key: 'edit_legal_doc', label: 'Изменение уставных документов' },
      { key: 'delete_legal_doc', label: 'Удаление уставных сканов' },
    ],
  },
  employees: {
    label: 'Сотрудники и Доступы',
    actions: [
      { key: 'view', label: 'Доступ к модулю (Отображение в меню)' },
      { key: 'tab_my_profile', label: 'Видит вкладку «Мой профиль»' },
      { key: 'tab_employees', label: 'Видит вкладку «Мои сотрудники»' },
      { key: 'tab_roles', label: 'Видит вкладку «Роли и доступы»' },
      { key: 'edit_my_profile', label: 'Может менять свои личные данные' },
      { key: 'edit_employee', label: 'Может изменять сотрудников (кроме Владельца)' },
      { key: 'create_employee', label: 'Может добавлять сотрудников' },
      { key: 'reset_password', label: 'Может менять пароль сотрудников' },
      { key: 'create_role', label: 'Может создавать роли' },
      { key: 'edit_role', label: 'Может изменять роли и матрицу прав' },
      { key: 'delete_role', label: 'Может удалять роли' },
      { key: 'telegram_bind', label: 'Может привязывать Telegram к аккаунту' },
      { key: 'notify_documents', label: 'Получает уведомления по документам' },
      { key: 'notify_collaboration', label: 'Получает уведомления по сотрудникам' },
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

  // 2. Владелец компании (owner) или системная роль Владельца имеют 100% полный доступ
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
    if (action === 'view') return true;
    if (
      action.startsWith('tab_') ||
      action === 'view_all_statuses'
    ) {
      return true;
    }
    if (
      module === 'documents' &&
      (action === 'create' || action === 'send' || action === 'accept' || action === 'view_details')
    ) {
      return true;
    }
    if (module === 'files' && (action === 'upload' || action === 'download' || action === 'view_details')) {
      return true;
    }
  }

  return false;
}

/**
 * Проверка права на просмотр профиля компании (Владелец, Суперадмин или Разрешено)
 */
export function canViewCompanyProfile(
  profile: UserProfile | null | undefined,
  companyOwnerId?: string
): boolean {
  if (!profile) return false;
  if (profile.is_super_admin) return true;
  if (profile.role === 'owner' || (companyOwnerId && profile.id === companyOwnerId)) return true;
  return hasPermission(profile, 'company', 'view') || hasPermission(profile, 'company', 'tab_profile');
}

/**
 * Проверка права на редактирование профиля компании (Строго ТОЛЬКО Владелец)
 */
export function canEditCompanyProfile(
  profile: UserProfile | null | undefined,
  companyOwnerId?: string
): boolean {
  if (!profile) return false;
  if (profile.role === 'owner') return true;
  if (companyOwnerId && profile.id === companyOwnerId) return true;
  return false;
}
