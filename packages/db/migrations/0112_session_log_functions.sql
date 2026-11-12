-- Журнал сеансов входа (ТЗ «Админка» → «Карточка пользователя», вкладка «Сеансы»; прототип v83,
-- demoDB.sessions): сеанс живёт в `sessions` и при выходе удаляется, поэтому журнал `session_log` ведёт
-- триггер — строка появляется вместе с сеансом, повторяет его продление и закрывается при удалении.
-- Так журнал не зависит от того, кто удалил сеанс: выход, смена и сброс пароля, блокировка,
-- «Завершить все сеансы». Роль приложения журнал не видит и не меняет; читает его только
-- администратор платформы через представление app.admin_sessions.
REVOKE ALL ON TABLE public.session_log FROM buhuchet_app;
--> statement-breakpoint
-- Устройство («браузер и система», без адреса IP) и причина закрытия приходят настройками транзакции
-- app.session_device и app.session_end: это подписи для карточки, на доступ они не влияют. Причина —
-- только из известного списка, иначе «closed»; сеанс, удалённый после срока, — «expired» с его сроком.
CREATE FUNCTION app.session_log_sync() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_reason text;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.session_log (id, user_id, org_id, started_at, last_seen_at, expires_at, device)
        VALUES (NEW.id, NEW.user_id, NEW.org_id, NEW.created_at, NEW.last_seen_at, NEW.expires_at,
                nullif(left(current_setting('app.session_device', true), 80), ''))
        ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.session_log
        SET last_seen_at = NEW.last_seen_at, expires_at = NEW.expires_at
        WHERE id = NEW.id AND ended_at IS NULL;
      RETURN NEW;
    END IF;
    v_reason := current_setting('app.session_end', true);
    UPDATE public.session_log
      SET ended_at = least(now(), OLD.expires_at),
          last_seen_at = OLD.last_seen_at,
          expires_at = OLD.expires_at,
          end_reason = CASE
            WHEN OLD.expires_at <= now() THEN 'expired'
            WHEN v_reason IN ('logout', 'admin', 'blocked', 'password', 'reset') THEN v_reason
            ELSE 'closed'
          END
      WHERE id = OLD.id AND ended_at IS NULL;
    RETURN OLD;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.session_log_sync() FROM PUBLIC;
--> statement-breakpoint
-- Право по умолчанию схемы app: функция триггера роли приложения не нужна.
REVOKE ALL ON FUNCTION app.session_log_sync() FROM buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER sessions_log_sync
  AFTER INSERT OR DELETE OR UPDATE OF last_seen_at, expires_at ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION app.session_log_sync();
--> statement-breakpoint
-- Сеансы, открытые до этой миграции: в журнал без устройства.
INSERT INTO public.session_log (id, user_id, org_id, started_at, last_seen_at, expires_at)
  SELECT s.id, s.user_id, s.org_id, s.created_at, s.last_seen_at, s.expires_at FROM public.sessions s
  ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- Вход с устройством: прежний вызов с тремя параметрами остаётся (миграции идут до выкладки, старая
-- версия сайта зовёт его) — такие сеансы попадают в журнал без устройства.
CREATE FUNCTION app.auth_start_session(
    p_user uuid, p_token_hash text, p_ttl_days integer, p_device text)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_session uuid;
  BEGIN
    PERFORM set_config('app.session_device', coalesce(left(p_device, 80), ''), true);
    v_session := app.auth_start_session(p_user, p_token_hash, p_ttl_days);
    PERFORM set_config('app.session_device', '', true);
    RETURN v_session;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.auth_start_session(uuid, text, integer, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.auth_start_session(uuid, text, integer, text) TO buhuchet_app;
--> statement-breakpoint
-- Сеанс удаляется; в журнале — «Выход», если вызвавший не назвал другую причину в app.session_end
-- (сеанс заблокированного пользователя, повторный вход в том же браузере).
CREATE OR REPLACE FUNCTION app.auth_end_session(p_token_hash text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_logout boolean := coalesce(current_setting('app.session_end', true), '') = '';
  BEGIN
    IF v_logout THEN
      PERFORM set_config('app.session_end', 'logout', true);
    END IF;
    DELETE FROM public.sessions WHERE token_hash = p_token_hash;
    IF v_logout THEN
      PERFORM set_config('app.session_end', '', true);
    END IF;
  END
  $$;
--> statement-breakpoint
-- Сеансы пользователя для карточки в Админке: строки отдаются, только если в контексте (app.user_id)
-- незаблокированный администратор платформы (как app.admin_users, миграция 0033). Токена сеанса в
-- журнале нет.
CREATE VIEW app.admin_sessions WITH (security_barrier = true) AS
  SELECT l.id, l.user_id, l.started_at, l.last_seen_at, l.expires_at, l.device, l.ended_at, l.end_reason
  FROM public.session_log l
  WHERE app.is_platform_admin();
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_sessions FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_sessions TO buhuchet_app;
