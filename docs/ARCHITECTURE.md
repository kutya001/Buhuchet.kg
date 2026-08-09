# ARCHITECTURE.md — Архитектура и технический дизайн системы

Этот документ описывает архитектурное устройство, потоки данных (Data Flow), структуры компонентов и правила взаимодействия системных модулей для сервиса B2B документооборота и облачного архива первички в Кыргызстане (Buhuchet.kg).

---

## 1. ОБЩАЯ СХЕМА АРХИТЕКТУРЫ (HIGH-LEVEL OVERVIEW)

Система построена по Serverless-архитектуре на базе **Next.js (App Router)** с делегированием аутентификации, хранения данных и прав доступа сервисам **Supabase** (PostgreSQL RLS) и **Cloudflare R2**.

```text
                  [ Клиентский уровень (Clients) ]
   +-------------------------------------------------------------+
   |  PWA / Web App (Next.js Frontend)  |  Telegram Bot Client   |
   +------------------------------------+------------------------+
                                         |
                                         v
                 [ Инфраструктура Vercel / Next.js ]
   +-------------------------------------------------------------+
   | - Middleware (Сессии, Роутинг, Редирект Onboarding)         |
   | - React Server Components (RSC) & Server Actions            |
   | - RBAC Permission Engine (lib/auth/permissions.ts)          |
   | - Permanent Module Tab Navigation Engine                    |
   | - Two-Tier R2 Upload Engine (Direct PUT + Server Proxy)     |
   +-------------------------------------------------------------+
          |                      |                       |
          v                      v                       v
[ PostgreSQL (Supabase) ]  [ Cloudflare R2 ]   [ Upstash QStash ]
- Auth / Users             - Private Storage   - Background Jobs
- Multi-tenant RLS         - Presigned URLs    - Async Webhooks
- Core Business Tables     - Compressed Scans  - Telegram Responses
```

---

## 2. СТЕК ТЕХНОЛОГИЙ И ИХ ЗОНЫ ОТВЕТСТВЕННОСТИ

