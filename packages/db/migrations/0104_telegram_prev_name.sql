ALTER TABLE "telegram_link_guards" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "telegram_link_guards" ADD COLUMN "first_name" text;--> statement-breakpoint
-- ОТКЛОНЕНИЕ: docs/deviations.md#О-20
-- Отвязать Telegram (как в 0102), и имя отвязанного чата запоминается: «Мой профиль» показывает
-- «Прежний Telegram @имя: другой чат бот привяжет только по коду, который пришлёт туда» (прототип v77).
CREATE OR REPLACE FUNCTION app.telegram_unlink()
  RETURNS TABLE (chat_id bigint, username text, first_name text, shared boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_removed public.telegram_links%ROWTYPE;
  BEGIN
    PERFORM 1 FROM public.users u WHERE u.id = v_user FOR NO KEY UPDATE;
    DELETE FROM public.telegram_links l WHERE l.user_id = v_user RETURNING l.* INTO v_removed;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    INSERT INTO public.telegram_link_guards (user_id, org_id, chat_id, username, first_name)
      VALUES (v_user, v_removed.org_id, v_removed.chat_id, v_removed.username, v_removed.first_name)
      ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username,
        first_name = EXCLUDED.first_name, updated_at = now();
    UPDATE public.telegram_relink_codes c SET expires_at = now()
      WHERE c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > now();
    PERFORM app.auth_reset_revoke(v_user);
    RETURN QUERY SELECT v_removed.chat_id, v_removed.username, v_removed.first_name,
      EXISTS (SELECT 1 FROM public.telegram_links o WHERE o.chat_id = v_removed.chat_id);
  END
  $$;
--> statement-breakpoint
-- Прежний Telegram пользователя для подсказки в «Мой профиль»: Telegram сейчас не привязан, а другой
-- чат подтверждается кодом из отвязанного (разрешения без кода после сброса пароля нет). Пусто — нет
-- такого; имя пустое — отвязан до миграции 0104. Ничего не меняет.
CREATE FUNCTION app.telegram_previous(p_user uuid)
  RETURNS TABLE (username text, first_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT g.username, g.first_name
    FROM public.telegram_link_guards g
    WHERE g.user_id = p_user AND g.chat_id IS NOT NULL
      AND NOT coalesce(g.free_until > now(), false)
      AND NOT EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.user_id = p_user)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_previous(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_previous(uuid) TO buhuchet_app;
