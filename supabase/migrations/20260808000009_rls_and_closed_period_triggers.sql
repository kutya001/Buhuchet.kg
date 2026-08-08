-- =============================================================================
-- МИГРАЦИЯ 20260808000009: RLS ПОЛИТИКИ И ТРИГГЕРЫ ПРОВЕРКИ ЗАКРЫТЫХ ПЕРИОДОВ
-- =============================================================================

-- 1. Функция PostgreSQL для проверки блокировки закрытого периода
CREATE OR REPLACE FUNCTION public.check_closed_period_lock()
RETURNS TRIGGER AS $$
DECLARE
    v_user_role TEXT;
    v_is_super BOOLEAN;
    v_company_id UUID;
    v_target_date DATE;
    v_year INT;
    v_month INT;
    v_is_closed BOOLEAN := FALSE;
    v_closed_until DATE;
BEGIN
    -- Получаем роль и флаг суперадмина текущего авторизованного пользователя
    SELECT role, COALESCE(is_super_admin, FALSE)
    INTO v_user_role, v_is_super
    FROM public.users
    WHERE id = auth.uid();

    -- Владельцы (owner) и Суперадмины имеют доступ к изменениям в закрытых периодах
    IF v_user_role = 'owner' OR v_is_super = TRUE THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Определяем ID компании и целевую дату записи
    IF TG_OP = 'DELETE' THEN
        v_company_id := OLD.company_id;
        IF TG_TABLE_NAME = 'documents' THEN
            v_target_date := COALESCE(OLD.doc_date, OLD.created_at::DATE);
        ELSE
            v_target_date := OLD.created_at::DATE;
        END IF;
    ELSE
        v_company_id := NEW.company_id;
        IF TG_TABLE_NAME = 'documents' THEN
            v_target_date := COALESCE(NEW.doc_date, NEW.created_at::DATE);
        ELSE
            v_target_date := NEW.created_at::DATE;
        END IF;
    END IF;

    IF v_company_id IS NULL OR v_target_date IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    v_year := EXTRACT(YEAR FROM v_target_date);
    v_month := EXTRACT(MONTH FROM v_target_date);

    -- Проверка 1: Журнал помесячного закрытия (company_closed_periods)
    SELECT EXISTS (
        SELECT 1 FROM public.company_closed_periods
        WHERE company_id = v_company_id
          AND year = v_year
          AND month = v_month
          AND status = 'closed'
    ) INTO v_is_closed;

    IF v_is_closed THEN
        RAISE EXCEPTION 'Отчетный период за %-% закрыт. Операция заблокирована на уровне базы данных.', v_year, v_month;
    END IF;

    -- Проверка 2: Глобальный лимит закрытия периода в компании (closed_period_until)
    SELECT closed_period_until INTO v_closed_until
    FROM public.companies
    WHERE id = v_company_id;

    IF v_closed_until IS NOT NULL AND v_target_date <= v_closed_until THEN
        RAISE EXCEPTION 'Дата документа (%) входит в закрытый период до %. Операция запрещена.', v_target_date, v_closed_until;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Привязка триггера закрытых периодов к таблице documents
DROP TRIGGER IF EXISTS trg_check_closed_period_documents ON public.documents;
CREATE TRIGGER trg_check_closed_period_documents
BEFORE INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.check_closed_period_lock();

-- 3. Привязка триггера закрытых периодов к таблице files
DROP TRIGGER IF EXISTS trg_check_closed_period_files ON public.files;
CREATE TRIGGER trg_check_closed_period_files
BEFORE INSERT OR UPDATE OR DELETE ON public.files
FOR EACH ROW EXECUTE FUNCTION public.check_closed_period_lock();

-- 4. Включение и актуализация RLS Политик
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_partnerships ENABLE ROW LEVEL SECURITY;

-- Политики для documents
DROP POLICY IF EXISTS "Доступ к документам своей компании" ON public.documents;
CREATE POLICY "Доступ к документам своей компании" ON public.documents
FOR ALL USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
    OR sender_company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
    OR receiver_company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
);

-- Политики для files
DROP POLICY IF EXISTS "Доступ к файлам своей компании" ON public.files;
CREATE POLICY "Доступ к файлам своей компании" ON public.files
FOR ALL USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
);

-- Политики для company_partnerships
DROP POLICY IF EXISTS "Доступ к партнерствам своей компании" ON public.company_partnerships;
CREATE POLICY "Доступ к партнерствам своей компании" ON public.company_partnerships
FOR ALL USING (
    requester_company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
    OR target_company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
);
