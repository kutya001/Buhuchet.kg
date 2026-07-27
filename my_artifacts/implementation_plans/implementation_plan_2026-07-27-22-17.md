# Implementation Plan - Шаг 2: Профиль пользователя и Модуль Суперадмина

Шаг 2 включает реализацию пользовательского профиля с настройкой контактных данных (включая строгое форматирование и валидацию номеров телефонов в Кыргызстане `+996 XXX XX-XX-XX`), а также создание изолированной панели управления Суперадмина (`/super-admin`) для контроля организаций, блокировки/разблокировки аккаунтов и управления тарифами/подписками.

## User Review Required

> [!IMPORTANT]
> - Проверка прав Суперадмина выполняется строго на сервере в `app/(super-admin)/layout.tsx` и `middleware.ts` по флагу `is_super_admin = true` в таблице `users`.
> - Все административные изменения (блокировка компании, продление подписок) выполняются через `lib/supabase/admin.ts` (`SUPABASE_SERVICE_ROLE_KEY`) для гарантированного обхода RLS на сервере.
> - Формат телефона КР строго валидируется регулярным выражением: `^\+996\d{9}$` (9 цифр после префикса `+996`).

---

## Proposed Changes

### 1. Схемы Валидации & Типы

#### [NEW] [profile.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/profile.types.ts)
- Схемы Zod для обновления профиля (`updateProfileSchema`) с поддержкой номеров телефонов КР.

#### [NEW] [admin.types.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/types/admin.types.ts)
- Схемы Zod для действий суперадмина: `toggleCompanyActiveSchema`, `updateSubscriptionSchema`.

---

### 2. Модуль Профиля Пользователя (`/dashboard/profile`)

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/profile/actions.ts)
- Server Action `updateProfileAction(formData)`: сохранение имени, телефона (`+996...`) и дополнительного email в таблицу `users`.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/profile/page.tsx)
- Страница профиля:
  - Карточка с информацией об организации, роли (`Owner`, `Accountant`, `Manager`) и основном Email.
  - Форма изменения ФИО и Дополнительного Email.
  - Интерактивное поле ввода телефона с форматированием `+996 (XXX) XX-XX-XX` и динамической валидацией.

---

### 3. Модуль Суперадмина (`/super-admin`)

#### [NEW] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(super-admin)/layout.tsx)
- Серверная проверка авторизации и флага `is_super_admin === true`.
- Специализированный Header & Sidebar Суперадмина с бейджем «Режим Суперадмина».

#### [NEW] [actions.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(super-admin)/actions.ts)
- Server Actions:
  - `toggleCompanyStatusAction(companyId: string, isActive: boolean)` — заблокировать/разблокировать организацию в таблице `companies`.
  - `updateCompanySubscriptionAction(...)` — изменить план (`basic`, `standard`, `pro`), продлить дату `expires_at` (на +30, +90 или +365 дней) и установить `storage_limit_gb`.

#### [NEW] [page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(super-admin)/page.tsx)
- Таблица организаций (Название, ИНН 14 цифр, Телефон, Дата регистрации, Активность, Подписка).
- Фильтрация по названию/ИНН компании.
- Кнопка мгновенной блокировки / разблокировки.
- Модальное окно управления тарифом и продлением подписки.

---

### 4. Middleware & Navigation Updates

#### [MODIFY] [middleware.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/lib/supabase/middleware.ts)
- Проверка авторизации и редирект для `/super-admin` с проверкой суперадминского статуса.

#### [MODIFY] [layout.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(dashboard)/layout.tsx)
- Добавление ссылки на «Профиль» в меню пользователя сайдбара.

---

## Verification Plan

### Automated Verification
1. Проверка компилятора TypeScript: `npx tsc --noEmit`
2. Сборка Next.js: `npm run build`

### Manual Verification
1. Запуск дев-сервера (`npm run dev`).
2. Переход на `/dashboard/profile`: тестирование ввода телефона `+996 (700) 12-34-56`, сохранения данных и сообщений об ошибках/успехе.
3. Попытка зайти на `/super-admin` обычным пользователем -> проверка редиректа на `/dashboard`.
4. Вход суперадмином: проверка работы таблицы всех компаний, смены статуса `is_active` и продления подписки.
