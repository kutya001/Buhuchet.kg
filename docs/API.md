# Спецификация API и Server Actions (Buhuchet.kg)

Настоящий документ является Единым Источником Правды (SSOT) для контрактов API-эндпоинтов (Route Handlers) и серверных действий (Server Actions) платформы Buhuchet.kg. Все мутации и выборки на стороне клиента и сервера должны строго соблюдать изложенные спецификации типов и схем валидации Zod.

---

## 1. Авторизация и Уровни Доступа

- **Public**: Открытый доступ без требования авторизации (Внешние вебхуки, публичный каталог).
- **Private (Tenant)**: Доступ требует активной сессии Supabase Auth (`auth.uid()`) и принадлежности к организации `company_id`. Изолирован RLS.
- **SuperAdmin**: Требует наличия глобального флага `is_super_admin = true` в таблице `public.users`.

### Стандартный Формат Ответа Server Actions (`ActionResponse<T>`)
```ts
export type ActionResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
};
```

---

## 2. Route Handlers (REST API)

### 2.1 [PUBLIC] Прием Вебхука Telegram Bot
- **Route**: `POST /api/telegram/webhook`
- **Auth**: Public (Проверка секретного заголовка)
- **Request Headers**: `x-telegram-bot-api-secret-token: <TELEGRAM_WEBHOOK_SECRET>`
- **Request Body**: `TelegramUpdate`
- **Response**: `{ ok: boolean }` | `401 Unauthorized`
- **Бизнес-логика**: Прием 4-значных кодов привязки, отправка Telegram-уведомлений, запись аудита в `telegram_logs`.
- **Таблицы БД**: `telegram_verification_codes`, `telegram_connections`, `telegram_logs`

### 2.2 [PUBLIC] Регистрация и Инспектирование Webhook Telegram
- **Route**: `GET /api/telegram/webhook`
- **Query Params**: `?action=info` (опционально)
- **Response**: `{ success: boolean, info?: object, message?: string }`
- **Бизнес-логика**: Вызов `setWebhook` с передачей `secret_token` в Telegram API.

### 2.3 [PRIVATE] Прямая Загрузка Файлов и Сканов в Cloudflare R2
- **Route**: `POST /api/upload-direct`
- **Auth**: Private (Tenant)
- **Request Headers**: `Authorization: Bearer <token>`
- **Request Body**: `FormData` (`file: File`, `company_id?: string`)
- **Response**: `{ success: boolean, data: { fileKey: string }, error?: string }`
- **Бизнес-логика**: Загрузка сжатого скана/документа в корзину Cloudflare R2 по пути `companies/{company_id}/{year}/{month}/{uniqueId}-{fileName}`.
- **Таблицы БД**: Cloudflare R2 Bucket (`buhuchet-scans`)

---

## 3. Server Actions (RPC Endpoints)

---

### 3.1 Модуль «Моя Организация» (`app/dashboard/company/actions.ts`)

#### `getCompanyProfileStatsAction`
- **Auth**: Private (Tenant)
- **RBAC**: `company:view`
- **Input**: `targetCompanyId?: string`
- **Response**: `ActionResponse<CompanyProfileStats>`
- **Таблицы БД**: `files`, `documents`, `company_partnerships`, `users`

#### `updateCompanyProfileAction`
- **Auth**: Private (Tenant)
- **RBAC**: `company:edit` (Строго Руководитель / Owner)
- **Zod Schema**: `z.object({ closedPeriodUntil: z.string().nullable() })`
- **Response**: `ActionResponse<Company>`
- **Проверка Закрытого Периода**: Да
- **Таблицы БД**: `companies`

#### `updateCompanyPrivacyAndDetailsAction`
- **Auth**: Private (Tenant)
- **RBAC**: `company:edit` (Строго Руководитель / Owner)
- **Zod Schema**: `z.object({ legalForm: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional(), privacySettings: z.object({ show_phone: z.boolean(), show_email: z.boolean(), show_address: z.boolean() }).optional() })`
- **Response**: `ActionResponse<Company>`
- **Таблицы БД**: `companies`

#### `toggleMonthClosedStatusAction`
- **Auth**: Private (Tenant)
- **RBAC**: `company:edit` (Строго Руководитель / Owner)
- **Zod Schema**: `z.object({ year: z.number(), month: z.number(), targetStatus: z.enum(['open', 'closed']), comment: z.string().optional() })`
- **Response**: `ActionResponse<ClosedPeriodItem>`
- **Таблицы БД**: `company_closed_periods`

