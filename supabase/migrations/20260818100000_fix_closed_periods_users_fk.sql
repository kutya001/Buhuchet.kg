-- ==============================================================================
-- МИГРАЦИЯ: Исправление внешних ключей company_closed_periods на public.users
-- ==============================================================================

-- 1. Удаляем старые FK, ссылающиеся на auth.users
ALTER TABLE public.company_closed_periods 
  DROP CONSTRAINT IF EXISTS company_closed_periods_closed_by_fkey,
  DROP CONSTRAINT IF EXISTS company_closed_periods_opened_by_fkey;

-- 2. Создаем явные FK на public.users для корректной работы PostgREST relationships
ALTER TABLE public.company_closed_periods
  ADD CONSTRAINT company_closed_periods_closed_by_fkey 
  FOREIGN KEY (closed_by) 
  REFERENCES public.users(id) 
  ON DELETE SET NULL;

ALTER TABLE public.company_closed_periods
  ADD CONSTRAINT company_closed_periods_opened_by_fkey 
  FOREIGN KEY (opened_by) 
  REFERENCES public.users(id) 
  ON DELETE SET NULL;

-- 3. Создаем индексы для ускорения JOIN / FK lookup
CREATE INDEX IF NOT EXISTS idx_company_closed_periods_closed_by 
  ON public.company_closed_periods(closed_by);

CREATE INDEX IF NOT EXISTS idx_company_closed_periods_opened_by 
  ON public.company_closed_periods(opened_by);

-- 4. Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
