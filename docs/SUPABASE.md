# SUPABASE.md — Инструкция по работе с Supabase, PostgreSQL & MCP

Этот документ содержит стандарты работы с Supabase, конфигурацию MCP-инструментов, правила безопасности СУБД, управление RLS и регламент накатывания миграций для проекта **Buhuchet.kg**.

---

## 1. КОНФИГУРАЦИЯ И ДАННЫЕ ПРОЕКТА
- **Project Ref (ID):** `hpfemrvqmlvhqbdmogcl`
- **MCP Server URL:** `https://mcp.supabase.com/mcp?project_ref=hpfemrvqmlvhqbdmogcl`
- **API URL:** `https://hpfemrvqmlvhqbdmogcl.supabase.co`

### Переменные окружения (`.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=https://hpfemrvqmlvhqbdmogcl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 2. СТАНДАРТЫ БЕЗОПАСНОСТИ СУБД (POSTGRESQL SECURITY RULES)

1. **Изоляция `search_path` в функциях `SECURITY DEFINER`**:
   - Любая функция, выполняемая от имени суперпользователя (`SECURITY DEFINER`), **обязана** содержать явное определение:
     ```sql
     SET search_path = public, pg_temp;
     ```
   - Запрещено создание `SECURITY DEFINER` функций без фиксированного `search_path`. Проверяется линтером `npm run lint:sql`.

2. **Мемоизация сессии в RLS (`(SELECT auth.uid())`)**:
   - Во всех RLS-политиках вызов `auth.uid()` оборачивается в подзапрос:
     ```sql
     USING (user_id = (SELECT auth.uid()))
     ```
   - Это гарантирует, что PostgreSQL выполняет функцию авторизации один раз за транзакцию, а не для каждой строки таблицы.

3. **Аппаратная защита роли Owner и системных ролей**:
   - Триггер `trg_prevent_system_role_deletion` блокирует удаление системных ролей (`is_system = true`).
   - Триггер `trg_prevent_owner_transfer` запрещает назначение роли `owner` через клиентские мутации.

4. **Атомарные RPC-процедуры**:
   - Создание документов: `public.create_document_atomic(...)`.
   - Модерация компаний: `public.admin_approve_company_atomic(...)`.
   - Агрегация платформы: `public.get_platform_summary_stats()`.
   - Контроль тарифов: `public.cron_check_expired_subscriptions()`.

---

## 3. УПРАВЛЕНИЕ МИГРАЦИЯМИ И ТИПАМИ

```bash
# Проверка чистоты миграций и search_path
npm run lint:sql

# Запуск тестов безопасности RBAC
npm run test:rbac

# Генерация TypeScript-типов из схемы Supabase
npm run types:generate
```

---

## 4. MCP ИНСТРУМЕНТЫ SUPABASE
- `list_tables` — Список физических таблиц схемы `public`.
- `execute_sql` — Безопасное выполнение SQL-запросов и накатывание DDL миграций.
- `list_migrations` — Просмотр истории миграций.
- `apply_migration` — Применение локальных миграций.