---

### 3.2 Модуль «Электронный Документооборот (ЭДО)» (`app/dashboard/documents/actions.ts`)

#### `getDocumentsAction`
- **Auth**: Private (Tenant)
- **RBAC**: `documents:view`
- **Input**: `params?: { status?: string; docType?: string; search?: string }`
- **Response**: `ActionResponse<Document[]>`
- **Таблицы БД**: `documents`, `companies`, `users`

#### `createDocumentAction`
- **Auth**: Private (Tenant)
- **RBAC**: `documents:create`
- **Zod Schema**: `documentSchema` (`receiver_company_id: string`, `doc_type: string`, `doc_date: string`, `doc_number?: string`, `comment?: string`)
- **Response**: `ActionResponse<Document>`
- **Проверка Закрытого Периода**: Да (`check_closed_period_lock` Trigger)
- **Таблицы БД**: `documents`, `document_logs`

#### `updateDocumentStatusAction`
- **Auth**: Private (Tenant)
- **RBAC**: `documents:accept` / `documents:recall`
- **Zod Schema**: `z.object({ documentId: z.string().uuid(), newStatus: z.enum(['draft', 'sent', 'recalled', 'accepted', 'processed', 'cancelled']), comment: z.string().optional() })`
- **Response**: `ActionResponse<Document>`
- **Проверка Закрытого Периода**: Да
- **Таблицы БД**: `documents`, `document_logs`

#### `deleteDocumentAction`
- **Auth**: Private (Tenant)
- **RBAC**: `documents:delete`
- **Zod Schema**: `z.object({ documentId: z.string().uuid() })`
- **Response**: `ActionResponse<{ message: string }>`
- **Проверка Закрытого Периода**: Да
- **Таблицы БД**: `documents`

---

### 3.3 Модуль «Контрагенты и Каталог» (`app/dashboard/counterparties/actions.ts`)

#### `getCounterpartiesAction`
- **Auth**: Private (Tenant)
- **RBAC**: `counterparties:view`
- **Response**: `ActionResponse<Counterparty[]>`
- **Таблицы БД**: `counterparties`, `companies`

#### `createCounterpartyAction`
- **Auth**: Private (Tenant)
- **RBAC**: `counterparties:create`
- **Zod Schema**: `createCounterpartySchema` (`name: string`, `inn: string` [14 digits], `is_vat_payer: boolean`, `phone?: string`, `comment?: string`)
- **Response**: `ActionResponse<Counterparty>`
- **Таблицы БД**: `counterparties`

#### `sendPartnershipRequestAction`
- **Auth**: Private (Tenant)
- **RBAC**: `counterparties:request_partnership`
- **Zod Schema**: `z.object({ targetCompanyId: z.string().uuid(), message: z.string().optional() })`
- **Response**: `ActionResponse<CompanyPartnership>`
- **Таблицы БД**: `company_partnerships`

#### `respondToPartnershipRequestAction`
- **Auth**: Private (Tenant)
- **RBAC**: `counterparties:respond_partnership`
- **Zod Schema**: `z.object({ partnershipId: z.string().uuid(), action: z.enum(['accept', 'reject', 'cancel']) })`
- **Response**: `ActionResponse<CompanyPartnership>`
- **Автоматический Эффект**: Создает взаимные записи в `counterparties` при подтверждении.
- **Таблицы БД**: `company_partnerships`, `counterparties`

---

### 3.4 Модуль «Сотрудники и Роли RBAC» (`app/dashboard/employees/actions.ts`)

#### `getMyEmployeeProfileInfoAction`
- **Auth**: Private (Tenant / Authenticated)
- **Response**: `ActionResponse<UserProfile>`
- **Бизнес-логика**: Безопасный серверный запрос полного профиля текущего пользователя с привязанными объектами `companies` и `company_roles` через `adminSupabase`.

#### `getCompanyEmployeesAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:view`
- **Input**: `page: number = 1, limit: number = 25, searchQuery?: string`
- **Response**: `ActionResponse<{ employees: UserProfile[]; totalCount: number }>`
- **Таблицы БД**: `users`, `company_roles`

#### `getPendingRequestsAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:view` (Владельцы и суперадминистраторы)
- **Input**: `companyId?: string`
- **Response**: `ActionResponse<any[]>`
- **Бизнес-логика**: Возвращает список ожидающих заявок соискателей (`company_join_requests` со статусом `pending`), сопоставляя ФИО, контакты и желаемую должность из `public.users`.
- **Таблицы БД**: `company_join_requests`, `users`

