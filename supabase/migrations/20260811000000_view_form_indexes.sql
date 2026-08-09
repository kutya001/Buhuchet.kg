-- =============================================================================
-- МИГРАЦИЯ 20260811000000: ИНДЕКСЫ ДЛЯ ФОРМ ПРОСМОТРА И JOIN-ЗАПРОСОВ ДЕТАЛЕЙ
-- =============================================================================

-- 1. Индексы для ускорения связей документов с авторами и контрагентами
CREATE INDEX IF NOT EXISTS idx_documents_author ON public.documents(author_id);
CREATE INDEX IF NOT EXISTS idx_documents_counterparty ON public.documents(counterparty_id);

-- 2. Индексы для ускорения деталей файлов и категорий
CREATE INDEX IF NOT EXISTS idx_files_category ON public.files(category_id);

-- 3. Индексы для ролей сотрудников
CREATE INDEX IF NOT EXISTS idx_users_role_id ON public.users(role_id);
