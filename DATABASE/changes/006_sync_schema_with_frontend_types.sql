-- =============================================================================
-- ИНКРЕМЕНТАЛЬНАЯ МИГРАЦИЯ: 006_sync_schema_with_frontend_types.sql
-- =============================================================================
-- Цель: Синхронизация полей таблиц, внешних ключей и CHECK-ограничений
-- между PostgreSQL физической схемой и TypeScript типами интерфейса.
-- =============================================================================

-- 1. Таблица documents: расширение статусов и добавление недостающих полей
ALTER TABLE public.documents 
DROP CONSTRAINT IF EXISTS documents_status_check;

ALTER TABLE public.documents 
ADD CONSTRAINT documents_status_check 
CHECK (status IN ('draft', 'sent', 'recalled', 'accepted', 'processed', 'cancelled'));

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS receiver_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS mock_file_status TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_sender_user ON public.documents(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_documents_receiver_user ON public.documents(receiver_user_id);

-- 2. Таблица users: добавление полей активности и сброса пароля
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- 3. Таблица file_categories: добавление иконки и флага активности
ALTER TABLE public.file_categories
ADD COLUMN IF NOT EXISTS icon TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
