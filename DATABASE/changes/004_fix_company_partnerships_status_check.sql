-- =============================================================================
-- ИНКРЕМЕНТАЛЬНАЯ МИГРАЦИЯ: 004_fix_company_partnerships_status_check.sql
-- =============================================================================
-- Цель: Расширение Check Constraint статусов партнерства в таблице company_partnerships
-- для поддержки всех статусов ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended').
-- =============================================================================

-- 1. Снимаем старое ограничение, вызовавшее сбой
ALTER TABLE public.company_partnerships
DROP CONSTRAINT IF EXISTS company_partnerships_status_check;

-- 2. Накатываем расширенное актуальное ограничение статусов
ALTER TABLE public.company_partnerships
ADD CONSTRAINT company_partnerships_status_check
CHECK (status IN ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended'));
