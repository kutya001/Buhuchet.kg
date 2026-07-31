-- Создание составных и целевых индексов для мгновенной выборки данных и фильтрации
CREATE INDEX IF NOT EXISTS idx_companies_status_created ON public.companies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status_sender_receiver ON public.documents(sender_company_id, receiver_company_id, status);
CREATE INDEX IF NOT EXISTS idx_users_company_active ON public.users(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_files_company_doc ON public.files(company_id, document_id);
CREATE INDEX IF NOT EXISTS idx_company_partnerships_composite ON public.company_partnerships(requester_company_id, target_company_id, status);
