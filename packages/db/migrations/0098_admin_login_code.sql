-- ОТКЛОНЕНИЕ: docs/deviations.md#О-13
-- Код из Telegram при входе администратора платформы (ревью безопасности 06.11.2026, п. Р-2, решение
-- заказчика 07.11.2026 «А»): после верного пароля бот присылает 6 цифр, сеанс начинается только после
-- верного кода. Код действует p_ttl_minutes минут и p_max_attempts вводов, новый вход отменяет прежний
-- код; кодов не больше p_max_codes за p_window_minutes и не больше p_max_daily без входа за сутки.
-- Код привязан к паролю, после которого выдан (password_tag — md5 хеша пароля): сменили пароль — код
-- не действует и в пределы больше не считается. Таблицу роль приложения не видит и не меняет —
-- только функции ниже (как login_attempts и rate_limits).
CREATE TABLE "admin_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"password_tag" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"signed_in_at" timestamp with time zone,
	CONSTRAINT "admin_login_codes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "admin_login_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_login_codes" ADD CONSTRAINT "admin_login_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_login_codes_user_idx" ON "admin_login_codes" USING btree ("user_id","created_at");

--> statement-breakpoint
-- Новый код для администратора платформы: прежние коды отменяются, строки старше суток удаляются.
-- outcome — ok (expires_at — до когда действует), denied (не администратор или заблокирован), limited
-- (кодов за окно уже p_max_codes) или limited_day (за сутки уже p_max_daily кодов без входа). В
-- пределы считаются только коды после нынешнего пароля.
CREATE FUNCTION app.admin_code_issue(
    p_user uuid, p_token_hash text, p_code_hash text, p_ttl_minutes integer,
    p_max_codes integer, p_window_minutes integer, p_max_daily integer)
  RETURNS TABLE (outcome text, expires_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_tag text;
    v_until timestamptz;
  BEGIN
    SELECT md5(u.password_hash) INTO v_tag FROM public.users u
      WHERE u.id = p_user AND u.is_platform_admin AND NOT u.blocked
      FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'denied'::text, NULL::timestamptz;
      RETURN;
    END IF;
    DELETE FROM public.admin_login_codes c
      WHERE c.user_id = p_user AND c.created_at < clock_timestamp() - interval '1 day';
    IF (SELECT count(*) FROM public.admin_login_codes c
        WHERE c.user_id = p_user AND c.password_tag = v_tag AND c.signed_in_at IS NULL
       ) >= p_max_daily THEN
      RETURN QUERY SELECT 'limited_day'::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF (SELECT count(*) FROM public.admin_login_codes c
        WHERE c.user_id = p_user AND c.password_tag = v_tag
          AND c.created_at > clock_timestamp() - make_interval(mins => p_window_minutes)
       ) >= p_max_codes THEN
      RETURN QUERY SELECT 'limited'::text, NULL::timestamptz;
      RETURN;
    END IF;
    UPDATE public.admin_login_codes c SET used_at = clock_timestamp()
      WHERE c.user_id = p_user AND c.used_at IS NULL;
    v_until := clock_timestamp() + make_interval(mins => p_ttl_minutes);
    INSERT INTO public.admin_login_codes
        (user_id, token_hash, code_hash, password_tag, created_at, expires_at)
      VALUES (p_user, p_token_hash, p_code_hash, v_tag, clock_timestamp(), v_until);
    RETURN QUERY SELECT 'ok'::text, v_until;
  END
  $$;
--> statement-breakpoint
-- Ввод кода: попытка засчитывается до проверки (одновременные вводы не проверят больше p_max_attempts
-- кодов). Пусто — токена нет, код истёк, уже использован, отменён, вводов больше нет, пароль сменили
-- после кода, или учётная запись больше не администратор либо заблокирована.
CREATE FUNCTION app.admin_code_attempt(p_token_hash text, p_max_attempts integer)
  RETURNS TABLE (code_id uuid, user_id uuid, login text, code_hash text)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH taken AS (
      UPDATE public.admin_login_codes c SET attempts = c.attempts + 1
      WHERE c.token_hash = p_token_hash AND c.used_at IS NULL
        AND c.expires_at > clock_timestamp() AND c.attempts < p_max_attempts
      RETURNING c.id, c.user_id, c.code_hash, c.password_tag
    )
    SELECT taken.id, taken.user_id, u.login::text, taken.code_hash
    FROM taken JOIN public.users u ON u.id = taken.user_id
    WHERE u.is_platform_admin AND NOT u.blocked AND md5(u.password_hash) = taken.password_tag
  $$;
--> statement-breakpoint
-- Код подошёл: больше не действует, вход засчитан (в суточный предел такой код не считается). false —
-- его уже использовали (второй одновременный ввод), он истёк или пароль сменили после него.
CREATE FUNCTION app.admin_code_use(p_code_id uuid)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH used AS (
      UPDATE public.admin_login_codes c
        SET used_at = clock_timestamp(), signed_in_at = clock_timestamp()
      FROM public.users u
      WHERE c.id = p_code_id AND c.used_at IS NULL AND c.expires_at > clock_timestamp()
        AND u.id = c.user_id AND md5(u.password_hash) = c.password_tag
      RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM used)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_code_issue(uuid, text, text, integer, integer, integer, integer)
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_code_attempt(text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_code_use(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_code_issue(uuid, text, text, integer, integer, integer, integer),
  app.admin_code_attempt(text, integer), app.admin_code_use(uuid) TO buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON TABLE public.admin_login_codes FROM buhuchet_app;
