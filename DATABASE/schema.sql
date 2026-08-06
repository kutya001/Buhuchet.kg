-- =============================================================================
-- BUHUCHET.KG — ПОЛНЫЙ ВОСПРОИЗВОДИМЫЙ СКТИПТ СХЕМЫ БАЗЫ ДАННЫХ (POSTGRESQL / SUPABASE)
-- =============================================================================
-- Данный скрипт разворачивает всю физическую схему таблиц, внешние ключи, индексы,
-- хранимые процедуры/функции, триггеры и политики безопасности RLS с нуля.
-- =============================================================================

-- Включаем необходимые расширения PostgreSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. СЗДАНИЕ ТАБЛИЦ И СВЯЗЕЙ (DDL)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 Таблица: companies (Организации / Налогоплательщики КР)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_form TEXT CHECK (legal_form IN ('ИП', 'ОсОО', 'ЗАО', 'ОАО', 'КФХ')) DEFAULT 'ОсОО',
  inn VARCHAR(14) NOT NULL UNIQUE,
  industry TEXT DEFAULT 'Услуги / Консалтинг',
  director_name TEXT,
  email TEXT,
  phone VARCHAR(20),
  legal_address TEXT,
  address TEXT,
  privacy_settings JSONB DEFAULT '{"show_phone": true, "show_email": true, "show_address": true}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  status TEXT CHECK (status IN ('pending_approval', 'requires_changes', 'active', 'blocked')) DEFAULT 'pending_approval',
  moderation_comment TEXT,
  storage_limit_gb INT4 DEFAULT 10,
  closed_period_until DATE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.2 Таблица: company_roles (Матрица Прав и Ролей RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.3 Таблица: users (Профили Пользователей)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  role_id UUID REFERENCES public.company_roles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone VARCHAR(20),
  position VARCHAR(100) DEFAULT 'Сотрудник',
  role TEXT CHECK (role IN ('owner', 'accountant', 'manager')) DEFAULT 'manager',
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.4 Таблица: subscriptions (Тарифные Планы и Подписки)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  plan_type TEXT CHECK (plan_type IN ('basic', 'standard', 'pro')) DEFAULT 'basic',
  status TEXT CHECK (status IN ('active', 'expired', 'trial')) DEFAULT 'trial',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.5 Таблица: subscription_payments (Реестр Оплат / QR Платежи)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method TEXT DEFAULT 'qr_mbank',
  status TEXT CHECK (status IN ('pending', 'completed', 'failed')) DEFAULT 'completed',
  is_mock BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.6 Таблица: company_partnerships (Партнерская Сеть Взаимодействия B2B)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  target_company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'approved', 'accepted', 'rejected', 'cancelled', 'sent', 'recalled', 'suspended')) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (requester_company_id, target_company_id)
);

-- -----------------------------------------------------------------------------
-- 1.7 Таблица: counterparties (Справочник Контрагентов Компаний)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.counterparties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  target_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  inn VARCHAR(14) NOT NULL,
  is_vat_payer BOOLEAN DEFAULT FALSE,
  phone VARCHAR(20),
  email TEXT,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (company_id, inn)
);

