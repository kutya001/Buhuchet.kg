-- SQL Миграция: Удаление дубликатов ролей и добавление UNIQUE constraint

-- 1. Удаляем скопившиеся дубликаты, оставляя только 1 уникальную запись для каждой пары (company_id, name)
DELETE FROM public.company_roles
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, name ORDER BY created_at ASC) as rnum
    FROM public.company_roles
  ) t
  WHERE t.rnum > 1
);

-- 2. Добавляем Уникальный Индекс (UNIQUE Constraint), предотвращающий дублирование в будущем
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_roles_company_id_name_key'
  ) THEN
    ALTER TABLE public.company_roles
    ADD CONSTRAINT company_roles_company_id_name_key UNIQUE (company_id, name);
  END IF;
END $$;

-- 3. Обновляем RPC-функцию сидинга дефолтных ролей с защитой от дублирования
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
  ON CONFLICT (company_id, name) DO NOTHING;

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
  ON CONFLICT (company_id, name) DO NOTHING;

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
  ON CONFLICT (company_id, name) DO NOTHING;

  -- 4. Бухгалтер-Оператор
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
$$ LANGUAGE plpgsql;
