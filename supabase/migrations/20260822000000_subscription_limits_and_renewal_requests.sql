-- ==============================================================================
-- МИГРАЦИЯ 20260822000000: Лимиты тарифов, квотирование и заявки на продление подписки
-- ==============================================================================

-- 1. Расширение таблицы landing_pricing_plans и создание pricing_plans
ALTER TABLE IF EXISTS public.landing_pricing_plans
  ADD COLUMN IF NOT EXISTS max_counterparties INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_employees INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT NOT NULL DEFAULT 1073741824,
  ADD COLUMN IF NOT EXISTS is_telegram_enabled BOOLEAN NOT NULL DEFAULT false;

-- Обновление стандартных тарифов лендинга квотами
UPDATE public.landing_pricing_plans
SET 
  max_counterparties = 10,
  max_employees = 3,
  storage_limit_bytes = 1073741824, -- 1 GB
  is_telegram_enabled = false
WHERE id = 'start';

UPDATE public.landing_pricing_plans
SET 
  max_counterparties = 50,
  max_employees = 15,
  storage_limit_bytes = 10737418240, -- 10 GB
  is_telegram_enabled = true
WHERE id = 'business';

UPDATE public.landing_pricing_plans
SET 
  max_counterparties = 500,
  max_employees = 100,
  storage_limit_bytes = 107374182400, -- 100 GB
  is_telegram_enabled = true
WHERE id = 'premium';

-- Таблица pricing_plans для полной совместимости
CREATE TABLE IF NOT EXISTS public.pricing_plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price VARCHAR(50) NOT NULL,
  period VARCHAR(50) NOT NULL DEFAULT 'сом/мес',
  description TEXT,
  max_counterparties INTEGER NOT NULL DEFAULT 10,
  max_employees INTEGER NOT NULL DEFAULT 3,
  storage_limit_bytes BIGINT NOT NULL DEFAULT 1073741824,
  is_telegram_enabled BOOLEAN NOT NULL DEFAULT false,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  badge_text VARCHAR(100),
  sort_order INT NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  button_text VARCHAR(100) NOT NULL DEFAULT 'Выбрать тариф',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pricing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active pricing plans" ON public.pricing_plans;
CREATE POLICY "Public can view active pricing plans"
  ON public.pricing_plans
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Superadmins can manage pricing plans" ON public.pricing_plans;
CREATE POLICY "Superadmins can manage pricing plans"
  ON public.pricing_plans
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid()) AND users.is_super_admin = true
    )
  );

-- Синхронизация записей в pricing_plans
INSERT INTO public.pricing_plans (id, name, price, period, description, max_counterparties, max_employees, storage_limit_bytes, is_telegram_enabled, is_popular, badge_text, sort_order, features, button_text, is_active)
SELECT id, name, price, period, description, max_counterparties, max_employees, storage_limit_bytes, is_telegram_enabled, is_popular, badge_text, sort_order, features, button_text, is_active
FROM public.landing_pricing_plans
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  max_counterparties = EXCLUDED.max_counterparties,
  max_employees = EXCLUDED.max_employees,
  storage_limit_bytes = EXCLUDED.storage_limit_bytes,
  is_telegram_enabled = EXCLUDED.is_telegram_enabled,
  updated_at = NOW();

-- 2. Модификация таблицы companies (ручные оверрайды квот)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS custom_max_counterparties INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_max_employees INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_storage_limit_bytes BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_telegram_enabled BOOLEAN DEFAULT NULL;

-- 3. Создание таблицы subscription_renewal_requests (Заявки на продление/смену тарифа)
CREATE TABLE IF NOT EXISTS public.subscription_renewal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_plan_id VARCHAR(50) NOT NULL REFERENCES public.landing_pricing_plans(id) ON DELETE RESTRICT,
  billing_period_months INTEGER NOT NULL DEFAULT 1 CHECK (billing_period_months IN (1, 3, 6, 12)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  comment TEXT,
  admin_notes TEXT,
  processed_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Составные индексы
CREATE INDEX IF NOT EXISTS idx_renewal_requests_company_status 
  ON public.subscription_renewal_requests(company_id, status);

CREATE INDEX IF NOT EXISTS idx_renewal_requests_status_created 
  ON public.subscription_renewal_requests(status, created_at DESC);

-- 5. RLS-политики
ALTER TABLE public.subscription_renewal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view company renewal requests" ON public.subscription_renewal_requests;
CREATE POLICY "Members can view company renewal requests"
  ON public.subscription_renewal_requests
  FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT users.company_id FROM public.users WHERE users.id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.is_super_admin = true
    )
  );

DROP POLICY IF EXISTS "Company managers can create renewal requests" ON public.subscription_renewal_requests;
CREATE POLICY "Company managers can create renewal requests"
  ON public.subscription_renewal_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT users.company_id FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND (users.role = 'owner' OR users.role = 'manager' OR users.is_super_admin = true)
    )
  );

DROP POLICY IF EXISTS "Superadmin full manage renewal requests" ON public.subscription_renewal_requests;
CREATE POLICY "Superadmin full manage renewal requests"
  ON public.subscription_renewal_requests
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users WHERE users.id = (SELECT auth.uid()) AND users.is_super_admin = true
    )
  );

-- 6. Хранимая атомарная процедура одобрения заявки суперадминистратором
CREATE OR REPLACE FUNCTION public.admin_approve_renewal_request_atomic(
  p_request_id UUID,
  p_admin_id UUID,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_sub RECORD;
  v_new_expires_at TIMESTAMPTZ;
BEGIN
  -- 1. Проверяем статус суперадминистратора
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_admin_id AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Доступ запрещен: требуется статус суперадминистратора';
  END IF;

  -- 2. Блокируем и читаем заявку
  SELECT * INTO v_req
  FROM public.subscription_renewal_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Заявка на продление не найдена или уже обработана';
  END IF;

  -- 3. Получаем текущую подписку компании
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE company_id = v_req.company_id
  FOR UPDATE;

  -- 4. Рассчитываем новую дату окончания: от текущей даты или от expires_at (если в будущем) + N месяцев
  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at > NOW() THEN
    v_new_expires_at := v_sub.expires_at + (v_req.billing_period_months || ' month')::INTERVAL;
  ELSE
    v_new_expires_at := NOW() + (v_req.billing_period_months || ' month')::INTERVAL;
  END IF;

  -- 5. Обновляем статус заявки
  UPDATE public.subscription_renewal_requests
  SET 
    status = 'approved',
    admin_notes = p_admin_notes,
    processed_by_user_id = p_admin_id,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id;

  -- 6. Обновляем подписку компании
  IF v_sub.id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET 
      plan_type = v_req.target_plan_id,
      status = 'active',
      expires_at = v_new_expires_at,
      updated_at = NOW()
    WHERE id = v_sub.id;
  ELSE
    INSERT INTO public.subscriptions (
      company_id,
      plan_type,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      v_req.company_id,
      v_req.target_plan_id,
      'active',
      v_new_expires_at,
      NOW(),
      NOW()
    );
  END IF;

  -- 7. Фиксация в аудите
  INSERT INTO public.admin_audit_logs (
    admin_id,
    action,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_id,
    'subscription_renewal_approved',
    'subscription_renewal_request',
    p_request_id,
    jsonb_build_object(
      'company_id', v_req.company_id,
      'target_plan_id', v_req.target_plan_id,
      'billing_period_months', v_req.billing_period_months,
      'new_expires_at', v_new_expires_at
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'company_id', v_req.company_id,
    'new_expires_at', v_new_expires_at,
    'plan_type', v_req.target_plan_id
  );
END;
$$;

-- Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
