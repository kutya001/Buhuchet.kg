-- =============================================================================
-- МИГРАЦИЯ 20260810000000: СИСТЕМА ОЧЕРЕДИ ОЧИСТКИ ФАЙЛОВ PENDING_FILE_DELETIONS
-- =============================================================================

-- 1. Создание таблицы очереди физического удаления объектов из Cloudflare R2
CREATE TABLE IF NOT EXISTS public.pending_file_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для ускорения выборки элементов очереди
CREATE INDEX IF NOT EXISTS idx_pending_file_deletions_created ON public.pending_file_deletions(created_at);

-- 2. Включение RLS с доступом только для сервисной роли (service_role / postgres)
ALTER TABLE public.pending_file_deletions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Доступ к очереди удаления только сервисной роли" ON public.pending_file_deletions;
CREATE POLICY "Доступ к очереди удаления только сервисной роли" ON public.pending_file_deletions
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Триггерная функция постановки ключа R2 в очередь при удалении строки из public.files
CREATE OR REPLACE FUNCTION public.enqueue_deleted_file()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.file_path_r2 IS NOT NULL AND OLD.file_path_r2 <> '' THEN
    INSERT INTO public.pending_file_deletions (storage_key)
    VALUES (OLD.file_path_r2);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Подключение триггера к таблице public.files
DROP TRIGGER IF EXISTS trg_enqueue_deleted_file ON public.files;
CREATE TRIGGER trg_enqueue_deleted_file
AFTER DELETE ON public.files
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_deleted_file();
