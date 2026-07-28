# Implementation Plan — Оптимизация Хеширования Паролей Supabase Auth в seed.sql

Этот план описывает обновление SQL-скрипта сидирования (`supabase/seed.sql`) с включением расширения `pgcrypto`, генерацией bcrypt-хешей повышенной стойкости (`gen_salt('bf', 10)`), явным указанием метаданных GoTrue (`instance_id`, `aud`, `role`) и выполнением обновлений в базе данных Supabase.

## User Review Required

> [!IMPORTANT]
> - **Стойкость bcrypt-хеша (`pgcrypto`):** Для хеширования пароля Суперадмина `SuperAdmin2026!` и аккаунтов компаний используется `crypt(..., gen_salt('bf', 10))`.
> - **Параметры Supabase GoTrue Auth:** Таблица `auth.users` наполняется со строгими значениями `instance_id = '00000000-0000-0000-0000-000000000000'`, `aud = 'authenticated'`, `role = 'authenticated'`.
> - **Синхронизация `auth.identities`:** При каждом сидировании в таблицу `auth.identities` автоматически добавляется связка `provider = 'email'` с полным `identity_data` для моментального прохождения аутентификации.

---

## Proposed Changes

### 1. База Данных & SQL Сидирование

#### [MODIFY] [seed.sql](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/supabase/seed.sql)
- Подключение `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.
- Обновление вставки в `auth.users` с генерацией хеша через `crypt('SuperAdmin2026!', gen_salt('bf', 10))`.
- Привязка UUID Суперадмина `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` и обновление `public.users`.
- Автоматическая вставка в `auth.identities`.

#### SQL Execution via Supabase MCP:
- Выполнение обновившегося SQL-скрипта в базе данных Supabase.

---

## Verification Plan

### Automated Verification
1. Проверка компиляции TypeScript: `npx tsc --noEmit`
2. Продашкн сборка Next.js: `npm run build`

### Manual Verification
1. Проверка наличия и структуры записей в `auth.users` и `auth.identities` через Supabase MCP `execute_sql`.
2. Тестовый вход под аккаунтом `admin@buhuchet.kg` с паролем `SuperAdmin2026!`.
