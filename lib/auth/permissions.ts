import type { UserProfile, RolePermissions } from '@/types/database.types';

export type ModuleName =
  | 'dashboard'
  | 'documents'
  | 'files'
  | 'counterparties'
  | 'employees'
  | 'company'
  | 'subscription';

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
  | 'export'
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
  | 'tab_periods'
  | 'periods_view'
  | 'periods_manage'
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
  | 'notify_collaboration'
  | 'manage_subscription';

/**
 * Структура метаданных отдельного разрешения для UI и подсказок
 */
export interface PermissionMeta {
  key: string;
  module: ModuleName;
  action: ActionName;
  label: string;
  uiTarget: string; // Связанная кнопка / вкладка (например: "Кнопка «+ Новый документ»")
  shortDesc: string; // Краткое описание для карточки
  detailedDesc: string; // Полный текст для Tooltip / Popover
  warning?: string; // Предупреждение о критичности доступа
}

/**
 * Структура группы разрешений (модуля)
 */
export interface PermissionGroupMeta {
  id: ModuleName;
  title: string;
  iconName: 'FileText' | 'Building2' | 'Users' | 'FolderArchive' | 'ShieldAlert' | 'CreditCard' | 'LayoutDashboard';
  description: string;
  permissions: PermissionMeta[];
}

/**
 * Полный системный структурированный каталог прав доступа Buhuchet.kg
 */
