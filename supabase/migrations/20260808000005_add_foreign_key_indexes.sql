-- Инкрементальная миграция: Добавление индексов для внешних ключей
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON public.documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_author_id ON public.documents(author_id);
CREATE INDEX IF NOT EXISTS idx_documents_counterparty_id ON public.documents(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_documents_sender_company ON public.documents(sender_company_id);
CREATE INDEX IF NOT EXISTS idx_documents_receiver_company ON public.documents(receiver_company_id);

CREATE INDEX IF NOT EXISTS idx_files_company_id ON public.files(company_id);
CREATE INDEX IF NOT EXISTS idx_files_document_id ON public.files(document_id);
CREATE INDEX IF NOT EXISTS idx_files_category_id ON public.files(category_id);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON public.users(role_id);

CREATE INDEX IF NOT EXISTS idx_counterparties_company_id ON public.counterparties(company_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_target_company ON public.counterparties(target_company_id);

CREATE INDEX IF NOT EXISTS idx_company_roles_company_id ON public.company_roles(company_id);

CREATE INDEX IF NOT EXISTS idx_subscription_payments_company ON public.subscription_payments(company_id);
