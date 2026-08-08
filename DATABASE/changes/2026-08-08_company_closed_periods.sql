-- ==============================================================================
-- МИГРАЦИЯ: Таблица Закрытых Отчетных Периодов (Журнал Закрытия Месяцев)
-- Дата: 2026-08-08
-- Описание: Реестр фиксации закрытых месяцев для блокировки первички и R2 сканов
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.company_closed_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    year INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    status VARCHAR(20) NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMPTZ DEFAULT NOW(),
    closed_by UUID REFERENCES auth.users(id),
    opened_at TIMESTAMPTZ,
    opened_by UUID REFERENCES auth.users(id),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_company_year_month UNIQUE(company_id, year, month)
);

-- Индексы для оперативного контроля дат при проведении первички
CREATE INDEX IF NOT EXISTS idx_closed_periods_lookup 
ON public.company_closed_periods(company_id, year, month, status);

-- RLS Политики безопасности
ALTER TABLE public.company_closed_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Пользователи могут просматривать закрытые периоды своей компании"
ON public.company_closed_periods FOR SELECT
USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Руководители могут управлять закрытием периодов компании"
ON public.company_closed_periods FOR ALL
USING (company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid() AND role = 'owner'));
