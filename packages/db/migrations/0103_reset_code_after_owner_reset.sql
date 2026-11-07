-- «Забыли пароль?» после сброса пароля владельцем (администратором платформы) — docs/deviations.md п. О-20.
-- Сброс разрешает сутки привязать другой Telegram без кода (`telegram_link_guards.free_until`): так
-- пароль сбрасывают тому, у кого привязку Telegram захватили. Пока разрешение действует, код
-- восстановления в ещё привязанный (возможно, чужой) чат не уходит — ответ как без привязки
-- (`no_telegram`, на странице входа текст тот же). Иначе захвативший получил бы код раньше, чем
-- пострадавший войдёт с временным паролем и привяжет свой Telegram. Новая привязка снимает разрешение
-- (`app.telegram_link_set`), и коды снова уходят — уже в новый чат. Остальное как в 0011.
CREATE OR REPLACE FUNCTION app.auth_reset_status(
    p_user uuid, p_max_per_hour integer, p_max_failures integer)
  RETURNS TABLE (status text, retry_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_last timestamptz;
    v_count integer;
    v_first timestamptz;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user) THEN
      RETURN QUERY SELECT 'no_user'::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.user_id = p_user)
      OR EXISTS (SELECT 1 FROM public.telegram_link_guards g
        WHERE g.user_id = p_user AND g.free_until > now()) THEN
      RETURN QUERY SELECT 'no_telegram'::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF app.auth_reset_failures(p_user) >= p_max_failures THEN
      -- Верхняя граница: через сутки после последнего кода все неверные вводы выйдут из окна.
      SELECT max(c.created_at) INTO v_last FROM public.password_reset_codes c
        WHERE c.user_id = p_user AND c.created_at > now() - interval '1 day';
      RETURN QUERY SELECT 'locked'::text, v_last + interval '1 day';
      RETURN;
    END IF;
    SELECT count(*), min(c.created_at) INTO v_count, v_first FROM public.password_reset_codes c
      WHERE c.user_id = p_user AND c.created_at > now() - interval '1 hour';
    IF v_count >= p_max_per_hour THEN
      RETURN QUERY SELECT 'limited'::text, v_first + interval '1 hour';
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::text, NULL::timestamptz;
  END
  $$;
