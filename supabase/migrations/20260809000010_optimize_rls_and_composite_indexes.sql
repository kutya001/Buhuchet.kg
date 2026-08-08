-- =============================================================================
-- МИГРАЦИЯ 20260809000010: ОПТИМИЗАЦИЯ RLS ПОЛИТИК И СОСТАВНЫЕ ИНДЕКСЫ
-- =============================================================================

-- 1. Оптимизация вызовов auth.uid() через (SELECT auth.uid()) для предотвращения повторных подзапросов к СУБД

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_partnerships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Доступ к документам своей компании" ON public.documents;
CREATE POLICY "Доступ к документам своей компании" ON public.documents
FOR ALL USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
    OR sender_company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
    OR receiver_company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Доступ к файлам своей компании" ON public.files;
CREATE POLICY "Доступ к файлам своей компании" ON public.files
FOR ALL USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS "Доступ к партнерствам своей компании" ON public.company_partnerships;
CREATE POLICY "Доступ к партнерствам своей компании" ON public.company_partnerships
FOR ALL USING (
    requester_company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
    OR target_company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
);

-- 2. Высокопроизводительные составные (composite) индексы для ускорения выборок и сортировок

CREATE INDEX IF NOT EXISTS idx_documents_company_status_date 
ON public.documents (company_id, status, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_documents_sender_receiver 
ON public.documents (sender_company_id, receiver_company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_company_created 
ON public.files (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_partnerships_lookup 
ON public.company_partnerships (requester_company_id, target_company_id, status);
