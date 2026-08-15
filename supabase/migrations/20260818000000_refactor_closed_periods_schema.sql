-- ==============================================================================
-- МИГРАЦИЯ: Рефакторинг архитектуры Закрытых Периодов (Модули, Год+Месяц, Триггеры)
-- ==============================================================================

-- 1. Добавление гранулярных флагов блокировок по модулям в company_closed_periods
ALTER TABLE public.company_closed_periods
ADD COLUMN IF NOT EXISTS lock_documents BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS lock_files BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS reason TEXT;

-- Синхронизируем исторические данные
UPDATE public.company_closed_periods
SET lock_documents = (status = 'closed'),
    lock_files = (status = 'closed'),
    reason = COALESCE(reason, comment)
WHERE lock_documents IS NULL OR lock_files IS NULL;

-- Добавляем проверку диапазона года и месяца, если ее нет
ALTER TABLE public.company_closed_periods
DROP CONSTRAINT IF EXISTS check_year_range,
ADD CONSTRAINT check_year_range CHECK (year BETWEEN 2000 AND 2100);

ALTER TABLE public.company_closed_periods
DROP CONSTRAINT IF EXISTS check_month_range,
ADD CONSTRAINT check_month_range CHECK (month BETWEEN 1 AND 12);

-- 2. Обновление функции проверки финансового замка периода с гранулярностью по модулям
CREATE OR REPLACE FUNCTION public.check_closed_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_role TEXT;
    v_is_super BOOLEAN;
    v_company_id UUID;
    v_target_date DATE;
    v_year INT;
    v_month INT;
    v_is_doc_locked BOOLEAN := FALSE;
    v_is_file_locked BOOLEAN := FALSE;
    v_closed_until DATE;
BEGIN
    -- Получаем роль и статус суперадмина текущего пользователя
    SELECT role, COALESCE(is_super_admin, FALSE)
    INTO v_user_role, v_is_super
    FROM public.users
    WHERE id = (SELECT auth.uid());

    -- Владельцы (owner) и Суперадмины имеют право на мутации в закрытых периодах
    IF v_user_role = 'owner' OR v_is_super = TRUE THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    -- Вычисляем ID компании и целевую дату записи
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

    -- Проверка модуля ДОКУМЕНТООБОРОТА (documents)
    IF TG_TABLE_NAME = 'documents' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_closed_periods
            WHERE company_id = v_company_id
              AND year = v_year
              AND month = v_month
              AND lock_documents = TRUE
        ) INTO v_is_doc_locked;

        IF v_is_doc_locked THEN
            RAISE EXCEPTION 'Период документооборота (%-%) закрыт для внесения изменений.', v_year, v_month;
        END IF;
    END IF;

    -- Проверка модуля РЕЕСТРА ФАЙЛОВ (files)
    IF TG_TABLE_NAME = 'files' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.company_closed_periods
            WHERE company_id = v_company_id
              AND year = v_year
              AND month = v_month
              AND lock_files = TRUE
        ) INTO v_is_file_locked;

        IF v_is_file_locked THEN
            RAISE EXCEPTION 'Период загрузки файлов (%-%) закрыт для изменений.', v_year, v_month;
        END IF;
    END IF;

    -- Порог закрытия в профиле организации (companies.closed_period_until)
    SELECT closed_period_until INTO v_closed_until
    FROM public.companies
    WHERE id = v_company_id;

    IF v_closed_until IS NOT NULL AND v_target_date <= v_closed_until THEN
        RAISE EXCEPTION 'Дата записи (%) входит в общий закрытый период компании до %. Операция запрещена.', v_target_date, v_closed_until;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
