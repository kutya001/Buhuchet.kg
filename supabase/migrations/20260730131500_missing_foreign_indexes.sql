-- Additional Migration: Closing all remaining foreign key index gaps

CREATE INDEX IF NOT EXISTS idx_document_items_doc_id ON document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_document_logs_doc_id ON document_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_nomenclature_company ON nomenclature(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_status_industry ON companies(status, industry);
CREATE INDEX IF NOT EXISTS idx_documents_status_type ON documents(doc_type, status);