export const SYSTEM_PERMISSION_CATALOG: PermissionGroupMeta[] = [
  {
    id: 'documents',
    title: 'Документооборот',
    iconName: 'FileText',
    description: 'Электронный документооборот: создание, согласование, подписание и экспорт первичных бухгалтерских документов.',
    permissions: [
      {
        key: 'documents.view',
        module: 'documents',
        action: 'view',
        label: 'Просмотр документооборота',
        uiTarget: 'Страница /uchet/documents',
        shortDesc: 'Доступ к списку первички и просмотру деталей',
        detailedDesc: 'Позволяет просматривать общий реестр первичных документов (накладные, акты, счета-фактуры), фильтровать по статусам и открывать карточки документов.',
      },
      {
        key: 'documents.create',
        module: 'documents',
        action: 'create',
        label: 'Создание документов',
        uiTarget: 'Кнопка «+ Новый документ»',
        shortDesc: 'Оформление и сохранение новых первичных документов',
        detailedDesc: 'Разрешает заполнять форму и сохранять новые первичные документы (черновики и B2B отправки контрагентам) в открытых отчетных периодах.',
      },
      {
        key: 'documents.edit',
        module: 'documents',
        action: 'edit',
        label: 'Редактирование документов',
        uiTarget: 'Кнопка действия «Редактировать»',
        shortDesc: 'Изменение существующих документов в открытом периоде',
        detailedDesc: 'Позволяет корректировать реквизиты, суммы, примечания и статус сохраненных документов, если отчетный период за дату документа не заблокирован.',
      },
      {
        key: 'documents.delete',
        module: 'documents',
        action: 'delete',
        label: 'Удаление документов',
        uiTarget: 'Кнопка действия «Удалить»',
        shortDesc: 'Безвозвратное удаление первичных документов',
        detailedDesc: 'Разрешает удаление документов и связанных с ними записей аудита. В закрытых налоговых периодах удаление автоматически блокируется базой данных.',
        warning: 'Критическое право: удаление документов влияет на бухгалтерский баланс и финансовую историю компании.',
      },
      {
        key: 'documents.export',
        module: 'documents',
        action: 'export',
        label: 'Экспорт реестра в Excel',
        uiTarget: 'Кнопка «Экспорт в Excel / CSV»',
        shortDesc: 'Выгрузка сформированных реестров в таблицы XLSX/CSV',
        detailedDesc: 'Позволяет выгружать отфильтрованные списки документов и журнал проводок в форматы XLSX и CSV для интеграции с 1С и внешними учетными системами.',
      },
    ],
  },
  {
    id: 'counterparties',
    title: 'Единый Реестр Контрагентов',
    iconName: 'Building2',
    description: 'Управление партнерской сетью, поиск компаний по ИНН в каталоге КР и электронный обмен.',
    permissions: [
      {
        key: 'counterparties.view',
        module: 'counterparties',
        action: 'view',
        label: 'Справочник контрагентов',
        uiTarget: 'Страница /uchet/counterparties',
        shortDesc: 'Просмотр базы контрагентов и истории связей',
        detailedDesc: 'Позволяет просматривать базу подтвержденных партнеров, их реквизиты (ИНН, ОКПО, БИК) и историю взаимодействия.',
      },
      {
        key: 'counterparties.create_manual',
        module: 'counterparties',
        action: 'create_manual',
        label: 'Добавление контрагента по ИНН',
        uiTarget: 'Кнопка «+ Добавить контрагента»',
        shortDesc: 'Ручной ввод контрагентов с валидацией реквизитов',
        detailedDesc: 'Разрешает добавлять новых партнеров вручную с автоматической проверкой контрольной суммы ИНН Кыргызской Республики.',
      },
      {
        key: 'counterparties.request_partnership',
        module: 'counterparties',
        action: 'request_partnership',
        label: 'Запрос на сотрудничество',
        uiTarget: 'Кнопка «Отправить заявку» в каталоге',
        shortDesc: 'Отправка предложений о сотрудничестве',
        detailedDesc: 'Позволяет находить верифицированные компании в каталоге Кыргызстана и отправлять им заявки на установление электронного документооборота.',
      },
      {
        key: 'counterparties.respond_partnership',
        module: 'counterparties',
        action: 'respond_partnership',
        label: 'Прием и рассмотрение входящих заявок',
        uiTarget: 'Кнопки «Принять» / «Отклонить»',
        shortDesc: 'Одобрение или отклонение входящих партнерств',
        detailedDesc: 'Позволяет подтверждать входящие заявки на сотрудничество от других организаций для открытия взаимного обмена первичкой.',
      },
      {
        key: 'counterparties.terminate',
        module: 'counterparties',
        action: 'terminate',
        label: 'Прекращение сотрудничества',
        uiTarget: 'Кнопка «Расторгнуть партнерство»',
        shortDesc: 'Разрыв партнерской связи и деактивация',
        detailedDesc: 'Разрешает расторгать действующее партнерство и удалять организацию из активного списка контрагентов.',
        warning: 'Внимание: расторжение партнерства блокирует дальнейшую отправку B2B документов контрагенту.',
      },
    ],
  },
  {
    id: 'company',
    title: 'Моя Организация & Периоды',
    iconName: 'ShieldAlert',
    description: 'Управление юридическими реквизитами, уставными документами и финансовым замком закрытия периодов.',
    permissions: [
      {
        key: 'company.view',
        module: 'company',
        action: 'view',
        label: 'Просмотр карточки компании',
        uiTarget: 'Вкладка «Профиль компании»',
        shortDesc: 'Просмотр реквизитов, квот и настроек',
        detailedDesc: 'Позволяет просматривать юридические реквизиты, квоту используемого дискового пространства и публичные настройки компании.',
      },
      {
        key: 'company.edit',
        module: 'company',
        action: 'edit',
        label: 'Редактирование реквизитов',
        uiTarget: 'Кнопка «Сохранить реквизиты»',
        shortDesc: 'Изменение юридического адреса, счетов и контактов',
        detailedDesc: 'Разрешает редактировать юридические реквизиты (наименование, форма, расчетные счета, БИК, ОКПО, контакты).',
        warning: 'Критическое право: изменение реквизитов повлияет на печатные формы всех новых бухгалтерских документов.',
      },
      {
        key: 'company.periods_view',
        module: 'company',
        action: 'periods_view',
        label: 'Журнал закрытых периодов',
        uiTarget: 'Вкладка «Закрытие месяца / периода»',
        shortDesc: 'Просмотр реестра заблокированных отчетных месяцев',
        detailedDesc: 'Позволяет просматривать помесячный журнал закрытия периодов с информацией о датах блокировки и ответственных сотрудниках.',
      },
      {
        key: 'company.periods_manage',
        module: 'company',
        action: 'periods_manage',
        label: 'Управление закрытием / открытием периодов',
        uiTarget: 'Кнопки «Закрыть период» / «Открыть период»',
        shortDesc: 'Установка финансового замка на прошлые периоды',
        detailedDesc: 'Разрешает блокировать отчетные периоды для защиты сданной отчетности от правок или временно открывать их с указанием обязательной причины.',
        warning: 'Финансовый замок: блокирует создание, изменение и удаление первичных документов всеми сотрудниками за выбранный месяц.',
      },
      {
        key: 'company.upload_legal_doc',
        module: 'company',
        action: 'upload_legal_doc',
        label: 'Загрузка учредительных документов',
        uiTarget: 'Вкладка «Учредительные Документы»',
        shortDesc: 'Загрузка устава, свидетельства и решений',
        detailedDesc: 'Позволяет загружать и обновлять скан-копии уставных документов организации в облачном архиве.',
      },
    ],
  },
  {
    id: 'employees',
    title: 'Сотрудники и Доступы',
    iconName: 'Users',
    description: 'Управление штатным расписанием, приглашениями, ролями и индивидуальными полномочиями.',
    permissions: [
      {
        key: 'employees.view',
        module: 'employees',
        action: 'view',
        label: 'Список сотрудников',
        uiTarget: 'Страница /uchet/employees',
        shortDesc: 'Просмотр участников компании и должностей',
        detailedDesc: 'Позволяет просматривать список сотрудников, их должности, электронную почту, телефоны и назначенные роли.',
      },
      {
        key: 'employees.create_employee',
        module: 'employees',
        action: 'create_employee',
        label: 'Прием и одобрение соискателей в штат',
        uiTarget: 'Кнопка «Подтвердить прием в штат»',
        shortDesc: 'Одобрение заявок на вступление и зачисление сотрудников',
        detailedDesc: 'Разрешает рассматривать заявки специалистов, подавших запрос на вступление в организацию, назначать им должность и открывать доступ.',
      },
      {
        key: 'employees.edit_role',
        module: 'employees',
        action: 'edit_role',
        label: 'Настройка ролей и матрицы доступов',
        uiTarget: 'Кнопка «Настроить матрицу прав»',
        shortDesc: 'Управление матрицей прав и создание ролей',
        detailedDesc: 'Позволяет создавать новые роли, изменять набор разрешений для каждой роли и настраивать уровни безопасности.',
        warning: 'Административное право: позволяет расширять или ограничивать полномочия других участников компании.',
      },
      {
        key: 'employees.edit_employee',
        module: 'employees',
        action: 'edit_employee',
        label: 'Редактирование должностей сотрудников',
        uiTarget: 'Кнопка «Изменить роль / должность»',
        shortDesc: 'Смена должности и роли участников штата',
        detailedDesc: 'Позволяет менять должность сотрудника и привязывать его к другой существующей роли в системе.',
      },
      {
        key: 'employees.telegram_bind',
        module: 'employees',
        action: 'telegram_bind',
        label: 'Привязка Telegram-уведомлений',
        uiTarget: 'Вкладка «Мой профиль»',
        shortDesc: 'Подключение личного Telegram-бота',
        detailedDesc: 'Разрешает привязывать Telegram-аккаунт для получения мгновенных уведомлений о входящих документах и заявках.',
      },
    ],
  },
  {
    id: 'files',
    title: 'Файлы и Облачный Архив (R2)',
    iconName: 'FolderArchive',
    description: 'Защищенное облачное хранилище Cloudflare R2: хранение, организация категорий и удаление сканов.',
    permissions: [
      {
        key: 'files.view',
        module: 'files',
        action: 'view',
        label: 'Просмотр реестра файлов',
        uiTarget: 'Страница /uchet/files',
        shortDesc: 'Доступ к общему архиву документов и сканов',
        detailedDesc: 'Позволяет просматривать реестр загруженных файлов, фильтровать по категориям, датам и форматам.',
      },
      {
        key: 'files.download',
        module: 'files',
        action: 'download',
        label: 'Скачивание оригиналов сканов',
        uiTarget: 'Кнопка «Скачать скан»',
        shortDesc: 'Прямая выгрузка исходных PDF и изображений',
        detailedDesc: 'Позволяет скачивать оригинальные файлы из облачного хранилища по защищенным одноразовым Presigned URL.',
      },
      {
        key: 'files.upload',
        module: 'files',
        action: 'upload',
        label: 'Загрузка новых файлов',
        uiTarget: 'Дропзона «Загрузить скан»',
        shortDesc: 'Загрузка документов в облачный архив R2',
        detailedDesc: 'Позволяет загружать файлы и сканы документов с автоматической проверкой сигнатур (Magic Bytes).',
      },
      {
        key: 'files.delete',
        module: 'files',
        action: 'delete',
        label: 'Удаление файлов из архива',
        uiTarget: 'Кнопка «Удалить скан»',
        shortDesc: 'Удаление файлов и освобождение квоты',
        detailedDesc: 'Разрешает удалять ненужные файлы из архива и ставить их в очередь физической очистки хранилища.',
        warning: 'Внимание: удаление файла безвозвратно сотрет скан-копию из облачного хранилища.',
      },
    ],
  },
  {
    id: 'subscription',
    title: 'Тариф и Корпоративная Подписка',
    iconName: 'CreditCard',
    description: 'Управление тарифным планом, лимитами документов, дисковой квотой и оплатой.',
    permissions: [
      {
        key: 'subscription.view',
        module: 'subscription',
        action: 'view',
        label: 'Просмотр тарифа и квот',
        uiTarget: 'Страница /uchet/subscription',
        shortDesc: 'Просмотр остатка лимитов и даты окончания тарифа',
        detailedDesc: 'Позволяет просматривать текущий тарифный план компании, остаток оплаченных документов и объем хранилища.',
      },
      {
        key: 'subscription.manage_subscription',
        module: 'subscription',
        action: 'manage_subscription',
        label: 'Управление тарифом и оплата',
        uiTarget: 'Кнопка «Оплатить / Сменить тариф»',
        shortDesc: 'Смена тарифного плана и проведение оплаты',
        detailedDesc: 'Разрешает выбирать новые тарифы, пополнять баланс и оплачивать подписку (строго ограничено Владельцем).',
        warning: 'Финансовая операция: изменение тарифного плана и списание средств организации.',
      },
    ],
  },
];