-- -----------------------------------------------------------------------------
-- 1.8 Таблица: file_categories (Справочник Категорий Сканов Первички)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.file_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.9 Таблица: documents (Реестр Первичных Документов B2B)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES public.users(id) ON DELETE SET NULL NOT NULL,
  sender_company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  receiver_company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  counterparty_id UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  doc_number VARCHAR(50),
  doc_date DATE DEFAULT CURRENT_DATE,
  doc_type TEXT CHECK (doc_type IN ('realization', 'purchase', 'payment', 'advance')) NOT NULL,
  status TEXT CHECK (status IN ('draft', 'sent', 'accepted', 'processed', 'cancelled')) DEFAULT 'draft',
  total_amount NUMERIC(12, 2) DEFAULT 0.00,
  comment TEXT,
  file_path_r2 TEXT,
  mock_file_name TEXT,
  mock_file_size BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.10 Таблица: files (Хранилище Сканов и Документов Cloudflare R2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.file_categories(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  size_bytes BIGINT,
  file_type TEXT DEFAULT 'pdf',
  file_path_r2 TEXT NOT NULL,
  description TEXT,
  comment TEXT,
  is_internal BOOLEAN DEFAULT FALSE,
  is_legal_doc BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.11 Таблица: document_logs (Журнал Аудита Движения Документов)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 1.12 Таблицы: telegram_connections & telegram_verification_codes (Интеграция Бот)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_user_company_telegram UNIQUE (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.telegram_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code VARCHAR(4) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_pending_verification UNIQUE (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.telegram_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT,
  username TEXT,
  message_text TEXT,
  status TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================================================
-- 2. СОЗДАНИЕ ИНДЕКСОВ ДЛЯ УСКОРЕНИЯ ВЫБОРКИ (INDEXES)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_companies_inn ON public.companies(inn);
CREATE INDEX IF NOT EXISTS idx_companies_status ON public.companies(status);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON public.users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_company_roles_company_id ON public.company_roles(company_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_requester ON public.company_partnerships(requester_company_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_target ON public.company_partnerships(target_company_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_company ON public.counterparties(company_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_target_company ON public.counterparties(target_company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON public.documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_author_id ON public.documents(author_id);
CREATE INDEX IF NOT EXISTS idx_documents_counterparty_id ON public.documents(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_documents_sender ON public.documents(sender_company_id);
CREATE INDEX IF NOT EXISTS idx_documents_receiver ON public.documents(receiver_company_id);
CREATE INDEX IF NOT EXISTS idx_files_company ON public.files(company_id);
CREATE INDEX IF NOT EXISTS idx_files_document ON public.files(document_id);
CREATE INDEX IF NOT EXISTS idx_files_category_id ON public.files(category_id);
CREATE INDEX IF NOT EXISTS idx_doc_logs_document ON public.document_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_telegram_connections_company ON public.telegram_connections(company_id);

-- =============================================================================
-- 3. ХРАНИМЫЕ ПРОЦЕДУРЫ И СИДИНГ (FUNCTIONS & PROCEDURES)
-- =============================================================================

-- Автоматический сидинг дефолтных ролей (Владелец, Главбух, Менеджер) при онбординге
CREATE OR REPLACE FUNCTION public.seed_default_company_roles(target_comp_id UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.company_roles WHERE company_id = target_comp_id) THEN
    INSERT INTO public.company_roles (company_id, name, description, is_system, permissions) VALUES
    (target_comp_id, 'Главный Бухгалтер', 'Полный доступ к первичке, экспорту 1С и сверкам', TRUE, '{"documents":{"view":true,"create":true,"edit":true,"delete":true,"export":true},"employees":{"view":true},"files":{"view":true,"upload":true,"delete":true}}'::jsonb),
    (target_comp_id, 'Бухгалтер по Первичке', 'Загрузка и согласование накладных и актов', TRUE, '{"documents":{"view":true,"create":true,"edit":true},"files":{"view":true,"upload":true}}'::jsonb),
    (target_comp_id, 'Менеджер по Продажам', 'Просмотр отправленных документов и реестра контрагентов', TRUE, '{"documents":{"view":true,"create":true},"files":{"view":true}}'::jsonb);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Функция получения ID компании текущего сессионного пользователя RLS
CREATE OR REPLACE FUNCTION public.get_auth_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- 4. ПОЛИТИКИ БЕЗОПАСНОСТИ РОВНЕВОГО ДОСТУПА (ROW LEVEL SECURITY — RLS)
-- =============================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_logs ENABLE ROW LEVEL SECURITY;

-- 4.1 Публичное чтение наименований компаний для выборки Onboarding
CREATE POLICY "Public company list policy" ON public.companies
  FOR SELECT USING (is_active = TRUE);

-- 4.2 Изоляция пользователей по компании
CREATE POLICY "User company isolation policy" ON public.users
  FOR ALL USING (company_id = public.get_auth_user_company_id() OR id = auth.uid());

-- 4.3 Изоляция документов по компании
CREATE POLICY "Documents company isolation policy" ON public.documents
  FOR ALL USING (
    company_id = public.get_auth_user_company_id() OR
    sender_company_id = public.get_auth_user_company_id() OR
    receiver_company_id = public.get_auth_user_company_id()
  );

-- 4.4 Изоляция файлов в R2
CREATE POLICY "Files company isolation policy" ON public.files
  FOR ALL USING (company_id = public.get_auth_user_company_id());

-- 4.5 Изоляция контрагентов
CREATE POLICY "Counterparties company isolation policy" ON public.counterparties
  FOR ALL USING (company_id = public.get_auth_user_company_id());
