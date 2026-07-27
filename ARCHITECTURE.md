# ARCHITECTURE.md — Архитектура и технический дизайн системы

Этот документ описывает архитектурное устройство, потоки данных (Data Flow), структуры компонентов и правила взаимодействия системных модулей для сервиса автоматизации первичной документации в Кыргызстане (Buhuchet.kg).

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
   | - Client-side Excel Generator (SheetJS / xlsx)              |
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
| **Хранилище файлов** | **Cloudflare R2** | Приватное объектное S3-совместимое хранение сканов, фото накладных и PDF-чеков. |
| **Client Export** | **SheetJS (xlsx)** | Генерация файлов Excel для 1С прямо в браузере бухгалтера без нагрузки на сервер Vercel. |
| **UI System** | **Tailwind CSS + Shadcn UI** | Дизайн-система в темных тонах, компоненты карточек, таблиц, модалок и эффекты glassmorphic. |

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
[ Supabase Auth context ] ──► Получает `user_id` и `company_id`
           │
           ▼
[ RLS Policy Filter ] ──► Применяет автоматический фильтр:
                          WHERE company_id = (SELECT company_id FROM users WHERE id = auth.uid())

```

### Маршрутизация (Route Tree):

- `/login` — Аутентификация по Email / Паролю.
- `/onboarding` — Форма первого входа: регистрация компании с валидацией ИНН 14 цифр КР.
- `/dashboard` — Сводные показатели первичных документов и статус подписки.
- `/dashboard/documents` — Реестр документов с фильтрацией по типам, статусам и датам.
- `/dashboard/documents/new` — Форма создания документа с табличной частью товаров и Mock Dropzone.
- `/dashboard/documents/[id]` — **Split-Screen View** (слева скан `ScanViewer`, справа детали и смена статусов).
- `/dashboard/counterparties` — Справочник Контрагентов (ИНН 14 цифр, статус НДС).
- `/dashboard/nomenclature` — Справочник Номенклатуры (коды 1С, цены сом).
- `/dashboard/subscription` — Карточка подписки, тарифы и модалка QR-оплаты (MBank / Оптима).
- `/dashboard/export` — Модуль клиентской выгрузки документов в 1С Excel.
- `/super-admin` — Реестр всех организаций, блокировка компаний и управление подписками.

---

## 4. ЖИЗНЕННЫЙ ЦИКЛ ДОКУМЕНТА (STATUS STATE MACHINE)

```text
       +---------+
       |  Draft  | (Черновик: создается менеджером)
       +----+----+
            |
            v
       +---------+
       | Review  | (На проверке: поступает к бухгалтеру)
       +----+----+
            |
      +-----+-----+
      |           |
      v           v
+----------+ +----------+
| Approved | | Rejected | (Отклонен: возврат с комментарием в Draft)
+----+-----+ +----------+
     |
     v
+------------+
| Posted_1C  | (Проведен в 1С: финальный статус, блокировка изменений)
+------------+

```

Любое изменение статуса фиксируется в таблице аудита `document_logs` с сохранением `user_id`, времени и комментария.

---

## 5. ПОТОК ВЫГРУЗКИ В 1С (CLIENT-SIDE EXCEL GENERATION)

1. Бухгалтер выбирает период и статус документов (`approved`, `posted_1c`) на странице `/dashboard/export` или в реестре.
2. Фронтенд делает запросы к Supabase через Server Action / SDK и получает массив `documents` и `document_items`.
3. Модуль `lib/export/1c-exporter.ts` преобразует данные в массив `Export1CRow[]`.
4. Библиотека `xlsx` (SheetJS) создает книгу `.xlsx` в оперативной памяти браузера и инициирует скачивание файла вида `export_1c_[company_name]_[date].xlsx`.
5. **Процессорное время Vercel не расходуется, таймаут 10 секунд не наступает.**
