# Анализ и План Имплементации: Исправление Проверки Прав (RBAC) и Обработка Заблокированных Организаций

Данный документ содержит детальный анализ причин, почему сохраненные матрицы доступов (`company_roles.permissions`) не ограничивали действия сотрудников, а также технические требования к блокировке организаций суперадминистратором, плашке причины блокировки при входе и механизму прекращения сотрудничества для контрагентов.

---

## 🔍 Проведённый Анализ Проблема (Root Cause)

1. **Серверные экшены не запрашивали и не проверяли `permissions`:**
   - В функциях `getUserContext()` во всех Server Actions (`documents/actions.ts`, `files/archive-actions.ts`, `counterparties/actions.ts`, `employees/actions.ts`) выборка из Supabase делалась только по полям `company_id, role, is_super_admin`.
   - Таблица `company_roles` с JSONB-полем `permissions` не присоединялась через `JOIN`, и ни один экшен не сверял права роли перед выполнением `insert`, `update` или `delete`.

2. **Навигация UI показывала все модули без ограничений:**
   - Боковое меню `DashboardShell.tsx` и верхний топбар `FloatingTopbar.tsx` отрисовывали все пункты меню (Документы, Файлы, Организации, Сотрудники, Экспорт 1С) вне зависимости от назначенных галочек роли.

3. **Отсутствие проверки блокировки компании (`company.status === 'blocked'`):**
   - Блокировка суперадмина сохранялась в `companies.status = 'blocked'`, но в дашборде не было экрана предупреждения с причиной `moderation_comment`, а контрагенты не видели предупреждающий красный индикатор у заблокированного партнера.

---

## 🛠️ Предлагаемые Шаги Реализации

### Step 1: Единый Модуль Разрешений (`lib/auth/permissions.ts`) [NEW]
Создать модуль `lib/auth/permissions.ts` с функциями:
- `hasPermission(profile: UserProfile | null, module: string, action: string): boolean`:
  - `is_super_admin === true` ➔ `true` (Суперадмину разрешено всё).
  - `role === 'owner'` или `company_roles?.is_system === true` ➔ `true` (Владельцу разрешено всё).
  - Проверка значения `profile?.company_roles?.permissions?.[module]?.[action] === true`.
  - Если роль не задана (`role_id === null`), для обычных сотрудников по умолчанию разрешен базовый просмотр `view` основных разделов.

### Step 2: Блокировка Организации и Полноэкранное Уведомление (`Blocked Company Banner`)
- В `app/dashboard/layout.tsx` запрашивать актуальный статус компании `company.status` и `company.moderation_comment`.
- Если статус компании `status === 'blocked'` (и пользователь не является Суперадмином):
  - Перехватывать отображение дашборда и выводить специальный экран **`CompanyBlockedView.tsx`**:
    > 🔴 **Организация заблокирована Администратором платформы**
    > **Причина блокировки:** `{company.moderation_comment}`
    > *Все операции приема/отправки документов и загрузки файлов приостановлены.*

### Step 3: Подсветка Заблокированных Партнеров и Прекращение Сотрудничества (`Counterparties`)
- В реестре организаций и контрагентов ([app/dashboard/counterparties/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/page.tsx)):
  - При получении списка контрагентов подтягивать статус связанной организации: `target_company:companies!target_company_id(status, moderation_comment)`.
  - Если статус партнера `status === 'blocked'`:
    - Выводить красный пульсирующий бейдж: **🔴 Заблокирован**.
    - Добавить яркую кнопку **«Прекратить сотрудничество»** (`deleteCounterpartyAction` / `deleteCompanyPartnershipAction`) с модальным окном подтверждения.

### Step 4: Защита Server Actions на Бэкенде (Server Enforcer)
Обновить `getUserContext()` в серверных файлах:
- Подтягивать привязанную роль и статус компании.
- Если статус компании `blocked` — блокировать все сменяющие состояние операции.
- Добавить проверки `hasPermission` в серверные функции:
  - **Документы:** `getB2BDocumentsAction` (view), `createB2BDocumentAction` (create), `updateB2BDocumentStatusAction` (accept/recall), `deleteB2BDocumentAction` (delete).
  - **Файлы:** `getArchiveFilesAction` (view), `uploadDocumentFileAction` (upload), `deleteDocumentFileAction` (delete).
  - **Контрагенты:** `getCounterpartiesAction` (view), `createCounterpartyAction` (create).
  - **Сотрудники:** `createEmployeeAction` / `updateCompanyRoleAction` (manage).

### Step 5: Динамическая Фильтрация Навигации и Экран 403 (UI Protection)
- В `DashboardShell.tsx` скрывать разделы бокового меню, если `hasPermission(profile, module, 'view') === false`.
- Создать компонент `AccessDeniedCard.tsx` (Экран 403) для закрытых разделов.

---

## 📊 План Верификации

### Автоматические тесты & Компиляция
- Запуск проверки типов: `npx tsc --noEmit`.
- Проверка проектной сборки: `npm run build`.

### Сценарии проверки (Manual QA):
1. **Тест блокировки организации Суперадмином:**
   - В `/super-admin` заблокировать тестовую компанию с указанием причины (например, *"Нарушение правил B2B сети"*).
   - Войти под пользователем этой компании ➔ Убедиться, что выводится уведомление о блокировке с указанной причиной.
2. **Тест видимости у Контрагентов:**
   - Войти под компанией-партнером ➔ Убедиться, что заблокированная организация подсвечена красным бейджем **"Заблокирован"** и доступна кнопка **«Прекратить сотрудничество»**.
3. **Тест роли с ограниченными правами:**
   - Убедиться, что ролевые ограничения скрывают пункты меню и защищают Server Actions.
