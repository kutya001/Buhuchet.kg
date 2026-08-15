-- =============================================================================
-- МИГРАЦИЯ 20260815000000: ИЗОЛЯЦИЯ SEARCH_PATH В ФУНКЦИЯХ SECURITY DEFINER (SEC-01)
-- =============================================================================

-- 1. Функция проверки суперадминистратора
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

-- 2. Функция проверки блокировки закрытого периода
CREATE OR REPLACE FUNCTION public.check_closed_period_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role TEXT;
    v_is_super BOOLEAN;
    v_company_id UUID;
    v_target_date DATE;
    v_year INT;
    v_month INT;
    v_is_closed BOOLEAN := FALSE;
    v_closed_until DATE;
BEGIN
    SELECT role, COALESCE(is_super_admin, FALSE)
    INTO v_user_role, v_is_super
    FROM public.users
    WHERE id = (SELECT auth.uid());

    IF v_user_role = 'owner' OR v_is_super = TRUE THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_company_id := OLD.company_id;
        IF TG_TABLE_NAME = 'documents' THEN
            v_target_date := COALESCE(OLD.doc_date, OLD.created_at::DATE);
        ELSE
            v_target_date := OLD.created_at::DATE;
        END IF;
    ELSE
        v_company_id := NEW.company_id;
        IF TG_TABLE_NAME = 'documents' THEN
            v_target_date := COALESCE(NEW.doc_date, NEW.created_at::DATE);
        ELSE
            v_target_date := NEW.created_at::DATE;
        END IF;
    END IF;

    IF v_company_id IS NULL OR v_target_date IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    v_year := EXTRACT(YEAR FROM v_target_date);
    v_month := EXTRACT(MONTH FROM v_target_date);

    SELECT EXISTS (
        SELECT 1 FROM public.company_closed_periods
        WHERE company_id = v_company_id
          AND year = v_year
          AND month = v_month
          AND status = 'closed'
    ) INTO v_is_closed;

    IF v_is_closed THEN
        RAISE EXCEPTION 'Отчетный период %-% закрыт. Операция заблокирована.', v_year, v_month;
    END IF;

    SELECT closed_period_until INTO v_closed_until
    FROM public.companies
    WHERE id = v_company_id;

    IF v_closed_until IS NOT NULL AND v_target_date <= v_closed_until THEN
        RAISE EXCEPTION 'Дата документа (%) входит в закрытый период до %. Операция запрещена.', v_target_date, v_closed_until;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- 3. Функция очистки осиротевших файлов (Copy-on-Write)
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_files()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.file_owners WHERE file_id = OLD.file_id) THEN
    DELETE FROM public.files WHERE id = OLD.file_id;
  END IF;
  RETURN OLD;
END;
$$;

-- 4. Функция постановки удаленного файла в очередь Cloudflare R2
CREATE OR REPLACE FUNCTION public.enqueue_deleted_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.file_path_r2 IS NOT NULL AND OLD.file_path_r2 <> '' THEN
    INSERT INTO public.pending_file_deletions (storage_key)
    VALUES (OLD.file_path_r2);
  END IF;
  RETURN OLD;
END;
$$;

-- 5. Функция сидинга дефолтных ролей
CREATE OR REPLACE FUNCTION public.seed_default_company_roles(target_comp_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Владелец',
    'Главный администратор и собственник организации. Полный доступ ко всем функциям и настройкам.',
    TRUE,
    '{
      "documents": {"view": true, "view_details": true, "create": true, "edit": true, "delete": true, "send": true, "accept": true, "recall": true},
      "files": {"view": true, "download": true, "upload": true, "edit": true, "delete": true},
      "counterparties": {"view": true, "request_partnership": true, "respond_partnership": true, "create_manual": true, "terminate": true},
      "employees": {"view": true, "create_employee": true, "edit_employee": true, "reset_password": true, "manage_roles": true},
      "company": {"view": true, "edit": true}
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Главный Бухгалтер',
    'Полный учет: Электронный документооборот, Облачный архив, Контрагенты и просмотр сотрудников.',
    FALSE,
    '{
      "documents": {"view": true, "view_details": true, "create": true, "edit": true, "delete": true, "send": true, "accept": true, "recall": true},
      "files": {"view": true, "download": true, "upload": true, "edit": true, "delete": true},
      "counterparties": {"view": true, "request_partnership": true, "respond_partnership": true, "create_manual": true, "terminate": true},
      "employees": {"view": true, "create_employee": false, "edit_employee": false, "reset_password": false, "manage_roles": false},
      "company": {"view": true, "edit": false}
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Менеджер по Продажам',
    'Оформление и отправка B2B первички контрагентам, просмотр базы партнеров.',
    FALSE,
    '{
      "documents": {"view": true, "view_details": true, "create": true, "edit": true, "delete": false, "send": true, "accept": false, "recall": true},
      "files": {"view": true, "download": true, "upload": true, "edit": false, "delete": false},
      "counterparties": {"view": true, "request_partnership": true, "respond_partnership": false, "create_manual": true, "terminate": false},
      "employees": {"view": false},
      "company": {"view": true, "edit": false}
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Бухгалтер-Оператор',
    'Проведение первички и прием входящей документации.',
    FALSE,
    '{
      "documents": {"view": true, "view_details": true, "create": false, "edit": false, "delete": false, "send": false, "accept": true, "recall": false},
      "files": {"view": true, "download": true, "upload": true, "edit": false, "delete": false},
      "counterparties": {"view": true, "request_partnership": false, "respond_partnership": false, "create_manual": false, "terminate": false},
      "employees": {"view": false},
      "company": {"view": true, "edit": false}
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;
END;
$$;
