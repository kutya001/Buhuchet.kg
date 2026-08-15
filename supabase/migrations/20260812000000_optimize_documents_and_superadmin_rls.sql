-- ============================================================================
-- МИГРАЦИЯ: Оптимизация RLS-политик документов и свободного доступа суперадмина
-- Имя файла: 20260812000000_optimize_documents_and_superadmin_rls.sql
-- ============================================================================

-- 1. Функция проверки является ли текущий пользователь суперадминистратором
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.users WHERE id = (SELECT auth.uid())),
    false
  );
$$;

-- 2. Обновление RLS политики SELECT для таблицы documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view relevant documents" ON public.documents;
DROP POLICY IF EXISTS "documents_select_policy" ON public.documents;

CREATE POLICY "documents_select_policy"
ON public.documents
FOR SELECT
TO authenticated
USING (
  public.is_super_admin() OR
  sender_company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())) OR
  receiver_company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid())) OR
  counterparty_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
);

-- 3. Политики для Суперадминистратора по всем таблицам
DROP POLICY IF EXISTS "super_admin_full_access_companies" ON public.companies;
CREATE POLICY "super_admin_full_access_companies"
ON public.companies
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super_admin_full_access_files" ON public.files;
CREATE POLICY "super_admin_full_access_files"
ON public.files
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "super_admin_full_access_documents" ON public.documents;
CREATE POLICY "super_admin_full_access_documents"
ON public.documents
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());
