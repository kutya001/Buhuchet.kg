# Implementation Plan - Сидирование тестовых аккаунтов (Seed Users)

План содержит техническое описание сидирования 3 ролевых учетных записей (Суперадмин, Владелец, Менеджер) для проверки RLS-политик, онбординга и функционала 1С выгрузки в сервисе Buhuchet.kg.

## Proposed Changes

### 1. Скрипт автоматического сидирования

#### [NEW] [seed-users.ts](file:///d:/Рабочий стол/Code Projects/Buhuchet.kg/scripts/seed-users.ts)
- Скрипт сидирования через `@supabase/supabase-js` с использованием `SUPABASE_SERVICE_ROLE_KEY`.
- Автоматическая загрузка конфигурации из `.env.local`.
- Создание аккаунтов в `auth.users` через `auth.admin.createUser()` и с привязкой ролей в `public.users`.

---

## Созданные учетные записи

| Роль | Email | Пароль |
| :--- | :--- | :--- |
| **Суперадмин** | `admin@buhuchet.kg` | `SuperAdmin2026!` |
| **Владелец** | `owner@buhuchet.kg` | `OwnerPass2026!` |
| **Менеджер** | `manager@buhuchet.kg` | `ManagerPass2026!` |