#### `approveEmployeeRequestAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:edit_employee` (Строго Руководитель / Owner)
- **Zod Schema**: `z.object({ userId: z.string().uuid(), requestId: z.string().uuid().optional(), roleId: z.string().uuid(), position: z.string() })`
- **Response**: `ActionResponse<{ message: string }>`
- **Бизнес-логика**: 
  1. Прикрепляет пользователя к организации (`users.company_id = ctx.companyId`, `role_id = params.roleId`, `position = params.position`, `role = 'manager'`).
  2. Переводит заявку в статус `status = 'approved'` с фиксацией `reviewed_by` и `reviewed_at`.
  3. Отправляет Telegram-уведомление кандидату о зачислении в штат.
- **Таблицы БД**: `users`, `company_join_requests`, `telegram_connections`

#### `rejectEmployeeRequestAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:edit_employee` (Строго Руководитель / Owner)
- **Zod Schema**: `z.object({ userId: z.string().uuid(), requestId: z.string().uuid().optional(), reason: z.string().optional() })`
- **Response**: `ActionResponse<{ message: string }>`
- **Бизнес-логика**: Переводит заявку соискателя в статус `rejected`, сбрасывает временные привязки и отправляет Telegram-уведомление об отказе.
- **Таблицы БД**: `company_join_requests`, `users`, `telegram_connections`

#### `getEmployeeDetailsAction`
- **Auth**: Private (Tenant)
- **Zod Schema**: `z.object({ employeeId: z.string().uuid() })`
- **Response**: `ActionResponse<UserProfile & { telegram_connections: any[] }>`
- **Бизнес-логика**: Загрузка полной карточки сотрудника для `UnifiedViewModal`.
- **Таблицы БД**: `users`, `company_roles`, `telegram_connections`

#### `updateEmployeeRoleAndPositionAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:edit_employee` (Строго Owner)
- **Zod Schema**: `z.object({ userId: z.string().uuid(), roleId: z.string().uuid(), position: z.string() })`
- **Response**: `ActionResponse<{ message: string }>`
- **Таблицы БД**: `users`

#### `removeEmployeeAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:edit_employee` (Строго Owner)
- **Input**: `userId: string`
- **Response**: `ActionResponse<{ message: string }>`
- **Бизнес-логика**: Исключает сотрудника из организации (`company_id = NULL`, `role_id = NULL`).
- **Таблицы БД**: `users`

#### `getCompanyRolesAction`
- **Auth**: Private (Tenant)
- **Response**: `ActionResponse<CompanyRole[]>`
- **Таблицы БД**: `company_roles`

#### `createCompanyRoleAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:manage_roles`
- **Zod Schema**: `z.object({ name: z.string().min(2), description: z.string().optional(), permissions: z.record(z.any()).optional() })`
- **Response**: `ActionResponse<CompanyRole>`
- **Таблицы БД**: `company_roles`

#### `updateCompanyRoleAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:manage_roles`
- **Zod Schema**: `z.object({ roleId: z.string().uuid(), name: z.string().min(2), description: z.string().optional(), permissions: z.record(z.any()) })`
- **Response**: `ActionResponse<CompanyRole>`
- **Таблицы БД**: `company_roles`

#### `deleteCompanyRoleAction`
- **Auth**: Private (Tenant)
- **RBAC**: `employees:manage_roles`
- **Input**: `roleId: string`
- **Response**: `ActionResponse<{ message: string }>`
- **Таблицы БД**: `company_roles`, `users`

---

### 3.5 Модуль «Облачный Архив R2 и Файлы» (`app/dashboard/files/actions.ts` & `archive-actions.ts`)

#### `getCompanyFilesAction`
- **Auth**: Private (Tenant)
- **RBAC**: `files:view`
- **Response**: `ActionResponse<FileItem[]>`
- **Таблицы БД**: `files`, `file_categories`

#### `uploadScanFileAction`
- **Auth**: Private (Tenant)
- **RBAC**: `files:upload`
- **Zod Schema**: `z.object({ fileName: z.string(), categoryId: z.string().uuid(), filePathR2: z.string(), sizeBytes: z.number(), documentId: z.string().uuid().optional() })`
- **Response**: `ActionResponse<FileItem>`
- **Проверка Закрытого Периода**: Да (`check_closed_period_lock` Trigger)
- **Таблицы БД**: `files`

