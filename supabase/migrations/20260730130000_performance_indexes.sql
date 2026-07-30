-- Performance Migration: High-Performance B-Tree Indexes for Buhuchet.kg

-- 1. Индексы для фильтрации B2B документов по отправителю и получателю
CREATE INDEX IF NOT EXISTS idx_documents_sender_company ON documents(sender_company_id);
CREATE INDEX IF NOT EXISTS idx_documents_receiver_company ON documents(receiver_company_id);
CREATE INDEX IF NOT EXISTS idx_documents_composite_dates ON documents(sender_company_id, receiver_company_id, created_at DESC);

-- 2. Индексы для поиска уставных файлов и сканов по организации
CREATE INDEX IF NOT EXISTS idx_document_files_company_legal ON document_files(company_id, is_legal_doc);
CREATE INDEX IF NOT EXISTS idx_document_files_doc_id ON document_files(document_id);

-- 3. Индексы для реестров контрагентов и поиска по ИНН
CREATE INDEX IF NOT EXISTS idx_counterparties_company_inn ON counterparties(company_id, inn);
CREATE INDEX IF NOT EXISTS idx_counterparties_target_company ON counterparties(target_company_id);

-- 4. Индексы для управления партнерскими заявками
CREATE INDEX IF NOT EXISTS idx_company_partnerships_req_target ON company_partnerships(requester_company_id, target_company_id, status);

-- 5. Индексы поиска пользователей по организации
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
