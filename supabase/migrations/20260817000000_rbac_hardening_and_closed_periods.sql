-- ==============================================================================
-- МИГРАЦИЯ: Харденинг RBAC, Защита Роли Owner и Права на Закрытые Периоды
-- ==============================================================================

-- 1. Обновление процедуры генерации стандартных ролей
CREATE OR REPLACE FUNCTION public.seed_default_company_roles(target_comp_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Роль: Владелец (Системная)
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Владелец',
    'Главный администратор и собственник организации. Полный доступ ко всем функциям и настройкам.',
    TRUE,
    '{
      "dashboard": {"view": true},
      "documents": {
        "view": true, "view_details": true, "create": true, "edit": true,
        "delete": true, "send": true, "accept": true, "recall": true,
        "export": true, "view_all_statuses": true
      },
      "files": {
        "view": true, "view_details": true, "download": true, "upload": true,
        "edit": true, "delete": true
      },
      "counterparties": {
        "view": true, "tab_counterparties": true, "tab_partnerships": true,
        "tab_catalog": true, "request_partnership": true, "respond_partnership": true,
        "create_manual": true, "terminate": true
      },
      "employees": {
        "view": true, "tab_my_profile": true, "tab_employees": true, "tab_roles": true,
        "edit_my_profile": true, "create_employee": true, "edit_employee": true,
        "reset_password": true, "create_role": true, "edit_role": true, "delete_role": true,
        "telegram_bind": true, "notify_documents": true, "notify_collaboration": true
      },
      "company": {
        "view": true, "tab_profile": true, "tab_legal_docs": true, "tab_periods": true,
        "periods_view": true, "periods_manage": true, "edit": true,
        "upload_legal_doc": true, "add_legal_doc": true, "edit_legal_doc": true, "delete_legal_doc": true
      },
      "subscription": {
        "view": true, "manage_subscription": true
      }
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO UPDATE
  SET permissions = EXCLUDED.permissions,
      description = EXCLUDED.description;

  -- 2. Роль: Главный Бухгалтер
  INSERT INTO public.company_roles (company_id, name, description, is_system, FALSE)
  VALUES (
    target_comp_id,
    'Главный Бухгалтер',
    'Полный бухгалтерский учет: документооборот, закрытие налоговых периодов, файлы и контрагенты.',
    FALSE,
    '{
      "dashboard": {"view": true},
      "documents": {
        "view": true, "view_details": true, "create": true, "edit": true,
        "delete": true, "send": true, "accept": true, "recall": true,
        "export": true, "view_all_statuses": true
      },
      "files": {
        "view": true, "view_details": true, "download": true, "upload": true,
        "edit": true, "delete": true
      },
      "counterparties": {
        "view": true, "tab_counterparties": true, "tab_partnerships": true,
        "tab_catalog": true, "request_partnership": true, "respond_partnership": true,
        "create_manual": true, "terminate": true
      },
      "employees": {
        "view": true, "tab_my_profile": true, "tab_employees": true, "tab_roles": false,
        "edit_my_profile": true, "create_employee": false, "edit_employee": false,
        "reset_password": false, "create_role": false, "edit_role": false, "delete_role": false,
        "telegram_bind": true, "notify_documents": true, "notify_collaboration": true
      },
      "company": {
        "view": true, "tab_profile": true, "tab_legal_docs": true, "tab_periods": true,
        "periods_view": true, "periods_manage": true, "edit": false,
        "upload_legal_doc": true, "add_legal_doc": true, "edit_legal_doc": true, "delete_legal_doc": false
      },
      "subscription": {
        "view": true, "manage_subscription": false
      }
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  -- 3. Роль: Бухгалтер-Оператор
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Бухгалтер-Оператор',
    'Оформление первички, проведение документов и реестр контрагентов (без закрытия периода).',
    FALSE,
    '{
      "dashboard": {"view": true},
      "documents": {
        "view": true, "view_details": true, "create": true, "edit": true,
        "delete": false, "send": true, "accept": true, "recall": false,
        "export": true, "view_all_statuses": true
      },
      "files": {
        "view": true, "view_details": true, "download": true, "upload": true,
        "edit": false, "delete": false
      },
      "counterparties": {
        "view": true, "tab_counterparties": true, "tab_partnerships": true,
        "tab_catalog": true, "request_partnership": false, "respond_partnership": false,
        "create_manual": true, "terminate": false
      },
      "employees": {
        "view": true, "tab_my_profile": true, "tab_employees": false, "tab_roles": false,
        "edit_my_profile": true, "telegram_bind": true, "notify_documents": true, "notify_collaboration": false
      },
      "company": {
        "view": true, "tab_profile": true, "tab_legal_docs": false, "tab_periods": true,
        "periods_view": true, "periods_manage": false, "edit": false
      },
      "subscription": {
        "view": true, "manage_subscription": false
      }
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  -- 4. Роль: Менеджер по Продажам
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Менеджер по Продажам',
    'Оформление и отправка исходящих документов клиентам, просмотр справочника контрагентов.',
    FALSE,
    '{
      "dashboard": {"view": true},
      "documents": {
        "view": true, "view_details": true, "create": true, "edit": true,
        "delete": false, "send": true, "accept": false, "recall": true,
        "export": false, "view_all_statuses": true
      },
      "files": {
        "view": true, "view_details": true, "download": true, "upload": true,
        "edit": false, "delete": false
      },
      "counterparties": {
        "view": true, "tab_counterparties": true, "tab_partnerships": true,
        "tab_catalog": true, "request_partnership": true, "respond_partnership": false,
        "create_manual": true, "terminate": false
      },
      "employees": {
        "view": false, "tab_my_profile": true, "edit_my_profile": true, "telegram_bind": true
      },
      "company": {
        "view": true, "tab_profile": true, "tab_legal_docs": false, "tab_periods": false,
        "periods_view": false, "periods_manage": false, "edit": false
      },
      "subscription": {
        "view": false, "manage_subscription": false
      }
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;

  -- 5. Роль: Наблюдатель (Аудитор)
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Наблюдатель (Аудитор)',
    'Только чтение: просмотр реестров документов, файлов и контрагентов без права модификации.',
    FALSE,
    '{
      "dashboard": {"view": true},
      "documents": {
        "view": true, "view_details": true, "create": false, "edit": false,
        "delete": false, "send": false, "accept": false, "recall": false,
        "export": true, "view_all_statuses": true
      },
      "files": {
        "view": true, "view_details": true, "download": true, "upload": false,
        "edit": false, "delete": false
      },
      "counterparties": {
        "view": true, "tab_counterparties": true, "tab_partnerships": false,
        "tab_catalog": true, "request_partnership": false, "respond_partnership": false,
        "create_manual": false, "terminate": false
      },
      "employees": {
        "view": false, "tab_my_profile": true, "edit_my_profile": true, "telegram_bind": false
      },
      "company": {
        "view": true, "tab_profile": true, "tab_legal_docs": true, "tab_periods": true,
        "periods_view": true, "periods_manage": false, "edit": false
      },
      "subscription": {
        "view": true, "manage_subscription": false
      }
    }'::jsonb
  )
  ON CONFLICT (company_id, name) DO NOTHING;
