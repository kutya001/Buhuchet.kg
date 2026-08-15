-- ==============================================================================
-- МИГРАЦИЯ 20260819000000: Защита системных ролей от удаления (RBAC Hardening)
-- ==============================================================================

-- 1. Триггер запрета удаления системных ролей (is_system = true)
CREATE OR REPLACE FUNCTION public.prevent_system_role_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.is_system = true THEN
        RAISE EXCEPTION '403 Forbidden: Запрещено удалять системные роли организации (Владелец и др.)';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_role_deletion ON public.company_roles;
CREATE TRIGGER trg_prevent_system_role_deletion
    BEFORE DELETE ON public.company_roles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_system_role_deletion();

-- 2. Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
