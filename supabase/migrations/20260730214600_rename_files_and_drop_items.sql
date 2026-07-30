-- 1. Удаление неиспользуемой таблицы спецификаций номенклатуры document_items
DROP TABLE IF EXISTS public.document_items CASCADE;

-- 2. Переименование главной таблицы файлов с document_files в files
ALTER TABLE IF EXISTS public.document_files RENAME TO files;

-- 3. Переименование колонки размера файла с file_size в size_bytes
ALTER TABLE IF EXISTS public.files RENAME COLUMN file_size TO size_bytes;

-- 4. Обновление индексов
ALTER INDEX IF EXISTS idx_doc_files_company RENAME TO idx_files_company;
ALTER INDEX IF EXISTS idx_doc_files_document RENAME TO idx_files_document;
