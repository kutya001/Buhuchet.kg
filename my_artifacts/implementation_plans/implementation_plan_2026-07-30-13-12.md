# Повторный Код-Ревью Производительности и Полный Аудит Индексов БД

Проведен исчерпывающий анализ структуры всех 12 таблиц PostgreSQL и существующих B-Tree индексов в Supabase.

---

## 🔍 1. РЕЗУЛЬТАТЫ АУДИТА ИНДЕКСОВ БАЗЫ ДАННЫХ

В результате сопоставления SQL-запросов приложения с реальным реестром индексов PostgreSQL выявлены 4 таблицы с отсутствующими индексами на внешние ключи:

### 🚨 Найденные отсутствующие индексы (Seq Scan Vulnerabilities):

1. **Таблица `document_items` (Товарные позиции документа):**
   - **Запрос в коде:** `.from('document_items').select('*').eq('document_id', docId)`
   - **Проблема:** Имелся только первичный ключ `document_items_pkey`. При каждом открытии документа происходил полный `Seq Scan` таблицы спецификаций.
   - **Решение:** `CREATE INDEX IF NOT EXISTS idx_document_items_doc_id ON document_items(document_id);`

2. **Таблица `document_logs` (Журнал аудита документа):**
   - **Запрос в коде:** `.from('document_logs').select('*').eq('document_id', docId)`
   - **Проблема:** Был только первичный ключ `document_logs_pkey`. История изменений сканировала всю таблицу логов.
   - **Решение:** `CREATE INDEX IF NOT EXISTS idx_document_logs_doc_id ON document_logs(document_id);`

3. **Таблица `nomenclature` (Справочник Номенклатуры):**
   - **Запрос в коде:** `.from('nomenclature').select('*').eq('company_id', companyId)`
   - **Проблема:** Отсутствовал индекс по организации. Поиск товаров считывал записи всех компаний платформы.
   - **Решение:** `CREATE INDEX IF NOT EXISTS idx_nomenclature_company ON nomenclature(company_id);`

4. **Таблица `companies` (Каталог Организаций КР):**
   - **Запрос в коде:** `.from('companies').select('*').eq('status', 'active').eq('industry', ind)`
   - **Проблема:** Фильтрация организаций по отрасли в Каталоге не использовала композитный индекс.
   - **Решение:** `CREATE INDEX IF NOT EXISTS idx_companies_status_industry ON companies(status, industry);`

5. **Таблица `documents` (Дополнительные фильтры):**
   - **Запрос в коде:** `.from('documents').select('*').eq('doc_type', type).eq('status', status)`
   - **Решение:** `CREATE INDEX IF NOT EXISTS idx_documents_status_type ON documents(doc_type, status);`

---

## 🛠️ 2. ПЛАН ВНЕДРЕНИЯ

### 1. SQL Миграция:
Применить новую SQL-миграцию `supabase/migrations/20260730131500_missing_foreign_indexes.sql` в Supabase для закрытия всех обнаруженных узких мест.

### 2. Повторная Верификация:
- `npx tsc --noEmit`
- `npm run build`
