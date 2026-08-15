-- ==============================================================================
-- МИГРАЦИЯ: Таблица заявок на вступление в компанию и политики доступа
-- ==============================================================================

-- 1. Создание таблицы заявок на вступление (company_join_requests)
CREATE TABLE IF NOT EXISTS public.company_join_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    position_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индексы для быстрого поиска и частичный уникальный индекс для активных заявок
CREATE INDEX IF NOT EXISTS idx_join_requests_company_id ON public.company_join_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_user_id ON public.company_join_requests(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_active_unique ON public.company_join_requests(user_id, company_id) WHERE status = 'pending';

-- 2. Включение Row Level Security (RLS)
ALTER TABLE public.company_join_requests ENABLE ROW LEVEL SECURITY;

-- 3. Политики безопасности строк для company_join_requests
DROP POLICY IF EXISTS "Users can view own join requests and company admins can view incoming" ON public.company_join_requests;
CREATE POLICY "Users can view own join requests and company admins can view incoming"
ON public.company_join_requests
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR company_id IN (
        SELECT u.company_id FROM public.users u
        WHERE u.id = auth.uid() AND (u.role = 'owner' OR u.is_super_admin = true)
    )
);

DROP POLICY IF EXISTS "Users can create own join requests" ON public.company_join_requests;
CREATE POLICY "Users can create own join requests"
ON public.company_join_requests
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
);

DROP POLICY IF EXISTS "Users can cancel own pending requests" ON public.company_join_requests;
CREATE POLICY "Users can cancel own pending requests"
ON public.company_join_requests
FOR UPDATE
TO authenticated
USING (
    user_id = auth.uid()
    OR company_id IN (
        SELECT u.company_id FROM public.users u
        WHERE u.id = auth.uid() AND (u.role = 'owner' OR u.is_super_admin = true)
    )
)
WITH CHECK (
    user_id = auth.uid()
    OR company_id IN (
        SELECT u.company_id FROM public.users u
        WHERE u.id = auth.uid() AND (u.role = 'owner' OR u.is_super_admin = true)
    )
);

-- 4. Функция безопасного публичного поиска компаний для подачи заявок сотрудниками
CREATE OR REPLACE FUNCTION public.search_companies_for_join(search_query TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    inn TEXT,
    legal_address TEXT,
    director_name TEXT,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        c.inn,
        c.legal_address,
        c.director_name,
        c.status::TEXT
    FROM public.companies c
    WHERE c.status = 'active'
      AND (
          c.inn ILIKE '%' || trim(search_query) || '%'
          OR c.name ILIKE '%' || trim(search_query) || '%'
      )
    ORDER BY c.name ASC
    LIMIT 20;
END;
$$;

-- 5. Триггер обновления updated_at
CREATE OR REPLACE FUNCTION public.set_join_request_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_join_request_updated_at ON public.company_join_requests;
CREATE TRIGGER trg_join_request_updated_at
BEFORE UPDATE ON public.company_join_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_join_request_updated_at();
