-- Инкрементальная миграция: Добавление таблицы кастомных ролей и матрицы доступов RBAC
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

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.company_roles(id) ON DELETE SET NULL;
