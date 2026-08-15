-- ==============================================================================
-- МИГРАЦИЯ 20260819200000: Таблица настраиваемых тарифов лендинга
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.landing_pricing_plans (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price VARCHAR(50) NOT NULL,
  period VARCHAR(50) NOT NULL DEFAULT 'сом/мес',
  description TEXT,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  badge_text VARCHAR(100),
  sort_order INT NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  button_text VARCHAR(100) NOT NULL DEFAULT 'Выбрать тариф',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE public.landing_pricing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view landing plans" ON public.landing_pricing_plans;
CREATE POLICY "Public can view landing plans"
  ON public.landing_pricing_plans
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Superadmins can manage landing plans" ON public.landing_pricing_plans;
CREATE POLICY "Superadmins can manage landing plans"
  ON public.landing_pricing_plans
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    )
  );

-- Первичный сидинг тарифов
INSERT INTO public.landing_pricing_plans (id, name, price, period, description, is_popular, badge_text, sort_order, features, button_text)
VALUES
  (
    'start',
    'Старт',
    '990',
    'сом/мес',
    'Идеально для индивидуальных предпринимателей и малого бизнеса',
    false,
    NULL,
    1,
    '["До 100 первичных документов в месяц", "Облачный диск для сканов и файлов", "Telegram-оповещения по операциям", "Реестр контрагентов Кыргызстана", "Email-поддержка"]'::jsonb,
    'Выбрать тариф'
  ),
  (
    'business',
    'Бизнес',
    '2 490',
    'сом/мес',
    'Оптимальное решение для растущих компаний и торговых сетей',
    true,
    'Самый популярный',
    2,
    '["До 500 первичных документов в месяц", "Неограниченное число сотрудников", "Аппаратное закрытие отчетных периодов", "Совместный доступ к файлам", "Telegram-бот с прямым приемом файлов", "Приоритетная линия технической поддержки"]'::jsonb,
    'Начать 7 дней бесплатно'
  ),
  (
    'premium',
    'Премиум',
    '4 990',
    'сом/мес',
    'Для крупных предприятий и профессиональных бухгалтерских агентств',
    false,
    NULL,
    3,
    '["Неограниченный документооборот", "Выделенный объем дискового пространства", "Прямой доступ к каталогу топ-экспертов", "Персональный менеджер и консультации 24/7", "Экспорт и интеграционные механизмы"]'::jsonb,
    'Подключить Премиум'
  )
ON CONFLICT (id) DO NOTHING;

-- Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
