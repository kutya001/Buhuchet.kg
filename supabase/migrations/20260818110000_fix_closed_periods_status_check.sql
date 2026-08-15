-- ==============================================================================
-- МИГРАЦИЯ: Расширение CHECK-ограничения статусов company_closed_periods
-- ==============================================================================

-- 1. Удаляем старое ограничение, разрешавшее только ('open', 'closed')
ALTER TABLE public.company_closed_periods
  DROP CONSTRAINT IF EXISTS company_closed_periods_status_check;

-- 2. Добавляем обновленное ограничение с поддержкой статуса 'partial' (частично закрыт)
ALTER TABLE public.company_closed_periods
  ADD CONSTRAINT company_closed_periods_status_check
  CHECK (status IN ('open', 'closed', 'partial'));

-- 3. Перезагрузка кэша схемы PostgREST
NOTIFY pgrst, 'reload schema';
