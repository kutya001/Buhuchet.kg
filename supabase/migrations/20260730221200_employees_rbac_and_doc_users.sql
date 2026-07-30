-- 1. Таблица ролей организации и матрицы доступов RBAC
CREATE TABLE IF NOT EXISTS public.company_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_roles_company ON public.company_roles(company_id);

-- 2. Расширение таблицы users для сотрудников
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.company_roles(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS position TEXT DEFAULT 'Сотрудник';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_role_id ON public.users(role_id);

-- 3. Расширение таблицы documents по сотрудникам отправителям и получателям
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS sender_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS receiver_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_sender_user ON public.documents(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_documents_receiver_user ON public.documents(receiver_user_id);

-- Включение RLS для company_roles
ALTER TABLE public.company_roles ENABLE ROW LEVEL SECURITY;
