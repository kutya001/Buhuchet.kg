-- =============================================================================
-- МИГРАЦИЯ 20260815000001: НЕИЗМЕНЯЕМЫЙ ЖУРНАЛ АУДИТА AUDIT_LOGS (DATA-02)
-- =============================================================================

-- 1. Создание неизменяемой таблицы audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,                  -- 'INSERT', 'UPDATE', 'DELETE', 'PERIOD_CLOSE', 'ROLE_CHANGE', etc.
    entity_type TEXT NOT NULL,             -- 'company_closed_periods', 'company_roles', 'users', 'documents', 'files'
    entity_id TEXT NOT NULL,               -- Идентификатор целевой сущности
    actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы для быстрой фильтрации аудита
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON public.audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id);

-- 2. Включение Row Level Security (RLS)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 2.1 SELECT: Только пользователи своей организации или Суперадминистраторы
DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
CREATE POLICY "audit_logs_select_policy" ON public.audit_logs
FOR SELECT TO authenticated
USING (
    public.is_super_admin() OR
    company_id IN (SELECT company_id FROM public.users WHERE id = (SELECT auth.uid()))
);

-- 2.2 INSERT: Разрешено для авторизованных пользователей и служебных процессов
DROP POLICY IF EXISTS "audit_logs_insert_policy" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_policy" ON public.audit_logs
FOR INSERT TO authenticated, service_role
WITH CHECK (true);

-- 2.3 ЗАПРЕТ UPDATE И DELETE НА УРОВНЕ RLS: Нет разрешающих политик

-- 3. Защита от мутаций на уровне СУБД: триггерная блокировка UPDATE и DELETE
CREATE OR REPLACE FUNCTION public.prevent_audit_logs_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Записи журнала аудита неизменяемы (UPDATE запрещен на уровне ядра СУБД)';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Удаление записей журнала аудита запрещено на уровне ядра СУБД';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_logs_mutation ON public.audit_logs;
CREATE TRIGGER trg_prevent_audit_logs_mutation
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_logs_mutation();

-- 4. Автоматический триггер аудита критических сущностей БД
CREATE OR REPLACE FUNCTION public.audit_critical_table_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_company UUID;
    v_entity_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_entity_id := OLD.id::TEXT;
        v_company := CASE 
            WHEN TG_TABLE_NAME = 'companies' THEN OLD.id
            ELSE OLD.company_id
        END;

        INSERT INTO public.audit_logs (
            action,
            entity_type,
            entity_id,
            actor_user_id,
            company_id,
            old_values,
            new_values
        ) VALUES (
            'DELETE',
            TG_TABLE_NAME,
            v_entity_id,
            v_actor,
            v_company,
            to_jsonb(OLD),
            NULL
        );
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        v_entity_id := NEW.id::TEXT;
        v_company := CASE 
            WHEN TG_TABLE_NAME = 'companies' THEN NEW.id
            ELSE NEW.company_id
        END;

        INSERT INTO public.audit_logs (
            action,
            entity_type,
            entity_id,
            actor_user_id,
            company_id,
            old_values,
            new_values
        ) VALUES (
            'UPDATE',
            TG_TABLE_NAME,
            v_entity_id,
            v_actor,
            v_company,
            to_jsonb(OLD),
            to_jsonb(NEW)
        );
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        v_entity_id := NEW.id::TEXT;
        v_company := CASE 
            WHEN TG_TABLE_NAME = 'companies' THEN NEW.id
            ELSE NEW.company_id
        END;

        INSERT INTO public.audit_logs (
            action,
            entity_type,
            entity_id,
            actor_user_id,
            company_id,
            old_values,
            new_values
        ) VALUES (
            'INSERT',
            TG_TABLE_NAME,
            v_entity_id,
            v_actor,
            v_company,
            NULL,
            to_jsonb(NEW)
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

-- 4.1 Триггер аудита закрытия/открытия периодов
DROP TRIGGER IF EXISTS trg_audit_closed_periods ON public.company_closed_periods;
CREATE TRIGGER trg_audit_closed_periods
AFTER INSERT OR UPDATE OR DELETE ON public.company_closed_periods
FOR EACH ROW
EXECUTE FUNCTION public.audit_critical_table_changes();

-- 4.2 Триггер аудита изменений ролей и прав
DROP TRIGGER IF EXISTS trg_audit_company_roles ON public.company_roles;
CREATE TRIGGER trg_audit_company_roles
AFTER INSERT OR UPDATE OR DELETE ON public.company_roles
FOR EACH ROW
EXECUTE FUNCTION public.audit_critical_table_changes();
