# План Комплексной Оптимизации Производительности Buhuchet.kg

Решение проблемы задержек (2–3 сек) при переходах между модулями за счет устранения сетевых водопадов (Data Waterfalls), оптимизации `middleware.ts`, внедрения единого React `cache()` авторизации, тэг-кэширования справочников (`unstable_cache`) и ленивой загрузки тяжелых компонентов (`dynamic import`).

## User Review Required

> [!IMPORTANT]
> - Все оптимизации сохраняют 100% функционала безопасности (RLS, RBAC, модерация, проверки заблокированных компаний).
> - Prefetch-запросы в middleware больше не будут совершать блокирующие сетевые запросы к Supabase Auth для авторизованных сессий.
> - Повторные вызовы вычисления профиля в рамках одного RSC-запроса снизятся с 3–4 раз до 1 раза благодаря `React.cache()`.

## Proposed Changes

---

### 1. Оптимизация Авторизации и Middleware

#### [MODIFY] [middleware.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/middleware.ts)
- Добавить фильтрацию prefetch-запросов (`purpose: prefetch`, `x-middleware-prefetch`). При наличии системных cookies сессии отдавать `NextResponse.next()` мгновенно.
- Объединить повторные запросы к таблице `users` (проверки `is_super_admin`, `company_id`, `role_id`) в 1 сжатый запрос.

#### [MODIFY] [lib/supabase/server.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/supabase/server.ts)
- Добавить кэшируемые функции `getAuthenticatedUser()` и `getUserContextCached()` с использованием React `cache()`.

---

### 2. Кэширование Справочников и Вспомогательных Запросов

#### [NEW] [lib/cache/lookups.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/cache/lookups.ts)
- Внедрить `unstable_cache` для часто запрашиваемых справочников:
  * `getLookupCategories()` (категории сканов первички R2).
  * `getLookupCompanyRoles(companyId)` (матрицы ролей RBAC).
  * `getLookupCompaniesCatalog()` (каталог верифицированных компаний КР).

---

### 3. Ликвидация Водопадов (Waterfalls) и Параллелизация Запросов

#### [MODIFY] [app/dashboard/documents/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Оптимизировать `getUserContext`: объединить выборку пользователя, роли и компании в `Promise.all`.
- Заменить `select('*')` на выборочные поля (`id, name, inn, status, closed_period_until`).

#### [MODIFY] [app/dashboard/counterparties/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Оптимизировать `getOrganizationsModuleDataAction`: параллелизовать загрузку контрагентов, партнерств и каталога организаций через `Promise.all`.

#### [MODIFY] [app/dashboard/employees/actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/employees/actions.ts)
- Параллелизовать получение списка сотрудников, активных ролей и нераспределенных заявок.

---

### 4. Динамический Импорт Тяжелых Компонентов (Bundle Size & Code Splitting)

#### [MODIFY] [app/dashboard/documents/[id]/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/[id]/page.tsx)
- Заменить прямой импорт `ScanViewer` на `next/dynamic` с лоадером.

#### [MODIFY] [app/dashboard/documents/new/page.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/new/page.tsx)
- Перевести `MultiFileDropzone` на `next/dynamic`.

---

### 5. Suspense & Skeleton Заглушки

#### [MODIFY] [app/dashboard/loading.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/loading.tsx)
#### [NEW] [components/ui/table-skeleton.tsx](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/components/ui/table-skeleton.tsx)
- Создать легкий скелетон реестров для мгновенной отдачи каркаса интерфейса (UI Shell).

## Verification Plan

### Automated Tests
- Запуск полной проверки компиляции типов TypeScript:
  `npx tsc --noEmit`
- Сборка тестового бандла Next.js:
  `npm run build`

### Manual Verification
- Переходы между разделами `/dashboard/documents`, `/dashboard/counterparties`, `/dashboard/employees`, `/dashboard/company` для оценки субъективной скорости и плавности без подвисаний.
