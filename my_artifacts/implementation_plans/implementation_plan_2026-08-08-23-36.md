# План Архитектурного и Защитного Рефакторинга Buhuchet.kg

План выполнения 6 ключевых задач безопасности, стабильности и версионирования платформы.

---

## Пользовательская Проверка (User Review Required)

> [!IMPORTANT]
> - **SSOT Миграций и удаление `DATABASE/`**: Все исторические скрипты из `DATABASE/changes/` переносятся в стандартную директорию Supabase CLI `supabase/migrations/` в строгом хронологическом порядке. Локальная папка `DATABASE/` удаляется из репозитория.
> - **Унификация Server Actions через `createSafeAction`**: Создается обертка `createSafeAction` на базе `zod`, которая автоматически проверяет аутентификацию, валидирует входные параметры и ловит необработанные 500 ошибки.
> - **RLS и Триггеры Блокировки Закрытых Периодов в PostgreSQL**: Проверки закрытия периода выносятся на уровень триггерных функций PostgreSQL, которые автоматически защищают таблицы `documents` и `files` на уровне БД.

---

## Архитектура Изменений по 6 Задачам

---

### Задача 1. Консолидация миграций БД в `supabase/migrations/` и единый источник правды (SSOT)
- Перенести все SQL-файлы из `DATABASE/changes/` в `supabase/migrations/` с метками времени:
  * `20260808000001_initial_schema.sql`
  * `20260808000002_add_company_roles_rbac.sql`
  * `20260808000003_company_users_status_and_position.sql`
  * `20260808000004_fix_company_partnerships_status_check.sql`
  * `20260808000005_add_foreign_key_indexes.sql`
  * `20260808000006_sync_schema_with_frontend_types.sql`
  * `20260808000007_company_closed_periods.sql`
  * `20260808000008_superadmin_approval_and_inspector.sql`
- Удалить директорию `DATABASE/` из репозитория.
- Обновить `supabase/seed.sql` базовыми данными пользователей и компаний.

---

### Задача 2. Валидация входных данных в Server Actions через Zod & `createSafeAction`
- **[NEW] [safe-action.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/auth/safe-action.ts)**:
  Создать хелпер `createSafeAction<TInput, TOutput>(schema: ZodType<TInput>, handler: (data: TInput, ctx: UserContext) => Promise<ActionResponse<TOutput>>)` для строгой валидации payload, проверки сессии и перехвата исключений.
- Обернуть экшены в `app/dashboard/*/actions.ts`, `app/super-admin/actions.ts` и `app/(auth)/onboarding/actions.ts` в `createSafeAction`.

---

### Задача 3. Перенос проверок RBAC и закрытых периодов на уровень Supabase RLS и триггеров
- **[NEW] [20260808000009_rls_and_closed_period_triggers.sql](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/supabase/migrations/20260808000009_rls_and_closed_period_triggers.sql)**:
  * Триггерная функция PostgreSQL `check_closed_period_lock()`, проверяющая `company_closed_periods` при `INSERT/UPDATE/DELETE` в `documents` и `files`.
  * Исключение для роли `owner` / `is_super_admin` (Владельцы сохраняют доступ).
  * Настройка RLS-политик для `documents`, `employees`, `company_partnerships`, `files`.

---

### Задача 4. Оптимизация и инвалидация кэша справочников
- **[MODIFY] [lookups.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/lib/cache/lookups.ts)**:
  Переписать получение справочников с использованием `unstable_cache` из Next.js с тегами (`lookups-companies`, `lookups-roles`, `lookups-users`).
- Добавить вызовы `revalidateTag()` в Server Actions при редактировании профиля компании и ролей.

---

### Задача 5. Автоматическая генерация типов из базы данных (Supabase CLI)
- **[MODIFY] [package.json](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/package.json)**:
  Добавить скрипт `"types:generate": "supabase gen types typescript --local > types/database.types.ts"`.
- Обновить DTO типы в `types/company.types.ts`, `types/document.types.ts`, `types/b2b.types.ts` как расширения от `Database['public']['Tables'][...]['Row']`.

---

### Задача 6. Защита и проверка авторизации Telegram Webhook
- **[MODIFY] [.env.example](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/.env.example)**:
  Добавить `TELEGRAM_WEBHOOK_SECRET`.
- **[MODIFY] [route.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/api/telegram/webhook/route.ts)**:
  Внедрить проверку заголовка `x-telegram-bot-api-secret-token`. Отклонять сторонние вызовы со статусом `401 Unauthorized`. Передавать `secret_token` в Telegram API при `setWebhook`.

---

## План Проверки (Verification Plan)

### Автоматическое тестирование
- Валидация TypeScript типов: `npx tsc --noEmit`.
- Проверка производства сборки Next.js: `npm run build`.

### Ручное тестирование
- Попытка отправить невалидный запрос в Server Action без Zod-полей (проверка перехвата `createSafeAction`).
- Запрос к `POST /api/telegram/webhook` без заголовока секретного токена ➔ проверка возврата 401 Unauthorized.
- Выполнение SQL миграции RLS и проверка работы триггеров закрытия периода.
