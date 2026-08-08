-- =============================================================================
-- МИГРАЦИЯ 20260809000011: ТАБЛИЦА FILE_OWNERS С ПОДДЕРЖКОЙ COPY-ON-WRITE (CoW)
-- =============================================================================

-- 1. Создание таблицы владельцев файлов file_owners
CREATE TABLE IF NOT EXISTS public.file_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  is_original_creator BOOLEAN DEFAULT false,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_id, company_id)
);

-- Индексы для точечных выборок RLS и дедупликации
CREATE INDEX IF NOT EXISTS idx_file_owners_company_id ON public.file_owners(company_id);
CREATE INDEX IF NOT EXISTS idx_file_owners_file_id ON public.file_owners(file_id);

-- 2. Сидинг связей для существующих файлов
INSERT INTO public.file_owners (file_id, company_id, is_original_creator)
SELECT id, company_id, true
FROM public.files
WHERE company_id IS NOT NULL
ON CONFLICT (file_id, company_id) DO NOTHING;

-- 3. Функция и триггер автоматической очистки осиротевших файлов (orphaned files)
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_files()
RETURNS TRIGGER AS $$
BEGIN
  -- Если у файла больше не осталось владельцев в file_owners -> удаляем сам файл из public.files
  IF NOT EXISTS (SELECT 1 FROM public.file_owners WHERE file_id = OLD.file_id) THEN
    DELETE FROM public.files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_cleanup_orphaned_files ON public.file_owners;
CREATE TRIGGER trigger_cleanup_orphaned_files
AFTER DELETE ON public.file_owners
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_orphaned_files();

-- 4. Обновление RLS политики таблицы files для проверки прав через file_owners
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Пользователь видит файлы только своей компании" ON public.files;
DROP POLICY IF EXISTS "Доступ к файлам своей компании" ON public.files;

CREATE POLICY "Доступ к файлам своей компании" ON public.files
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.file_owners fo
    WHERE fo.file_id = files.id 
      AND fo.company_id IN (
        SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())
      )
  )
);
