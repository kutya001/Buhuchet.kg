# Implementation Plan — Роутинг Лендинга, Сквозная Навигация & SQL Сидирование 10 Организаций КР

Этот план описывает исправление правил роутинга и Middleware для работы публичного лендинга (`/`), добавление ссылок возврата на главную со страниц входа и регистрации (`/login`, `/register`), а также формирование и исполнение `supabase/seed.sql` для полной очистки и наполнения базы данных 10 реалистичными предприятиями Кыргызстана и Суперадмином Kutman.

## User Review Required

> [!IMPORTANT]
> - **Публичные маршруты Middleware (`middleware.ts`):** Маршруты `/`, `/login`, `/register` помечаются как строго публичные. Вход на `/` в режиме инкогнито и без авторизации показывает продающий лендинг.
> - **Сквозная навигация:** На страницах `/login` и `/register` добавляются ссылки **«← Вернуться на главную»** (на `/`).
> - **Сидирование 10 Организаций КР (`supabase/seed.sql`):** Таблицы очищаются (`TRUNCATE ... CASCADE`). Создается аккаунт Суперадмина **Kutman** (`admin@buhuchet.kg`, `company_id = NULL`), а также 10 компаний Кыргызстана (Кумтор, Народный Трейд, Батыш Логистик, Бишкек Софт, Чуй Строй, Агро Азия, Джалал-Абад НПЗ, Фарма КР, Азия Консалт, Ош Текстиль) с уникальными ИНН 14 цифр и привязаными аккаунтами владельцев.

---

## Proposed Changes

### 1. Публичный Роутинг & Сквозные Ссылки

#### [MODIFY] [middleware.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/middleware.ts)
- Разрешение публичного доступа к `/`, `/login`, `/register` без выполнения нежелательных перенаправлений для гостей.

#### [MODIFY] [login/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/login/page.tsx)
- Добавление ссылки **«← Вернуться на главную»** (`/`) в шапку карточки входа.

#### [MODIFY] [register/page.tsx](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/app/(auth)/register/page.tsx)
- Добавление ссылки **«← Вернуться на главную»** (`/`) в шапку карточки регистрации.

---

### 2. Сидирование и Очистка Базы Данных Supabase

#### [NEW] [seed.sql](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/supabase/seed.sql)
- Полный SQL-скрипт сидирования:
  1. `TRUNCATE public.companies, public.users, public.company_partnerships, public.counterparties, public.documents, public.document_files CASCADE`.
  2. Аккаунт Суперадмина: `Kutman` (`admin@buhuchet.kg`, `is_super_admin = true`, `company_id = NULL`).
  3. 10 Организаций Кыргызской Республики с заполненными реквизитами, отраслями и 10 владельцами (`role = 'owner'`).
  4. Подтвержденные B2B партнерства (`status = 'approved'`) и автоматическая синхронизация контрагентов.
  5. Категории файлов и Feature Flags.

#### SQL Execution via Supabase MCP:
- Исполнение `supabase/seed.sql` в PostgreSQL базе данных Supabase.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Открытие главной страницы `http://localhost:3000/` в режиме Инкогнито:
   - Проверка, что открывается продающий лендинг без редиректа на `/login`.
2. Переход на `/login` и `/register`:
   - Проверка наличия ссылки «← Вернуться на главную».
3. Вход под Суперадмином Kutman (`admin@buhuchet.kg` / `SuperAdmin2026!`):
   - Проверка вкладки «Все Организации» — наличие 10 компаний КР.