/**
 * Справочник русскоязычных названий модулей (обратная совместимость)
 */
export const MODULE_CONFIG: Record<
  ModuleName,
  { label: string; actions: { key: ActionName; label: string }[] }
> = {
  dashboard: {
    label: 'Главная страница аналитики',
    actions: [{ key: 'view', label: 'Доступ к главной странице' }],
  },
  documents: {
    label: 'Электронный документооборот',
    actions: [
      { key: 'view', label: 'Просмотр реестра документов' },
      { key: 'create', label: 'Создание B2B Отправки (Черновик)' },
      { key: 'edit', label: 'Редактирование черновиков' },
      { key: 'delete', label: 'Удаление документов' },
      { key: 'export', label: 'Экспорт реестра в 1С / Excel' },
      { key: 'send', label: 'Отправка документа контрагенту' },
      { key: 'accept', label: 'Принятие и подтверждение документа' },
      { key: 'recall', label: 'Отзыв отправленной первички' },
      { key: 'view_details', label: 'Просмотр деталей и содержимого скана' },
      { key: 'view_all_statuses', label: 'Видит документы ВСЕХ статусов' },
    ],
  },
  counterparties: {
    label: 'Единый Реестр Контрагентов',
    actions: [
      { key: 'view', label: 'Справочник контрагентов' },
      { key: 'create_manual', label: 'Ручное добавление контрагентов по ИНН' },
      { key: 'request_partnership', label: 'Отправка заявки на сотрудничество' },
      { key: 'respond_partnership', label: 'Принятие или отклонение заявок' },
      { key: 'terminate', label: 'Прекращение сотрудничества' },
      { key: 'tab_counterparties', label: 'Видит вкладку «Мои контрагенты»' },
      { key: 'tab_partnerships', label: 'Видит вкладку «Заявки на сотрудничество»' },
      { key: 'tab_catalog', label: 'Видит вкладку «Каталог организаций КР»' },
    ],
  },
  files: {
    label: 'Реестр Файлов (Облачный архив R2)',
    actions: [
      { key: 'view', label: 'Просмотр сканов и файлов' },
      { key: 'download', label: 'Скачивание оригиналов файлов' },
      { key: 'upload', label: 'Загрузка новых сканов' },
      { key: 'delete', label: 'Удаление файлов из архива' },
      { key: 'view_details', label: 'Доступ на просмотр данных внутри модуля' },
      { key: 'edit', label: 'Редактирование описаний и категорий' },
    ],
  },
  company: {
    label: 'Моя Организация & Периоды',
    actions: [
      { key: 'view', label: 'Просмотр карточки компании' },
      { key: 'edit', label: 'Редактирование реквизитов' },
      { key: 'periods_view', label: 'Журнал закрытых периодов' },
      { key: 'periods_manage', label: 'Управление закрытием / открытием периодов' },
      { key: 'upload_legal_doc', label: 'Загрузка уставных файлов' },
      { key: 'tab_profile', label: 'Видит вкладку «Профиль & Реквизиты»' },
      { key: 'tab_legal_docs', label: 'Видит вкладку «Учредительные Документы»' },
      { key: 'tab_periods', label: 'Видит вкладку «Закрытие периода»' },
    ],
  },
  employees: {
    label: 'Сотрудники и Доступы',
    actions: [
      { key: 'view', label: 'Список сотрудников' },
      { key: 'create_employee', label: 'Прием и одобрение соискателей в штат' },
      { key: 'edit_role', label: 'Настройка ролей и матрицы доступов' },
      { key: 'edit_employee', label: 'Редактирование должностей сотрудников' },
      { key: 'telegram_bind', label: 'Привязка Telegram-уведомлений' },
      { key: 'tab_my_profile', label: 'Видит вкладку «Мой профиль»' },
      { key: 'tab_employees', label: 'Видит вкладку «Мои сотрудники»' },
      { key: 'tab_roles', label: 'Видит вкладку «Роли и доступы»' },
    ],
  },
  subscription: {
    label: 'Тариф и Подписка',
    actions: [
      { key: 'view', label: 'Просмотр тарифа и квот' },
      { key: 'manage_subscription', label: 'Управление тарифом и оплата (Владелец)' },
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
      // Закрытие периодов и управление подпиской по умолчанию недоступны без явного назначения
      if (action === 'tab_periods' || action === 'periods_manage' || action === 'manage_subscription') {
        return false;
      }
      return true;
    }
    if (
      module === 'documents' &&
      (action === 'create' || action === 'send' || action === 'accept' || action === 'view_details' || action === 'export')
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
 * Валидация прав доступа с выбросом ошибки 403 Forbidden
 */
export function requirePermission(
  profile: UserProfile | null | undefined,
  module: ModuleName,
  action: ActionName,
  customErrorMessage?: string
): void {
  if (!hasPermission(profile, module, action)) {
    throw new Error(
      customErrorMessage || `403 Forbidden: Недостаточно прав для выполнения действия [${module}.${action}]`
    );
  }
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
 * Проверка права на редактирование профиля компании (Строго ТОЛЬКО Владелец или Суперадмин)
 */
export function canEditCompanyProfile(
  profile: UserProfile | null | undefined,
  companyOwnerId?: string
): boolean {
  if (!profile) return false;
  if (profile.is_super_admin) return true;
  if (profile.role === 'owner') return true;
  if (companyOwnerId && profile.id === companyOwnerId) return true;
  return hasPermission(profile, 'company', 'edit');
}
