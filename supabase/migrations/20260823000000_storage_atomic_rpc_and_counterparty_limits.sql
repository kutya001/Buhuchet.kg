-- ==============================================================================
-- МИГРАЦИЯ 20260823000000: Атомарный учет памяти облачного диска и двунаправленные лимиты контрагентов
-- ==============================================================================

-- 1. Добавление колонки storage_used_bytes в таблицу companies (если не существует)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS storage_used_bytes BIGINT NOT NULL DEFAULT 0;

-- Первичная инициализация storage_used_bytes фактическим размером загруженных файлов
UPDATE public.companies c
SET storage_used_bytes = COALESCE(
  (
    SELECT SUM(COALESCE(size_bytes, 0))
    FROM public.files f
    WHERE f.company_id = c.id
  ),
  0
);

-- 2. Хранимая функция атомарного изменения занятого объема памяти
CREATE OR REPLACE FUNCTION public.increment_company_storage(
  p_company_id UUID,
  p_bytes BIGINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.companies
  SET 
    storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes, 0) + p_bytes),
    updated_at = NOW()
  WHERE id = p_company_id;
END;
$$;

-- 3. Настройка прав выполнения функции increment_company_storage
REVOKE EXECUTE ON FUNCTION public.increment_company_storage(UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_company_storage(UUID, BIGINT) TO authenticated, service_role;

-- 4. Создание индексов для двунаправленного подсчета контрагентов
CREATE INDEX IF NOT EXISTS idx_partnerships_bidirectional 
  ON public.company_partnerships(requester_company_id, target_company_id, status);

CREATE INDEX IF NOT EXISTS idx_partnerships_target_status 
  ON public.company_partnerships(target_company_id, status);

-- 5. Обновление процедуры одобрения продления подписки с точным расчетом дат
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
  v_base_date TIMESTAMPTZ;
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

  -- 4. Точный расчет даты окончания:
  -- Если текущая подписка активна и срок в будущем (expires_at > now()), продлеваем от expires_at.
  -- Если срок истек (expires_at <= now()) или подписка отсутствует, продлеваем от текущего момента now().
  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at > NOW() THEN
    v_base_date := v_sub.expires_at;
  ELSE
    v_base_date := NOW();
  END IF;

  v_new_expires_at := v_base_date + (v_req.billing_period_months || ' month')::INTERVAL;

  -- 5. Обновляем статус заявки на 'approved'
  UPDATE public.subscription_renewal_requests
  SET 
    status = 'approved',
    admin_notes = p_admin_notes,
    processed_by_user_id = p_admin_id,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_request_id;

  -- 6. Обновляем подписку компании с переводом в 'active'
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
      'new_expires_at', v_new_expires_at,
      'base_date', v_base_date
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
