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
| **UI System** | **Tailwind CSS + Shadcn UI** | Дизайн-система с тёмной/светлой темой, стеклянными модальными окнами `UnifiedFormModal` и парящим остравком `FloatingTopbar`. |

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
- `/super-admin` — Панель суперадмина: 1-кликовое одобрение организаций (`approveCompanyAction`), управление пользователями, пер первичными документами, справочниками и **Инспектор БД с полными правами на редактирование и удаление строк PostgreSQL**.

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
