-- Инкрементальная миграция: Расширение Check Constraint статусов партнерства
ALTER TABLE public.company_partnerships
DROP CONSTRAINT IF EXISTS company_partnerships_status_check;

ALTER TABLE public.company_partnerships
ADD CONSTRAINT company_partnerships_status_check
CHECK (status IN ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended'));