| Компонент | Технология | Отвечает за |
| --- | --- | --- |
| **Fullstack Framework** | **Next.js (App Router)** | Рендеринг интерфейса (RSC), API-маршруты, Server Actions, авторизационный middleware. |
| **База данных & Auth** | **Supabase (PostgreSQL)** | Авторизация пользователей, хранение структуры компаний, документов и справочников, соблюдение RLS (Row Level Security). |
| **Хранилище файлов** | **Cloudflare R2** | Приватное объектное S3-совместимое хранение сканов, фото накладных и уставных документов. |
| **Загрузчик файлов (Two-Tier)** | **browser-image-compression + Server Proxy** | Сжатие фото до 1000px / <200КБ в браузере. Прямой PUT в R2 с автоматическим переключением на серверный экшен-прокси при CORS/сетевых сбоях. |
| **Движок Прав (RBAC)** | **lib/auth/permissions.ts** | Единый проверщик доступов сотрудника. Вкладки модулей рендерятся безусловно. |
| **Компонент Реестров** | **UnifiedDataGrid.tsx** | Табличный и плиточный режимы, кастомные ячейки, поиск и контекстные действия строк `getRowActions`. |
| **Унифицированный UI Пакет** | **components/ui/unified/** | Единая кроссплатформенная дизайн-система: `UnifiedWorkspaceLayout` (каркас экранов), `UnifiedViewModal` (карточка просмотра / Bottom Sheet), `UnifiedSidebar` (левое ролевое меню), `UnifiedHeader` (шапка), `UnifiedBottomNav` (мобильная PWA навигация ≥48px). |
| **UI System** | **Tailwind CSS + Shadcn UI** | Дизайн-система с тёмной/светлой темой, модальными окнами редактирования `UnifiedFormModal` и универсальной адаптивной версткой. |

---

## 3. МУЛЬТИАРЕНДНОСТЬ И ПОТОК ИЗОЛЯЦИИ ДАННЫХ (MULTI-TENANCY DATA FLOW)

Система использует **Single Database, Shared Schema, Tenant ID Pattern** (Одна БД, общая схема, изоляция по `company_id`).

```text
[ Запрос от пользователя ] 
           │
           ▼
[ Next.js Middleware ] ──► Извлекает Supabase Auth JWT
           │
           ▼
[ Server Context (getUserContext) ] ──► Использованием adminSupabase запрашивает профиль `users` + `company_roles` + `companies`
           │
           ├─► Изоляция RLS по `company_id`
           └─► Проверка прав через `hasPermission(profile, module, action)`
```

---

## 4. СХЕМА МОДУЛЕЙ И СТРУКТУРА РОУТОВ (APP ROUTER SITEMAP)

### 4.1 Публичные Страницы (Public Routes)
- `/` — Главная презентационная страница (Лендинг платформы).
- `/login` — Экран входа в систему (email + пароль).
- `/register` — Регистрация новой организации (создание компании + аккаунт владельца).
- `/onboarding` — Мастер первичной настройки профиля организации.

### 4.2 Защищенный Интерфейс Пользователя (`/dashboard`)
- `/dashboard` — Главная аналитическая панель с метриками движения документов.
- `/dashboard/documents` — Реестр Электронного документооборота B2B.
- `/dashboard/documents/new` — Форма создания B2B отправки с автоподгрузкой принятых контрагентов.
- `/dashboard/documents/[id]` — Детальный Split-screen просмотр документа.
- `/dashboard/files` — Облачный архив сканов и первичной документации.
- `/dashboard/counterparties` — Единый справочник контрагентов, входящие/исходящие заявки и каталог компаний КР.
- `/dashboard/employees` — Управление персоналом, зачисление кандидатов и матрица ролей RBAC.
- `/dashboard/company` — Профиль, реквизиты, уставные сканы R2 и закрытие периода.
- `/dashboard/profile` — Личные настройки аккаунта и самостоятельная смена пароля.

### 4.3 Изолированная Панель Суперадминистратора (`/super-admin`)
- `/super-admin` — Автоматический редирект на модуль организаций.
- `/super-admin/companies` — Реестр организаций, модерация, верификация и блокировка юридических лиц и ИП.
- `/super-admin/users` — Реестр пользователей, сброс паролей, администрирование системных ролей и доступов.
- `/super-admin/files` — Мониторинг Облачного диска, оптимизация совместного использования и скачивание файлов.
- `/super-admin/telegram` — Управление Telegram-ботами, вебхуками и историей логирования сообщений.
- `/super-admin/inspector` — Инспектор базы данных PostgreSQL с прямой диагностикой таблиц и объема ресурсов.
- `/super-admin/subscriptions` — Управление тарифными планами, лимитами объема первички и диска.
*Примечание: Боковое меню (`UnifiedSidebar`) при нахождении в `/super-admin/*` изолирует пользовательские разделы и отображает только специализированную панель навигации суперадминистратора.*

---

## 5. ПОТОКИ ДАННЫХ (DATA FLOW SPECIFICATIONS)

### 5.1 Автоматическое Создание Контрагентов при Партнерстве B2B
```text
[ Инициатор (Компания А) ] ──► Нажимает "Отправить заявку B2B" в Каталоге
                                       │ (статус: 'pending')
                                       ▼
[ Принимающий (Компания Б) ] ──► Нажимает "Принять заявку" (respondToPartnershipRequestAction)
                                       │ (статус: 'approved' / 'accepted')
                                       ▼
                         [ ensureCounterpartyLink Engine ]
                                       │
           ┌───────────────────────────┴───────────────────────────┐
           ▼                                                       ▼
[ Создает запись в `counterparties` ]                    [ Создает запись в `counterparties` ]
    company_id: A, target_company_id: B                      company_id: B, target_company_id: A
           │                                                       │
           └───────────────────────────┬───────────────────────────┘
                                       ▼
               [ Контрагенты автоматически доступны в `/documents/new` ]
```

### 5.2 Прямое Управление Базой Данных в Инспекторе БД (Super-Admin Full Access)
1. Выбор таблицы в селекторе вызываем `inspectTableDataAdminAction(tableName, limit)`.
2. Редактирование строки вызывает `updateDbRowAdminAction(tableName, pkField, pkValue, updates)`.
3. Удаление строки вызывает `deleteDbRowAdminAction(tableName, pkField, pkValue)`.
4. Изменения мгновенно применяются в PostgreSQL через Service Role клиент `adminSupabase`.

---

## 6. БЕЗОПАСНОСТЬ И АРХИТЕКТУРА СУБД (SECURITY & SSOT SPECIFICATIONS)

### 6.1 Единый Источник Правды Схемы (SSOT)
- Все физические таблицы, индексы, RLS-политики и триггеры версионируются в хронологических SQL-миграциях Supabase CLI (`supabase/migrations/*.sql`).
- Базовый сидинг демо-данных КР находится в `supabase/seed.sql`. Генерация типов выполняется через `npm run types:generate`.

### 6.2 Защищенная Валидация Server Actions (`createSafeAction`)
- Все мутирующие серверные вызовы оборачиваются в `createSafeAction` на базе `zod`.
- Функция автоматически проверяет сессию `getSeverUserContext()`, парсит payload по Zod-схеме и экранирует необработанные 500 исключения.

### 6.3 Аппаратная Защита Закрытых Периодов (PostgreSQL Triggers & RLS)
- Триггерная функция PostgreSQL `check_closed_period_lock()` отслеживает закрытие месяцев в `company_closed_periods` и блокирует вызовы `INSERT/UPDATE/DELETE` над таблицами `documents` и `files`.
- Владельцы компании (`owner`) и суперадмины сохраняют исключительное право корректировки.

### 6.4 Защита Telegram Webhook Секретным Токеном
- Запросы к `/api/telegram/webhook` проверяются по заголовку `x-telegram-bot-api-secret-token` на соответствие переменной `TELEGRAM_WEBHOOK_SECRET`.
- При вызове `setWebhook` в Telegram API передается параметр `secret_token`.

### 6.5 Оптимизация Производительности СУБД и RLS (Migration 20260809000010)
- Вызовы `auth.uid()` в RLS-политиках оборачены в выражение `(SELECT auth.uid())` для мемоизации идентификатора пользователя в рамках одной итерации выборки PostgreSQL.
- Созданы составные (composite) индексы под частые фильтры: `idx_documents_company_status_date` on `documents(company_id, status, doc_date DESC)`, `idx_files_company_created` on `files(company_id, created_at DESC)`, `idx_company_partnerships_lookup` on `company_partnerships(requester_company_id, target_company_id, status)`.
- Контекст сессии `getSeverUserContext` мемоизирован с помощью `React.cache()` для исключения дублирующих DB-запросов за один HTTP-цикл.


