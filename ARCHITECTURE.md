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
| **Движок Прав (RBAC)** | **lib/auth/permissions.ts** | Единый централизованный проверщик доступов сотрудника к конкретным модулям и кнопкам на клиенте и сервере. |
| **UI System** | **Tailwind CSS + Shadcn UI** | Дизайн-система в темных тонах, мобильная шторка (Bottom Sheet), парящие навигационные элементы (`FloatingBottomNav`, `FloatingTopbar`) и адаптивные карточные реестры. |

---

## 3. МУЛЬТИАРЕНДНОСТЬ И ПОТОК ИЗОЛЯЦИИ ДАННЫХ (MULTI-TENANCY DATA FLOW)

Система использует **Single Database, Shared Schema, Tenant ID Pattern** (Одна БД, общая схема, изоляция по `company_id`).

### Поток идентификации компании (Tenant Resolution):

```text
[ Запрос от пользователя ] 
           │
           ▼
[ Next.js Middleware ] ──► Извлекает Supabase Auth JWT
           │
           ▼
[ Server Context (getUserContext) ] ──► Запрашивает профиль `users` + `company_roles` + `companies`
           │
           ├─► Изоляция RLS по `company_id`
           └─► Проверка прав через `hasPermission(profile, module, action)`
```

---

## 4. СХЕМА МОДУЛЕЙ И СТРУКТУРА РОУТОВ (APP ROUTER SITEMAP)

### 4.1 Публичные Страницы (Public Routes)
- `/` — Главная презентационная страница (Лендинг платформы, адаптивный под мобильные экраны от 360px).
- `/login` — Экран входа в систему (email + пароль).
- `/register` — Регистрация новой организации (создание компании + аккаунт владельца).
- `/onboarding` — Мастер первичной настройки профиля организации и повторной отправки на модерацию.

### 4.2 Защищенный Интерфейс Пользователя (`/dashboard`)
- `/dashboard` — Главная аналитическая панель с метриками движения документов.
- `/dashboard/documents` — Реестр Электронного документооборота B2B.
- `/dashboard/documents/new` — Мастер создания новой B2B отправки.
- `/dashboard/documents/[id]` — Детальный просмотр документа с возможностью принятия или отзыва.
- `/dashboard/files` — Облачный архив сканов и первичной документации.
- `/dashboard/counterparties` — Единый реестр контрагентов и управление партнерскими связями.
- `/dashboard/employees` — Управление сотрудниками компании и настройка ролевой матрицы RBAC.
- `/dashboard/company` — Профиль и реквизиты собственной организации.
- `/dashboard/profile` — Личные настройки аккаунта и самостоятельная смена пароля.

### 4.3 Изолированная Панель Суперадминистратора (`/super-admin`)
- `/super-admin` — Панель суперадмина с модерацией заявок организаций, просмотром всех системных пользователей, реестра файлов, документов и инспектором БД.

---

## 5. ПОТОКИ ДАННЫХ (DATA FLOW SPECIFICATIONS)

### 5.1 Загрузка и Хранение Сканов (Cloudflare R2 Two-Tier Upload Flow)
1. **Клиентская компрессия:** Браузер принимает изображение и сжимает его через `browser-image-compression` до `1000px` ширины и объема `< 200 КБ`.
2. **Получение Presigned URL:** Клиент вызывает Server Action `getPresignedUploadUrlAction()`.
3. **Прямая загрузка:** Клиент выполняет HTTP PUT напрямую в Cloudflare R2 bucket.
4. **Резервный прокси:** При сетевой блокировке или CORS-ошибке клиент вызывает `uploadFileDirectlyServerAction()` для передачи файла через бэкенд Next.js.
5. **Запись метаданных:** Метаданные файла и `size_bytes` записываются в таблицу `files` Supabase.
