-- Инкрементальная миграция: Добавление должности и статуса заявок в профиль сотрудника
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS position VARCHAR(100) DEFAULT 'Сотрудник';