#### `generateR2DownloadUrlAction`
- **Auth**: Private (Tenant)
- **RBAC**: `files:download`
- **Zod Schema**: `z.object({ fileKey: z.string() })`
- **Response**: `ActionResponse<{ presignedUrl: string }>`
- **Бизнес-логика**: Генерация временной преподписанной ссылки S3 GetObject со сроком 15 минут.

#### `getFileViewUrlAction`
- **Auth**: Private (Tenant)
- **Input**: `fileKey: string, fileName?: string`
- **Response**: `ActionResponse<{ viewUrl: string }>`
- **Бизнес-логика**: Генерация пресайн URL для онлайн-просмотра в браузере с `ResponseContentDisposition: inline` и строгим кодированием `charset=utf-8` для текстов/сканов.

#### `getFileDownloadUrlAction`
- **Auth**: Private (Tenant)
- **Input**: `fileKey: string, fileName?: string`
- **Response**: `ActionResponse<{ downloadUrl: string }>`
- **Бизнес-логика**: Генерация пресайн URL для прямого скачивания на компьютер с `ResponseContentDisposition: attachment; filename*=UTF-8''...`.

#### `getFileDetailsAction`
- **Auth**: Private (Tenant)
- **Zod Schema**: `z.object({ fileId: z.string().uuid() })`
- **Response**: `ActionResponse<DocumentFile & { ownersCount: number; isCoWShared: boolean }>`
- **Бизнес-логика**: Возвращает подробную карточку файла, категорию, привязанный источник и число совладельцев `file_owners` для `UnifiedViewModal`.

#### `getSuperAdminCompanyDetailsSafeAction`
- **Auth**: Private (SuperAdmin Only)
- **Zod Schema**: `z.object({ companyId: z.string().uuid() })`
- **Response**: `ActionResponse<{ company: Company; owner: User; employees: User[]; stats: CompanyStats }>`
- **Бизнес-логика**: Полный аудит организации, её ресурсов, объема хранилища и списка сотрудников для формы `UnifiedViewModal`.

#### `getSuperAdminUserDetailsAction`
- **Auth**: Private (SuperAdmin Only)
- **Zod Schema**: `z.object({ userId: z.string().uuid() })`
- **Response**: `ActionResponse<User & { companies: Company }>`
- **Бизнес-логика**: Детализация профиля пользователя, его роли, привязанных компаний и ID чата Telegram для `UnifiedViewModal`.

#### `getB2BDocumentDetailsAction` / `getDocumentDetailsAction`
- **Auth**: Private (Tenant / SuperAdmin)
- **Zod Schema**: `z.object({ id: z.string().uuid().optional(), docId: z.string().uuid().optional() })`
- **Response**: `ActionResponse<Document & { sender_company: Company; receiver_company: Company; counterparties: Counterparty; files: DocumentFile[]; document_items: DocumentItem[]; document_logs: DocumentLog[] }>`
- **Бизнес-логика**: Выполняет безопасный серверный гибридный запрос документа, его реквизитов и прикрепленных файлов Облачного диска без прямых клиентских JOIN-запросов, предотвращая ошибки соединения. Доступ регулируется правами организации-отправителя, получателя или контрагента.

#### `deleteDocumentFileAction`
- **Auth**: Private (Tenant)
- **Zod Schema**: `z.object({ fileId: z.string().uuid() })`
- **Response**: `ActionResponse<boolean>`
- **Бизнес-логика**: Удаляет связь в `file_owners`. Объект R2 и запись `files` удаляются только если `count(file_owners) == 0`.

#### `processPendingFileDeletionsAction`
- **Auth**: Safe Action (SuperAdmin / Service Context)
- **Zod Schema**: `z.object({ limit: z.number().optional().default(50) })`
- **Response**: `ActionResponse<{ processedCount: number }>`
- **Бизнес-логика**: Асинхронно извлекает необработанные ключи хранения из `pending_file_deletions`, вызывает физическое удаление объекта через `deleteR2Object()` и удаляет запись из очереди.

#### `updateDocumentFileAction` (Copy-on-Write)
- **Auth**: Private (Tenant)
- **Zod Schema**: `z.object({ fileId: z.string().uuid(), data: object })`
- **Response**: `ActionResponse<DocumentFile>`
- **Бизнес-логика**: Если `count(file_owners) > 1` (совместный документ), сервер создает копию физического файла/записи для редактирующей компании (CoW) и открепляет её от старого файла.

