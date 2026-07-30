# Глубокий Аудит Мультитенантности и План Устранения Уязвимостей (Multi-Tenancy Audit)

Проведен комплексный аудит соблюдения стандартов изоляции организаций (Multi-Tenancy) на уровне PostgreSQL (Supabase RLS), Next.js Server Actions и объектного хранилища Cloudflare R2.

---

## 🛑 1. ПЛАН ПРОБЛЕМ, ПРИЧИН И РЕШЕНИЙ

### 🟢 Что уже соответствует стандартам:
- На всех 12 бизнес-таблицах базы данных (`companies`, `company_partnerships`, `counterparties`, `document_files`, `document_items`, `document_logs`, `documents`, `feature_flags`, `file_categories`, `nomenclature`, `subscriptions`, `users`) включен **Row Level Security (RLS = true)**.
- RLS политики на `documents`, `counterparties`, `nomenclature`, `document_files` жестко фильтруют данные по `company_id IN (SELECT company_id FROM users WHERE id = auth.uid())`.

---

### 🚨 Найденные Уязвимости Изоляции в Коде:

#### ❌ Проблема 1: Обход RLS через `createAdminClient()` при удалении файлов в `archive-actions.ts`
- **Файл:** `app/dashboard/files/archive-actions.ts` (`deleteArchiveFileAction`).
- **Причина:** Экшен получает `fileId` с клиента и выполняет:
  ```ts
  const adminSupabase = await createAdminClient();
  await adminSupabase.from('document_files').delete().eq('id', fileId);
  ```
  Использование Service Role bypass без принудительной фильтрации по `company_id` авторизованной компании создавало возможность для удаления файла чужой организации путем передачи чужого `fileId`.
- **Решение:** 
  Принудительно добавлять условие `.eq('company_id', prof.company_id)` во все mutating операции `adminSupabase`:
  ```ts
  await adminSupabase.from('document_files').delete().eq('id', fileId).eq('company_id', prof.company_id);
  ```

---

#### ❌ Проблема 2: Отсутствие серверной проверки прав владения при удалении/редактировании документов
- **Файл:** `app/dashboard/documents/actions.ts` (`deleteB2BDocumentAction`, `updateB2BDocumentFullAction`).
- **Причина:** При использовании `adminSupabase` изменение и удаление записи выполнялось по `documentId` без явной проверки `sender_company_id === ctx.companyId`.
- **Решение:** 
  Добавить принудительную проверку перед модификацией:
  ```ts
  const { data: existingDoc } = await adminSupabase.from('documents').select('sender_company_id').eq('id', documentId).single();
  if (existingDoc?.sender_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
    return { success: false, error: 'Доступ запрещен: документ принадлежит другой организации' };
  }
  ```

---

#### ❌ Проблема 3: Незащищенная изоляция путей в Cloudflare R2 (`/api/r2/presigned-url`)
- **Файл:** `app/api/r2/presigned-url/route.ts`.
- **Причина:** Клиент запрашивает Presigned URL с произвольным параметром `key`. API не проверяет, что префикс файла принадлежит `company_id` текущей сессии.
- **Решение:** 
  Принудительно формировать ключ загрузки R2 на сервере с префиксом организации: `tenants/${companyId}/${filename}` или проверять вхождение `companyId` в запрошенный `key`.

---

## 🛠️ 2. ИЗМЕНЕНИЯ В КОДЕ

### [MODIFY] [archive-actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/files/archive-actions.ts)
- Гарантированное включение `.eq('company_id', prof.company_id)` в `deleteArchiveFileAction`.

### [MODIFY] [actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Проверка `sender_company_id === ctx.companyId` перед удалением и обновлением документа.

### [MODIFY] [route.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/api/r2/presigned-url/route.ts)
- Валидация принадлежности префикса R2 к `company_id` текущей авторизованной сессии.

---

## 📊 3. ПЛАН ВЕРИФИКАЦИИ
- `npx tsc --noEmit` — 0 ошибок.
- `npm run build` — 21 static page.
