-- Инкрементальная миграция: Актуализация статусов верификации компаний и партнерств
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_status_check;
ALTER TABLE public.companies ADD CONSTRAINT companies_status_check 
  CHECK (status IN ('pending_approval', 'requires_changes', 'active', 'blocked'));

ALTER TABLE public.company_partnerships DROP CONSTRAINT IF EXISTS company_partnerships_status_check;
ALTER TABLE public.company_partnerships ADD CONSTRAINT company_partnerships_status_check
  CHECK (status IN ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_counterparties_company_target ON public.counterparties(company_id, target_company_id);
CREATE INDEX IF NOT EXISTS idx_company_partnerships_composite ON public.company_partnerships(requester_company_id, target_company_id, status);