#### `getSuperAdminFilesMonitoringAction`
- **Auth**: SuperAdmin
- **Response**: `ActionResponse<{ files: any[], stats: object }>`
- **Бизнес-логика**: Анализ объемов Cloudflare R2, вычисление дедупликации CoW, точный просмотр совладельцев `file_owners`.

---

### 3.6 Панель Суперадминистратора (`app/super-admin/actions.ts`)

#### `getSuperAdminCompaniesAction`
- **Auth**: SuperAdmin (`is_super_admin = true`)
- **Response**: `ActionResponse<Company[]>`
- **Таблицы БД**: `companies`, `users`

#### `approveCompanyAction`
- **Auth**: SuperAdmin
- **Zod Schema**: `z.object({ companyId: z.string().uuid() })`
- **Response**: `ActionResponse<Company>`
- **Бизнес-логика**: 1-кликовый перевод статуса организации из `pending_approval` в `active` + отправка Telegram уведомления владельцу.
- **Таблицы БД**: `companies`

#### `getAllUsersAdminAction`
- **Auth**: SuperAdmin
- **Response**: `ActionResponse<UserProfile[]>`
- **Бизнес-логика**: Детерминированная выборка с явным FK `users_company_id_fkey` и fallback сопоставлением организаций.
- **Таблицы БД**: `users`, `companies`

#### `resetUserPasswordAdminAction`
- **Auth**: SuperAdmin
- **Input**: `userId: string, newPassword?: string`
- **Response**: `ActionResponse<{ newPassword: string }>`
- **Бизнес-логика**: Прямой административный сброс пароля в Supabase Auth (GoTrue) через Service Role API (`admin.updateUserById`), пометка `must_change_password = true` в `public.users`.
- **Таблицы БД**: `auth.users`, `public.users`

#### `inspectTableDataAdminAction`
- **Auth**: SuperAdmin
- **Zod Schema**: `z.object({ tableName: z.string(), limit: z.number().default(100) })`
- **Response**: `ActionResponse<{ rows: any[], columns: string[] }>`
- **Таблицы БД**: Прямое чтение любой таблицы PostgreSQL через `adminSupabase`.

#### `updateDbRowAdminAction` / `deleteDbRowAdminAction`
- **Auth**: SuperAdmin
- **Response**: `ActionResponse<{ message: string }>`
- **Бизнес-логика**: Прямая мутация / удаление любых строк PostgreSQL в Инспекторе БД.

---

### 3.7 Модуль «Гостевой Режим и Заявки на Вступление» (`app/dashboard/pending/actions.ts`)

#### `searchCompanyAction`
- **Auth**: Authenticated (Любой авторизованный пользователь / Гость)
- **Input**: `query: string`
- **Response**: `ActionResponse<Array<Partial<Company>>>`
- **Бизнес-логика**: Полнотекстовый поиск активных организаций Кыргызстана по ИНН или наименованию через RPC `search_companies_for_join` с безопасным fallback-запросом.
- **Таблицы БД**: `companies`

#### `submitJoinRequestAction`
- **Auth**: Authenticated (Соискатель без привязки к компании)
- **Zod / Input**: `{ companyId: string, positionNote?: string }`
- **Response**: `ActionResponse<{ requestId: string }>`
- **Бизнес-логика**:
  1. Проверяет отсутствие дублирующих открытых заявок (`status = 'pending'`).
  2. Гарантирует наличие профиля в `public.users` (защита целостности FK).
  3. Создает запись в `company_join_requests` со статусом `pending`.
  4. Отправляет мгновенное Telegram-уведомление руководству и владельцу выбранной компании.
- **Таблицы БД**: `company_join_requests`, `users`, `companies`, `telegram_connections`

#### `cancelJoinRequestAction`
- **Auth**: Authenticated (Автор заявки)
- **Input**: `requestId: string`
- **Response**: `ActionResponse<{ message: string }>`
- **Бизнес-логика**: Отзывает ранее поданную заявку соискателя (`status = 'cancelled'`).
- **Таблицы БД**: `company_join_requests`

#### `getMyJoinRequestsAction`
- **Auth**: Authenticated (Текущий пользователь)
- **Response**: `ActionResponse<Array<CompanyJoinRequest & { company_name?: string; company_inn?: string }>>`
- **Бизнес-логика**: Возвращает историю всех заявок текущего пользователя с подтягиванием реквизитов организаций.
- **Таблицы БД**: `company_join_requests`, `companies`

