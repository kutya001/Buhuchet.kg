-- ==============================================================================
-- МИГРАЦИЯ 20260821000000: Реестр логов Telegram-оповещений и индексы суперадмина
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recipient_chat_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Составные индексы для быстрого поиска и пагинации
CREATE INDEX IF NOT EXISTS idx_telegram_logs_event_created
  ON public.telegram_notification_logs (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_logs_recipient
  ON public.telegram_notification_logs (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_logs_chat_created
  ON public.telegram_notification_logs (recipient_chat_id, created_at DESC);

-- Включение RLS
ALTER TABLE public.telegram_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins have full access to telegram logs" ON public.telegram_notification_logs;
CREATE POLICY "Superadmins have full access to telegram logs"
  ON public.telegram_notification_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid()) AND is_super_admin = true
    )
  );

-- Перезагрузка схемы PostgREST
NOTIFY pgrst, 'reload schema';
