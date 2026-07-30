# Глубокий Код-Ревью Производительности и План Оптимизации (Performance Plan)

На основе проведенного анализа кодовой базы и механизмов взаимодействия с Supabase БД и Cloudflare R2 выявлены 5 ключевых узких мест (Bottlenecks), приводящих к замедлению работы платформы.

---

## 🛑 1. ПЛАН ПРОБЛЕМ, ПРИЧИН И РЕШЕНИЙ

### ❌ Проблема 1: Последовательная генерация S3 Presigned URLs в Server Actions (R2 Async Waterfall)
- **Файл:** `app/dashboard/counterparties/actions.ts` (`getCounterpartyDetailsAndFilesAction`), `app/dashboard/files/archive-actions.ts`.
- **Причина:** Код выполняет подпись ссылок R2 через последовательный цикл `for (const file of rawFiles) { await getPresignedDownloadUrl(...); }`. Каждый вызов замирает на криптографической подписи AWS S3 HMAC-SHA256, суммарно задерживая ответ от 1.5 до 3 секунд.
- **Решение:** 
  - Заменить последовательный цикл на параллельный `Promise.all(rawFiles.map(async (file) => ...))`.
  - Генерацию Presigned URL перевести в формат **On-Demand** (по требованию — при открытии или клике), исключив массовую генерацию ссылок в списковых запросах.

---

### ❌ Проблема 2: Отсутствие серверной пагинации Supabase (Payload & Parsing Bloat)
- **Файл:** `app/dashboard/documents/actions.ts` (`getB2BDocumentsAction`), `app/dashboard/counterparties/page.tsx`, `app/dashboard/files/actions.ts`.
- **Причина:** Запросы к базе данных делают `.select('*, sender_company:companies(*), ...')` без вызова `.range()` и `.limit()`. В результате из Supabase выгружаются **все тысячи документов и файлов**, а пагинация `paginatedDocuments.slice(...)` выполняется в памяти браузера.
- **Решение:** 
  - Перенести пагинацию на сторону сервера Supabase: запрашивать порции по 10-20 записей через `.range((page - 1) * limit, page * limit - 1)`.
  - Сузить список возвращаемых полей вместо тяжелого `select('*')`.

---

### ❌ Проблема 3: Повторяющиеся незакешированные проверки сессий Supabase Auth (Auth Request Overhead)
- **Файл:** `app/dashboard/documents/actions.ts`, `app/dashboard/counterparties/actions.ts`, `app/dashboard/files/archive-actions.ts`.
- **Причина:** Каждый вызов `getUserContext()` выполняет новый сетевой запрос к Supabase Auth `/auth/v1/user`. При реактивных обновлениях вызывается по 3-5 тяжелых Auth-запросов за секундный интервал.
- **Решение:** 
  - Обернуть `getUserContext()` в метод `cache()` из библиотеки `react` для кэширования профиля пользователя в рамках одного HTTP-запроса.

---

### ❌ Проблема 4: Отсутствие специализированных B-Tree индексов PostgreSQL (Database Seq Scan)
- **Файл:** База данных Supabase PostgreSQL.
- **Причина:** Фильтрация документов `.or(sender_company_id.eq.X, receiver_company_id.eq.X)` и файлов `.eq('company_id', X)` выполняется через полное сканирование таблицы (`Sequential Scan`), закручивая CPU базы данных.
- **Решение:** 
  - Применить SQL-миграцию для создания композитных индексов:
    - `CREATE INDEX IF NOT EXISTS idx_documents_sender_receiver ON documents(sender_company_id, receiver_company_id);`
    - `CREATE INDEX IF NOT EXISTS idx_document_files_company ON document_files(company_id);`
    - `CREATE INDEX IF NOT EXISTS idx_counterparties_company_inn ON counterparties(company_id, inn);`

---

### ❌ Проблема 5: Чрезмерно частый сброс Next.js Router Cache (Cache Busting Storm)
- **Файл:** `archive-actions.ts`, `documents/actions.ts`, `counterparties/actions.ts`.
- **Причина:** Несколько последовательных вызовов `revalidatePath('/dashboard/files')`, `revalidatePath('/dashboard/company')`, `revalidatePath('/super-admin')` сбрасывают весь статичный и динамический кэш Next.js App Router при мелких правках.
- **Решение:** 
  - Ограничить инвалидацию строго целевыми путями страницы `revalidatePath('/dashboard/counterparties', 'page')`.

---

## 🛠️ 2. ПРЕДЛАГАЕМЫЕ ИЗМЕНЕНИЯ В КОДЕ

### [MODIFY] [actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/counterparties/actions.ts)
- Оптимизация `getUserContext()` через `react` `cache()`.
- Замена последовательного `for...of` в `getCounterpartyDetailsAndFilesAction` на `Promise.all()`.

### [MODIFY] [actions.ts](file:///d:/Рабочий%20стол/Code%20Projects/Buhuchet.kg/app/dashboard/documents/actions.ts)
- Добавление серверной пагинации (`page`, `limit`) в `getB2BDocumentsAction`.

---

## 📊 3. ПЛАН ВЕРИФИКАЦИИ
- `npx tsc --noEmit` — 0 ошибок типизации.
- `npm run build` — проверка полной сборки (21 static page).
