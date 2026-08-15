-- ==============================================================================
-- МИГРАЦИЯ: Исправление RLS политик для заявок на вступление и видимости профилей соискателей
-- ==============================================================================

-- 1. Разрешить чтение компаний для поиска аутентифицированным пользователям
DROP POLICY IF EXISTS "Allow view company" ON public.companies;
CREATE POLICY "Allow view company"
ON public.companies
FOR SELECT
TO authenticated
USING (
  true
);

-- 2. Политики RLS для таблицы заявок company_join_requests
ALTER TABLE public.company_join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own join requests and company admins can view incoming" ON public.company_join_requests;
DROP POLICY IF EXISTS "Users can view their own join requests" ON public.company_join_requests;
DROP POLICY IF EXISTS "Company managers can view incoming join requests" ON public.company_join_requests;

CREATE POLICY "Users can view own join requests and company admins can view incoming"
ON public.company_join_requests
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR company_id = get_my_company_id()
  OR is_super_admin() = true
);

DROP POLICY IF EXISTS "Users can create own join requests" ON public.company_join_requests;
DROP POLICY IF EXISTS "Users can create join requests" ON public.company_join_requests;

CREATE POLICY "Users can create own join requests"
ON public.company_join_requests
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
);

DROP POLICY IF EXISTS "Users can cancel own pending requests" ON public.company_join_requests;
DROP POLICY IF EXISTS "Users can cancel their pending requests" ON public.company_join_requests;
DROP POLICY IF EXISTS "Company managers can update join requests" ON public.company_join_requests;
DROP POLICY IF EXISTS "Users can update join requests" ON public.company_join_requests;

CREATE POLICY "Users can update join requests"
ON public.company_join_requests
FOR UPDATE
TO authenticated
USING (
  (user_id = auth.uid() AND status = 'pending')
  OR company_id = get_my_company_id()
  OR is_super_admin() = true
)
WITH CHECK (
  (user_id = auth.uid() AND status = 'cancelled')
  OR company_id = get_my_company_id()
  OR is_super_admin() = true
);

-- 3. Разрешить владельцам компаний просматривать профили соискателей в public.users
DROP POLICY IF EXISTS "Users can view users" ON public.users;
DROP POLICY IF EXISTS "Company managers can view applicant profiles" ON public.users;

CREATE POLICY "Users can view users"
ON public.users
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR company_id = get_my_company_id()
  OR is_super_admin() = true
  OR EXISTS (
    SELECT 1 FROM public.company_join_requests cjr
    WHERE cjr.user_id = users.id
      AND cjr.company_id = get_my_company_id()
  )
);