END;
$$;

-- 2. Триггерная функция защиты роли Владельца от несанкционированного присвоения
CREATE OR REPLACE FUNCTION public.check_owner_role_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_owner_id UUID;
  v_is_system_role BOOLEAN := FALSE;
  v_role_name TEXT;
BEGIN
  -- Получаем владельца компании
  IF NEW.company_id IS NOT NULL THEN
    SELECT owner_id INTO v_company_owner_id 
    FROM public.companies 
    WHERE id = NEW.company_id;
  END IF;

  -- Проверяем, назначена ли роль Владелец
  IF NEW.role_id IS NOT NULL THEN
    SELECT is_system, name INTO v_is_system_role, v_role_name
    FROM public.company_roles
    WHERE id = NEW.role_id;
  END IF;

  -- Запрет: назначение role = 'owner' или системной роли Владельца не-создателю компании
  IF (NEW.role = 'owner' OR v_is_system_role = TRUE OR v_role_name = 'Владелец') THEN
    IF v_company_owner_id IS NOT NULL AND NEW.id != v_company_owner_id AND NEW.is_super_admin IS NOT TRUE THEN
      RAISE EXCEPTION '403 Forbidden: Роль Владельца может принадлежать только создателю организации (companies.owner_id)';
    END IF;
  END IF;

  -- Запрет: снятие роли owner с реального собственника компании
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' AND NEW.role != 'owner' AND OLD.id = v_company_owner_id AND NEW.is_super_admin IS NOT TRUE THEN
      RAISE EXCEPTION '403 Forbidden: Запрещено отзывать роль Владельца у собственника организации';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_owner_role_security ON public.users;
CREATE TRIGGER trg_check_owner_role_security
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.check_owner_role_security();

-- 3. Обновление прав существующих ролей Главного Бухгалтера и Владельца
UPDATE public.company_roles
SET permissions = jsonb_set(
  jsonb_set(
    permissions,
    '{company,periods_manage}',
    'true'::jsonb,
    true
  ),
  '{company,periods_view}',
  'true'::jsonb,
  true
)
WHERE name IN ('Владелец', 'Главный Бухгалтер') OR is_system = TRUE;
