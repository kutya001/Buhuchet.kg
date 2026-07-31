# Анализ и План Имплементации: Исправление Проверки Прав и Ролевой Модели (RBAC Enforcer)

Данный документ содержит полный анализ причин, почему сохраненные матрицы доступов (`company_roles.permissions`) не ограничивали действия сотрудников, а также пошаговый план внедрения единой системы проверки прав на бэкенде и фронтенде.

---

## 🔍 Проведённый Анализ Проблемы (Root Cause)

1. **Серверные экшены не запрашивали и не проверяли `permissions`:**
   - В функциях `getUserContext()` во всех Server Actions (`documents/actions.ts`, `files/archive-actions.ts`, `counterparties/actions.ts`, `employees/actions.ts`) выборка из Supabase делалась только по полям `company_id, role, is_super_admin`.
   - Таблица `company_roles` с JSONB-полем `permissions` не присоединялась через `JOIN`, и ни один экшен не сверял права роли перед выполнением `insert`, `update` или `delete`.

2. **Навигация UI показывала все модули без ограничений:**
   - Боковое меню `DashboardShell.tsx` и верхний топбар `FloatingTopbar.tsx` отрисовывали все пункты меню (Документы, Файлы, Организации, Сотрудники, Экспорт 1С) вне зависимости от назначенных галочек роли.

3. **Отсутствие единого Permission Engine:**
   - В проекте не было централизованного хелпера `hasPermission(userProfile, module, action)`, учитывающего иерархию ролей (Суперадмин / Владелец имеют 100% прав всегда, а сотрудники — строго по матрице).

---

## 🛠️ Предлагаемые Шаги Реализации

### Step 1: Единый Модуль Разрешений (`lib/auth/permissions.ts`) [NEW]
Создать модуль `lib/auth/permissions.ts` с функциями:
- `hasPermission(profile: UserProfile | null, module: string, action: string): boolean`:
  - `is_super_admin === true` ➔ `true` (Суперадмину разрешено всё).
  - `role === 'owner'` или `company_roles?.is_system === true` ➔ `true` (Владельцу разрешено всё).
  - Проверка значения `profile?.company_roles?.permissions?.[module]?.[action] === true`.
  - Если роль не задана (`role_id === null`), для обычных сотрудников по умолчанию разрешен базовый просмотр `view` основных разделов.

### Step 2: Защита Server Actions на Бэкенде (Server Enforcer)
Обновить `getUserContext()` в серверных файлах:
- Подтягивать привязанную роль: `select('*, company_roles(*)')`.
- Добавить принудительные проверки прав через `hasPermission` в серверные функции:
  - **Модуль Документы ([app/dashboard/documents/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)):**
    - `getB2BDocumentsAction` ➔ `documents.view`
    - `createB2BDocumentAction` ➔ `documents.create`
    - `updateB2BDocumentFullAction` ➔ `documents.edit`
    - `updateB2BDocumentStatusAction` (для статуса `accepted` ➔ `documents.accept`, для `recalled` ➔ `documents.recall`)
    - `deleteB2BDocumentAction` ➔ `documents.delete`
  - **Модуль Файлы ([app/dashboard/files/archive-actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts)):**
    - `getArchiveFilesAction` ➔ `files.view`
    - `uploadDocumentFileAction` / `uploadLegalDocumentAction` ➔ `files.upload`
    - `deleteDocumentFileAction` ➔ `files.delete`
  - **Модуль Контрагенты ([app/dashboard/counterparties/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)):**
    - `getCounterpartiesAction` ➔ `counterparties.view`
    - `createCounterpartyAction` ➔ `counterparties.create`
    - `updateCounterpartyAction` ➔ `counterparties.edit`
  - **Модуль Сотрудники ([app/dashboard/employees/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/employees/actions.ts)):**
    - `createEmployeeAction` / `updateCompanyRoleAction` / `resetEmployeePasswordAction` ➔ `employees.manage`

### Step 3: Динамическая Фильтрация Навигации и Экран 403 (UI Protection)
- В `app/dashboard/layout.tsx` передавать в `DashboardShell` полную модель `profile` (с `company_roles`).
- В `DashboardShell.tsx` скрывать разделы бокового меню, если `hasPermission(profile, module, 'view') === false`.
- Создать переиспользуемый клиентский компонент `AccessDeniedCard.tsx` (Экран 403: *"У вашей роли недостаточно прав для доступа к данному разделу"*).
- На страницах дашборда при отсутствии права `view` вместо контента выводить `AccessDeniedCard`.
- Скрывать кнопки создания/редактирования/удаления на страницах, если `hasPermission(profile, module, action) === false`.

---

## 📊 План Верификации

### Автоматические тесты & Компиляция
- Запуск проверки типов: `npx tsc --noEmit`.
- Проверка проектной сборки: `npm run build`.

### Сценарии проверки (Manual QA):
1. **Тест роли «Кладовщик» (ограниченный доступ):**
   - Настроить роль: разрешить только `documents.view` и `files.view`, отключить доступ к `employees`, `counterparties` и создание документов.
   - Войти под сотрудником с этой ролью.
   - **Ожидаемый результат:** В сайдбаре исчезают пункты «Сотрудники» и «Организации». На странице Документы исчезает кнопка «+ Создать документ». При прямой попытке ввести в URL `/dashboard/employees` открывается экран "403 Доступ запрещен".
2. **Тест Владельца / Суперадмина:**
   - **Ожидаемый результат:** 100% полный доступ ко всем кнопкам и разделам без ограничений.
