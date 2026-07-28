# Implementation Plan — B2B Подтверждение Партнерства и Отрасли Организаций

Этот план описывает внедрение механизмов запроса и подтверждения сотрудничества между организациями, защиту официальных реквизитов контрагентов, отраслевой каталог компаний и ограничение B2B документооборота только подтвержденными партнерами.

## User Review Required

> [!IMPORTANT]
> - **Отраслевой признак (`industry`):** Каждая организация относит себя к одной из 8 предустановленных отраслей КР (Горнодобывающая, Ритейл, Транспорт, IT и т.д.).
> - **Подтверждение партнерства (B2B Handshake):** Документы разрешено отправлять **ТОЛЬКО** компаниям, чей статус заявки на сотрудничество находится в состоянии `approved`.
> - **Каталог Компаний (`/dashboard/companies-catalog`):** Публичный реестр юридических лиц платформы для поиска партнеров и отправки запросов на сотрудничество.
> - **Защита реквизитов контрагента:** Официальное наименование, ИНН и Email берутся напрямую из профиля зарегистрированной компании-партнера. Пользователям запрещено их редактировать; редактированию подлежит **только примечание (`comment`)**.

---

## Proposed Changes

### 1. Серверные Миграции DDL & Сидирование Supabase (PostgreSQL)

#### SQL Execution via Supabase MCP:
- Добавление колонки `industry TEXT DEFAULT 'Услуги / Консалтинг'` в таблицу `companies`.
- Создание таблицы `company_partnerships` (`requester_company_id`, `target_company_id`, `status: pending|approved|rejected`).
- Сидирование 4 тестовых организаций КР с разным отраслевым профилем (*ОсОО "Кумтор Голд Компани"*, *ОсОО "Народный Трейд"*, *ЗАО "Батыш Логистик"*, *ОсОО "Бишкек Софт"*) и установкой тестовых связей.

---

### 2. Типы & Валидация Zod

#### [MODIFY] [database.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/database.types.ts)
- Добавление константы `INDUSTRIES` (список отраслей).
- Модель `CompanyPartnership`.
- Поле `industry` в модели `Company`.

---

### 3. Модуль Партнерства & Server Actions

#### [NEW] [app/dashboard/partnerships/actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/actions.ts)
- `sendPartnershipRequestAction(targetCompanyId)` — создание заявки `pending`.
- `respondToPartnershipRequestAction(partnershipId, status)` — одобрение (`approved`) или отклонение (`rejected`). Авто-добавление организаций в справочники `counterparties` друг друга при `approved`.

---

### 4. Потребительский Интерфейс & Страницы

#### [NEW] [app/dashboard/companies-catalog/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/companies-catalog/page.tsx)
- Каталог организаций с поиском по названию, ИНН и фильтрацией по Отраслям КР.
- Кнопки отправки заявки / отображение текущего статуса партнерства.

#### [NEW] [app/dashboard/partnerships/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/partnerships/page.tsx)
- Вкладки: **Входящие заявки** (Кнопки `Принять` / `Отклонить`), **Исходящие заявки** (Статус `pending`/`approved`/`rejected`).

#### [MODIFY] [app/dashboard/documents/new/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/documents/new/page.tsx)
- Фильтрация выпадающего списка получателей: выводить **ТОЛЬКО** компании с подтвержденным статусом `approved`.
- Заглушка/Баннер с кнопкой перехода в Каталог, если нет ни одного одобренного партнера.

#### [MODIFY] [app/dashboard/counterparties/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)
- Использование официальных реквизитов из `companies`.
- Ограничение редактирования: пользователю доступно изменение только внутреннего примечания `comment`.

#### [MODIFY] [app/dashboard/company/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/company/page.tsx)
- Поле выбора отрасли организации при редактировании профиля.

#### [MODIFY] [app/dashboard/layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/dashboard/layout.tsx)
- Добавление ссылок в сайдбар: **«Каталог Компаний»** и **«Заявки на Партнерство»**.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Регистрация/Вход под организацией А: выбор отрасли в профиле `/dashboard/company`.
2. Переход в `/dashboard/companies-catalog` -> поиск компании Б -> нажатие «Отправить заявку на сотрудничество».
3. Вход под организацией Б: переход в `/dashboard/partnerships` -> одобрение входящей заявки.
4. Проверка формы `/dashboard/documents/new` у организации А -> компания Б появляется в списке получателей.
