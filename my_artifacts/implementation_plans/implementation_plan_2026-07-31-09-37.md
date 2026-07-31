# План Диагностики и Исправления: Неотображение Документов и Дублирование Ролей (БД, Бэкенд, Фронтенд)

В данном документе изложен детальный разбор причин возникновения двух выявленных багов и пошаговый план их полнейшего устранения во всех слоях архитектуры платформы.

---

## 🔍 Глубокая Диагностика Причин Багов (Root Cause Analysis)

### 🚨 1. Баг #1: Не отображаются документы в списке (`/dashboard/documents`)
- **БД / Бэкенд:** Записи документов в таблице `documents` присутствуют и успешно извлекаются через `getB2BDocumentsAction()`.
- **Фронтенд (`app/dashboard/documents/page.tsx`):** 
  - Страница попыталась получить `company_id` через асинхронный клиентский запрос к Supabase (`supabase.from('users').select('company_id')`).
  - Из-за асинхронных задержек или клиентских ограничений RLS переменная `currentCompanyId` оставалась равной `null`.
  - При фильтрации вкладок (`filteredDocuments` и счетчиков `documents.filter(d => d.receiver_company_id === currentCompanyId)`) происходило сравнение UUID с `null`, из-за чего ВСЕ документы отбраковывались как `0` и на экране отображалось: *"Все документы (0), Документы не найдены"*.

### 🚨 2. Баг #2: Задублировались роли сотрудников (`/dashboard/employees`)
- **База Данных (Supabase / PostgreSQL):**
  - В таблице `company_roles` отсутствует уникальное ограничение `UNIQUE(company_id, name)`.
- **Бэкенд (`app/dashboard/employees/actions.ts`):**
  - Метод `getCompanyRolesAction()` при каждом посещении страницы или обновлении выгрузки вызвался функцию `seed_default_company_roles(company_id)`.
  - Из-за отсутствия `UNIQUE` ограничения SQL-конструкция `ON CONFLICT DO NOTHING` внутри `seed_default_company_roles` не срабатывала.
  - В результате при каждом открытии вкладки ролей в БД для организации создавалось по 4 новых дубликата ролей (*Владелец*, *Главный Бухгалтер*, *Менеджер по Продажам*, *Бухгалтер-Оператор*).

---

## 🛠️ ПОШАГОВЫЙ ПЛАН ИСПРАВЛЕНИЯ

### 1. Этап 1: База данных & Бэкенд — Исправление Дублирования Ролей
- **[NEW] SQL-Миграция (`supabase/migrations/20260731094000_fix_duplicate_company_roles.sql`):**
  1. Очистить накопленные дубликаты в таблице `company_roles` с помощью запроса с `DELETE ... WHERE id NOT IN (SELECT min(id) ... GROUP BY company_id, name)`.
  2. Добавить уникальное ограничение на таблицу:
     ```sql
     ALTER TABLE public.company_roles 
     ADD CONSTRAINT company_roles_company_id_name_key UNIQUE (company_id, name);
     ```
  3. Обновить RPC-функцию `seed_default_company_roles` для безопасной вставки с условной проверкой `WHERE NOT EXISTS`.
- **Бэкенд (`app/dashboard/employees/actions.ts`):**
  - В `getCompanyRolesAction()` оптимизировать сидинг: запускать его только если у организации реально 0 ролей.

---

### 2. Этап 2: Бэкенд & Фронтенд — Исправление Отображения Документов
- **Бэкенд (`app/dashboard/documents/actions.ts`):**
  - Возвращать `currentCompanyId` прямо в ответе `ActionResponse` функции `getB2BDocumentsAction()`:
    ```ts
    return { 
      success: true, 
      data: { docs: filteredDocs, totalCount: filteredDocs.length, currentCompanyId: ctx.companyId } 
    };
    ```
- **Фронтенд (`app/dashboard/documents/page.tsx`):**
  - Брать `currentCompanyId` из гарантированного ответа сервера `res.data.currentCompanyId`.
  - Убрать ненадёжный вызов `supabase.from('users').select('company_id')`.
  - Это обеспечит моментальную загрузку первички на вкладках *"Все Документы"*, *"Входящие"*, *"Исходящие"*, *"Черновики"*.

---

## 📊 План Верификации

1. Выполнить SQL-миграцию и очистку дубликатов в БД Supabase.
2. Проверить `npx tsc --noEmit` и `npm run build`.
3. Зайти в систему под пользователем и убедиться, что:
   - Реестр документов отображает все входящие/исходящие акты и накладные.
   - В разделе ролей отображается ровно 4 аккуратные роли без дублирования.
