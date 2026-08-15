-- ==============================================================================
-- МИГРАЦИЯ 20260820000000: Настройка публичного RLS для тарифных планов и изоляция
-- ==============================================================================

-- 1. Добавление колонки is_active в landing_pricing_plans
ALTER TABLE public.landing_pricing_plans
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Включение Row Level Security
ALTER TABLE public.landing_pricing_plans ENABLE ROW LEVEL SECURITY;

-- 3. Политика публичного чтения только активных тарифов для anon и authenticated
DROP POLICY IF EXISTS "Public can view landing plans" ON public.landing_pricing_plans;
DROP POLICY IF EXISTS "Public can view active landing plans" ON public.landing_pricing_plans;

CREATE POLICY "Public can view active landing plans"
  ON public.landing_pricing_plans
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

-- 4. Политика полного управления для суперадминистратора
DROP POLICY IF EXISTS "Superadmins can manage landing plans" ON public.landing_pricing_plans;

CREATE POLICY "Superadmins can manage landing plans"
  ON public.landing_pricing_plans
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    )
  );

-- 5. Гарантия тенантной изоляции в company_closed_periods
DROP POLICY IF EXISTS "company_closed_periods_tenant_isolation" ON public.company_closed_periods;

CREATE POLICY "company_closed_periods_tenant_isolation"
  ON public.company_closed_periods
  FOR ALL
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    ))
    OR company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    ))
    OR company_id = (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
  );

-- 6. Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
