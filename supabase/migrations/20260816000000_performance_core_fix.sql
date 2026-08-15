-- ==============================================================================
-- МИГРАЦИЯ: Комплексная Оптимизация Производительности RLS, Функций и Индексов
-- ==============================================================================

-- 1. Оптимизированные STABLE SECURITY DEFINER функции
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(active_company_id, company_id) 
  FROM public.users 
  WHERE id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM public.users WHERE id = (SELECT auth.uid())),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_company_ids()
RETURNS TABLE (company_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(active_company_id, company_id) AS company_id
  FROM public.users
  WHERE id = (SELECT auth.uid()) AND COALESCE(active_company_id, company_id) IS NOT NULL
  UNION
  SELECT cu.company_id
  FROM public.company_users cu
  WHERE cu.user_id = (SELECT auth.uid()) AND cu.status = 'active';
$$;

-- 2. Оптимизация RLS-политик: Таблица `documents`
DROP POLICY IF EXISTS "Company documents policy" ON public.documents;
DROP POLICY IF EXISTS "documents_select_policy" ON public.documents;
DROP POLICY IF EXISTS "super_admin_full_access_documents" ON public.documents;
DROP POLICY IF EXISTS "Доступ к документам своей компании" ON public.documents;
DROP POLICY IF EXISTS "documents_select_optimized" ON public.documents;
DROP POLICY IF EXISTS "documents_insert_optimized" ON public.documents;
DROP POLICY IF EXISTS "documents_update_optimized" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_optimized" ON public.documents;

CREATE POLICY "documents_select_optimized"
ON public.documents
FOR SELECT
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR sender_company_id = get_my_company_id()
  OR receiver_company_id = get_my_company_id()
);

CREATE POLICY "documents_insert_optimized"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR sender_company_id = get_my_company_id()
);

CREATE POLICY "documents_update_optimized"
ON public.documents
FOR UPDATE
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR sender_company_id = get_my_company_id()
  OR receiver_company_id = get_my_company_id()
)
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR sender_company_id = get_my_company_id()
  OR receiver_company_id = get_my_company_id()
);

CREATE POLICY "documents_delete_optimized"
ON public.documents
FOR DELETE
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR sender_company_id = get_my_company_id()
);

-- 3. Оптимизация RLS-политик: Таблица `counterparties`
DROP POLICY IF EXISTS "Company counterparties policy" ON public.counterparties;
DROP POLICY IF EXISTS "counterparties_all_optimized" ON public.counterparties;

CREATE POLICY "counterparties_all_optimized"
ON public.counterparties
FOR ALL
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
)
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
);

-- 4. Оптимизация RLS-политик: Таблица `document_logs`
DROP POLICY IF EXISTS "Company document_logs policy" ON public.document_logs;
DROP POLICY IF EXISTS "document_logs_all_optimized" ON public.document_logs;

CREATE POLICY "document_logs_all_optimized"
ON public.document_logs
FOR ALL
TO authenticated
USING (
  is_super_admin() = true
  OR EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_logs.document_id
      AND (
        d.company_id = get_my_company_id()
        OR d.sender_company_id = get_my_company_id()
        OR d.receiver_company_id = get_my_company_id()
      )
  )
)
WITH CHECK (
  is_super_admin() = true
  OR EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = document_logs.document_id
      AND (
        d.company_id = get_my_company_id()
        OR d.sender_company_id = get_my_company_id()
        OR d.receiver_company_id = get_my_company_id()
      )
  )
);

-- 5. Оптимизация RLS-политик: Таблица `files`
DROP POLICY IF EXISTS "super_admin_full_access_files" ON public.files;
DROP POLICY IF EXISTS "Доступ к файлам своей компании" ON public.files;
DROP POLICY IF EXISTS "Users can manage company document files" ON public.files;
DROP POLICY IF EXISTS "files_all_optimized" ON public.files;

CREATE POLICY "files_all_optimized"
ON public.files
FOR ALL
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
  OR EXISTS (
    SELECT 1 FROM public.file_owners fo
    WHERE fo.file_id = files.id
      AND fo.company_id = get_my_company_id()
  )
)
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
);

-- 6. Оптимизация RLS-политик: Таблица `file_owners`
DROP POLICY IF EXISTS "Доступ к владельцам файлов своей к" ON public.file_owners;
DROP POLICY IF EXISTS "file_owners_all_optimized" ON public.file_owners;

CREATE POLICY "file_owners_all_optimized"
ON public.file_owners
FOR ALL
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
)
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
);

-- 7. Оптимизация RLS-политик: Таблица `company_closed_periods`
ALTER TABLE public.company_closed_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_closed_periods_all_optimized" ON public.company_closed_periods;

CREATE POLICY "company_closed_periods_all_optimized"
ON public.company_closed_periods
FOR ALL
TO authenticated
USING (
  is_super_admin() = true
  OR company_id = get_my_company_id()
)
WITH CHECK (
  is_super_admin() = true
  OR company_id = get_my_company_id()
);

-- 8. Высокопроизводительные составные B-Tree индексы
CREATE INDEX IF NOT EXISTS idx_documents_perf_sender_receiver 
  ON public.documents(sender_company_id, receiver_company_id, status, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_documents_perf_company_created 
  ON public.documents(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_counterparties_perf_lookup 
  ON public.counterparties(company_id, name ASC);

CREATE INDEX IF NOT EXISTS idx_files_perf_doc_created 
  ON public.files(document_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_perf_company_created 
  ON public.files(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_closed_periods_perf_check 
  ON public.company_closed_periods(company_id, year, month, status);

CREATE INDEX IF NOT EXISTS idx_join_requests_perf_pending 
  ON public.company_join_requests(company_id, status, created_at DESC);
