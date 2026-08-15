-- ==============================================================================
-- МИГРАЦИЯ: Харденинг Панели Суперадмина, Атомарность Модерации и Аналитика
-- ==============================================================================

-- 1. Таблица журнала аудита действий суперадминистратора
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin ON public.admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON public.admin_audit_logs(action, target_type);

-- RLS для admin_audit_logs (только суперадмины)
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins can read audit logs" ON public.admin_audit_logs;
CREATE POLICY "Superadmins can read audit logs"
    ON public.admin_audit_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = (SELECT auth.uid()) AND users.is_super_admin = true
        )
    );

-- 2. Расширение таблицы очереди очистки файлов pending_file_deletions
ALTER TABLE public.pending_file_deletions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS error TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pending_file_deletions_status ON public.pending_file_deletions(status, created_at);

-- 3. Хранимая процедура атомарной модерации и активации компании
CREATE OR REPLACE FUNCTION public.admin_approve_company_atomic(
    p_company_id UUID,
    p_admin_id UUID,
    p_plan_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_company RECORD;
    v_owner RECORD;
    v_owner_role_id UUID;
BEGIN
    -- 1. Проверяем существование компании
    SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Компания с ID % не найдена', p_company_id;
    END IF;

    -- 2. Активируем статус компании
    UPDATE public.companies
    SET 
        status = 'active',
        moderation_comment = NULL,
        updated_at = NOW()
    WHERE id = p_company_id;

    -- 3. Генерируем дефолтные системные роли компании
    PERFORM public.seed_default_company_roles(p_company_id);

    -- 4. Находим ID роли 'Владелец'
    SELECT id INTO v_owner_role_id 
    FROM public.company_roles 
    WHERE company_id = p_company_id AND is_system = true AND name = 'Владелец'
    LIMIT 1;

    -- 5. Привязываем и активируем владельца компании
    IF v_company.owner_id IS NOT NULL THEN
        UPDATE public.users
        SET 
            company_id = p_company_id,
            role = 'owner',
            role_id = v_owner_role_id,
            is_active = true,
            updated_at = NOW()
        WHERE id = v_company.owner_id;
    ELSE
        -- Ищем первого зарегистрированного пользователя компании с ролью owner
        UPDATE public.users
        SET 
            role = 'owner',
            role_id = v_owner_role_id,
            is_active = true,
            updated_at = NOW()
        WHERE company_id = p_company_id AND (role = 'owner' OR role IS NULL)
        AND id = (SELECT id FROM public.users WHERE company_id = p_company_id ORDER BY created_at ASC LIMIT 1);
    END IF;

    -- 6. Создаем стартовую подписку (если отсутствует)
    IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE company_id = p_company_id) THEN
        INSERT INTO public.subscriptions (
            company_id,
            plan_type,
            status,
            expires_at,
            created_at,
            updated_at
        ) VALUES (
            p_company_id,
            'standard',
            'active',
            NOW() + INTERVAL '1 year',
            NOW(),
            NOW()
        );
    ELSE
        UPDATE public.subscriptions
        SET status = 'active', updated_at = NOW()
        WHERE company_id = p_company_id;
    END IF;

    -- 7. Фиксация в журнале аудита администратора
    INSERT INTO public.admin_audit_logs (
        admin_id,
        action,
        target_type,
        target_id,
        details
    ) VALUES (
        p_admin_id,
        'company_approved',
        'company',
        p_company_id,
        jsonb_build_object('company_name', v_company.name, 'inn', v_company.inn)
    );

    RETURN jsonb_build_object(
        'success', true,
        'company_id', p_company_id,
        'company_name', v_company.name,
        'status', 'active'
    );
END;
$$;

-- 4. Хранимая функция агрегации статистики платформы за один проход
CREATE OR REPLACE FUNCTION public.get_platform_summary_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_companies BIGINT;
    v_active_companies BIGINT;
    v_pending_companies BIGINT;
    v_total_users BIGINT;
    v_total_documents BIGINT;
    v_total_files BIGINT;
    v_total_storage_bytes BIGINT;
    v_active_subscriptions BIGINT;
    v_expired_subscriptions BIGINT;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'active'),
        COUNT(*) FILTER (WHERE status = 'pending')
    INTO v_total_companies, v_active_companies, v_pending_companies
    FROM public.companies;

    SELECT COUNT(*) INTO v_total_users FROM public.users;
    SELECT COUNT(*) INTO v_total_documents FROM public.documents;
    
    SELECT 
        COUNT(*),
        COALESCE(SUM(size_bytes), 0)
    INTO v_total_files, v_total_storage_bytes
    FROM public.files;

    SELECT 
        COUNT(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())),
        COUNT(*) FILTER (WHERE status = 'past_due' OR (expires_at IS NOT NULL AND expires_at <= NOW()))
    INTO v_active_subscriptions, v_expired_subscriptions
    FROM public.subscriptions;

    RETURN jsonb_build_object(
        'companies', jsonb_build_object(
            'total', v_total_companies,
            'active', v_active_companies,
            'pending', v_pending_companies
        ),
        'users', jsonb_build_object(
            'total', v_total_users
        ),
        'documents', jsonb_build_object(
            'total', v_total_documents
        ),
        'files', jsonb_build_object(
            'total', v_total_files,
            'total_size_bytes', v_total_storage_bytes
        ),
        'subscriptions', jsonb_build_object(
            'active', v_active_subscriptions,
            'expired', v_expired_subscriptions
        )
    );
END;
$$;

-- 5. Хранимая функция контроля истекших подписок
CREATE OR REPLACE FUNCTION public.cron_check_expired_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated_count INTEGER;
BEGIN
    UPDATE public.subscriptions
    SET 
        status = 'past_due',
        updated_at = NOW()
    WHERE 
        status = 'active' 
        AND expires_at IS NOT NULL 
        AND expires_at < NOW();

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

-- Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
