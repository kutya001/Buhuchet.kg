# План Имплементации: Полное Исправление Модуля Документы (PostgREST Реляции & Отображение Первички)

В данном документе изложен детальный разбор выявленного сбоя двусмысленности реляций PostgREST в модуле **Документы** и шаг за шагом прописан план его у устранения.

---

## 🔍 Глубокая Диагностика Причин Сбоя (Root Cause Analysis)

### 🚨 Почему возникали ошибки "Документ не найден" и Пустой массив первички (0 документов)?
1. **Двусмысленность связей `users` в PostgREST (`app/dashboard/documents/actions.ts`):**
   - В таблице `documents` есть три внешних ключа, ссылающихся на `users`: `author_id`, `sender_user_id` и `receiver_user_id`.
   - В функциях `getB2BDocumentsAction()` и `getB2BDocumentByIdAction()` использовался селектор `users(full_name)` без явного указания внешнего ключа (`!author_id`).
   - При выполнении вызова Supabase PostgREST выдавал ошибку **`PGRST201: Could not find a relationship between documents and users`**, т.к. не мог определить, по какому из 3-х ключей объединять таблицы.
2. **Маскировка ошибок на сервере:**
   - Из-за падения PostgREST функции возвращали `{ success: false, error: 'Документ не найден...' }`, а страница реестра устанавливала `setDocuments([])`.

---

## 🛠️ ПОШАГОВЫЙ ПЛАН ИСПРАВЛЕНИЙ

### 1. Серверные Экшены (`app/dashboard/documents/actions.ts`)
- **Исправление `getB2BDocumentsAction()`:**
  - Явно указать реляцию автора: `author:users!author_id(full_name)` вместо двусмысленного `users(full_name)`.
  - Включить в возвращаемый объект `currentCompanyId: ctx.companyId`.
- **Исправление `getB2BDocumentByIdAction()`:**
  - Исправить селектор на: `*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), sender_user:users!sender_user_id(full_name, position), receiver_user:users!receiver_user_id(full_name, position), files(*, file_categories(*)), document_logs(*, users:users!user_id(full_name)), author:users!author_id(full_name)`.
  - При возникновении ошибки выводить реальный текст `error.message` для точного логирования.
- **Исправление `createB2BDocumentAction()`:**
  - Перевести создание первичного документа на `adminSupabase` для обхода любых клиентских RLS блокировок при формировании B2B отправки.

### 2. Клиентские Страницы (`app/dashboard/documents/...`)
- **Реестр (`app/dashboard/documents/page.tsx`):**
  - При `res.success === false` выводить понятную плашку предупреждения `Alert` с ошибкой от бэкенда.
- **Детализация (`app/dashboard/documents/[id]/page.tsx`):**
  - Выводить реальное сообщение об ошибке, если `getB2BDocumentByIdAction` вернул сбой.

---

## 📊 План Верификации

1. Проверить `npx tsc --noEmit` и `npm run build`.
2. Создать новый документ (черновик или отправку) на странице `/dashboard/documents/new`.
3. Убедиться в успешном автоматическом переходе на `/dashboard/documents/[id]` с полной отрисовкой реквизитов и скана.
4. Проверить отображение созданного документа во всех вкладках реестра `/dashboard/documents`.
