-- ОТКЛОНЕНИЕ: docs/deviations.md#О-20
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
--> statement-breakpoint
-- Разрешение после сброса не должен снять тот, у кого был сеанс до сброса: ссылка привязки
-- (15 минут) и ожидающий код замены Telegram (10 минут), выданные до сброса, перестают действовать —
-- как и сеансы. Иначе захвативший открыл бы заранее созданную ссылку в своём (ещё привязанном) чате,
-- привязка сняла бы разрешение, и код «Забыли пароль?» снова ушёл бы ему. Срок — '-infinity', а не
-- now(): now() — начало транзакции сброса, и привязка, начатая раньше, но дошедшая до проверки срока
-- после сброса, сочла бы такую ссылку ещё действующей. Остальное как в 0102.
CREATE OR REPLACE FUNCTION app.telegram_relink_allow(p_user uuid, p_hours integer)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.users c
        WHERE c.id = app.current_user_id() AND NOT c.blocked
          AND (c.is_platform_admin OR EXISTS (
            SELECT 1 FROM public.employees e
              JOIN public.roles r ON r.id = e.role_id
              WHERE e.user_id = c.id AND e.org_id = app.current_org_id() AND e.active
                AND r.is_owner))
    ) THEN
      RAISE EXCEPTION 'telegram_relink_allow: разрешает только владелец или администратор платформы';
    END IF;
    SELECT u.org_id INTO v_org FROM public.users u
      WHERE u.id = p_user AND u.org_id = app.current_org_id() AND NOT u.is_platform_admin
        AND u.must_change_password;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'telegram_relink_allow: нет учётной записи с временным паролем в организации';
    END IF;
    UPDATE public.telegram_link_tokens t SET expires_at = '-infinity'
      WHERE t.user_id = p_user AND t.used_at IS NULL AND t.expires_at > now();
    UPDATE public.telegram_relink_codes c SET expires_at = '-infinity'
      WHERE c.user_id = p_user AND c.used_at IS NULL AND c.expires_at > now();
    INSERT INTO public.telegram_link_guards (user_id, org_id, free_until)
      VALUES (p_user, v_org, now() + make_interval(hours => p_hours))
      ON CONFLICT (user_id) DO UPDATE SET free_until = EXCLUDED.free_until, updated_at = now();
  END
  $$;
--> statement-breakpoint
-- Новая ссылка привязки (как в 0011), но не учётной записи организации с временным паролем: с ним API
-- пускает только к смене пароля, а запрос, чей сеанс проверен до сброса пароля, иначе создал бы ссылку
-- уже после сброса — и снял бы ею разрешение (см. выше). Строка пользователя блокируется (FOR SHARE):
-- сброс (FOR UPDATE) либо ждёт эту ссылку и отменяет её, либо фиксируется раньше, и тогда здесь виден
-- уже временный пароль. Администратору платформы с временным паролем ссылка нужна для входа в Админку.
CREATE OR REPLACE FUNCTION app.telegram_link_token(p_token_hash text, p_ttl_minutes integer)
  RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_temp boolean;
    v_until timestamptz := now() + make_interval(mins => p_ttl_minutes);
  BEGIN
    SELECT u.org_id, u.must_change_password AND NOT u.is_platform_admin INTO v_org, v_temp
      FROM public.users u WHERE u.id = v_user
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'telegram_link_token: нет пользователя в контексте';
    END IF;
    IF v_temp THEN
      RAISE EXCEPTION 'telegram_link_token: временный пароль — сначала его нужно сменить';
    END IF;
    DELETE FROM public.telegram_link_tokens
      WHERE user_id = v_user OR expires_at < now() - interval '1 day';
    INSERT INTO public.telegram_link_tokens (token_hash, user_id, org_id, expires_at)
      VALUES (p_token_hash, v_user, v_org, v_until);
    RETURN v_until;
  END
  $$;
