-- Инкрементальная миграция: Синхронизация полей таблиц с типами фронтенда
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

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

ALTER TABLE public.file_categories
ADD COLUMN IF NOT EXISTS icon TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
