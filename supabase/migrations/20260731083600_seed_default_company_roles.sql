-- SQL Миграция: Автоматическое создание 4 базовых ролей для существующих и новых организаций
CREATE OR REPLACE FUNCTION seed_default_company_roles(target_comp_id UUID)
RETURNS VOID AS $$
BEGIN
  -- 1. Системная роль Владелец
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
  ON CONFLICT DO NOTHING;

  -- 2. Главный Бухгалтер
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
  ON CONFLICT DO NOTHING;

  -- 3. Менеджер по Продажам
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
  ON CONFLICT DO NOTHING;

  -- 4. Бухгалтер-Оператор
  INSERT INTO public.company_roles (company_id, name, description, is_system, permissions)
  VALUES (
    target_comp_id,
    'Бухгалтер-Оператор',
    'Принятие и подтверждение входящих B2B документов, загрузка и скачивание файлов из архива.',
    FALSE,
    '{
      "documents": {"view": true, "view_details": true, "create": false, "edit": false, "delete": false, "send": false, "accept": true, "recall": false},
      "files": {"view": true, "download": true, "upload": true, "edit": false, "delete": false},
      "counterparties": {"view": true, "request_partnership": false, "respond_partnership": false, "create_manual": false, "terminate": false},
      "employees": {"view": false},
      "company": {"view": true, "edit": false}
    }'::jsonb
  )
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Автоматический генерация ролей для ВСЕХ имеющихся компаний в базе данных
DO $$
DECLARE
  comp_record RECORD;
BEGIN
  FOR comp_record IN SELECT id FROM public.companies LOOP
    PERFORM seed_default_company_roles(comp_record.id);
  END LOOP;
END;
$$;
