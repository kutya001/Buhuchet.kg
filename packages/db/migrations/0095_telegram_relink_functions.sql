-- Замена Telegram подтверждается кодом из прежнего чата (решение заказчика 07.11.2026, Р-13 Б;
-- docs/deviations.md п. О-20) и общий предел неверных кодов страницы контрагента (Р-5 А,
-- docs/deviations.md п. О-21). Шаги Telegram, как в миграции 0011, — узкие функции от владельца схемы
-- (SECURITY DEFINER): вебхук бота работает без входа, а у администратора платформы нет организации.

-- Таблицы подтверждения роль приложения меняет только функциями ниже; читать под RLS можно.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.telegram_link_guards,
  public.telegram_relink_codes FROM buhuchet_app;
--> statement-breakpoint
-- «Сменить код» и повторное включение снимают отметку «страница закрыта» (контекст организации, RLS).
GRANT UPDATE (closed_at) ON TABLE public.contractor_pages TO buhuchet_app;
--> statement-breakpoint
-- Чем подтверждается новая привязка пользователя: привязанный сейчас чат, а если Telegram отвязан —
-- отвязанный последним; free — разрешена ли сейчас привязка без кода (после сброса пароля владельцем
-- или администратором). Только для функций ниже.
CREATE FUNCTION app.telegram_confirm_chat(p_user uuid)
  RETURNS TABLE (chat_id bigint, free boolean)
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT coalesce(l.chat_id, g.chat_id), coalesce(g.free_until > now(), false)
    FROM (SELECT p_user AS id) u
    LEFT JOIN public.telegram_links l ON l.user_id = u.id
    LEFT JOIN public.telegram_link_guards g ON g.user_id = u.id
  $$;
--> statement-breakpoint
-- Неверные вводы кода замены Telegram пользователя за сутки: все занятые попытки, кроме удачных.
CREATE FUNCTION app.telegram_relink_failures(p_user uuid)
  RETURNS integer
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT (coalesce(sum(c.attempts), 0) - count(c.used_at))::integer
    FROM public.telegram_relink_codes c
    WHERE c.user_id = p_user AND c.created_at > now() - interval '1 day'
  $$;
--> statement-breakpoint
-- Привязать чат пользователю (общий шаг привязки по ссылке и по коду). Строка пользователя
-- блокируется: одновременные привязка, отвязка и подтверждение идут по очереди. Прежняя привязка
-- заменяется, отметка «прежний чат» и разрешение без кода снимаются, ожидающие коды замены
-- отменяются, а если сменился чат — и ожидающий код «Забыли пароль?». Возвращает прежнюю привязку
-- (для истории и сообщения о замене), привязан ли прежний и новый чат к другим логинам и отвязанный
-- последним чат, если сейчас ничего не было привязано (ему тоже пишется о замене).
CREATE FUNCTION app.telegram_link_set(
    p_user uuid, p_org uuid, p_chat_id bigint, p_username text, p_first_name text)
  RETURNS TABLE (
    prev_username text,
    prev_first_name text,
    prev_chat_id bigint,
    prev_shared boolean,
    shared boolean,
    guard_chat_id bigint,
    guard_shared boolean
  )
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_prev public.telegram_links%ROWTYPE;
    v_guard bigint;
  BEGIN
    PERFORM 1 FROM public.users u WHERE u.id = p_user FOR NO KEY UPDATE;
    SELECT * INTO v_prev FROM public.telegram_links l WHERE l.user_id = p_user;
    SELECT g.chat_id INTO v_guard FROM public.telegram_link_guards g WHERE g.user_id = p_user;
    INSERT INTO public.telegram_links (user_id, org_id, chat_id, username, first_name)
      VALUES (p_user, p_org, p_chat_id, p_username, p_first_name)
      ON CONFLICT (user_id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, username = EXCLUDED.username,
            first_name = EXCLUDED.first_name, linked_at = now();
    DELETE FROM public.telegram_link_guards g WHERE g.user_id = p_user;
    UPDATE public.telegram_relink_codes c SET expires_at = now()
      WHERE c.user_id = p_user AND c.used_at IS NULL AND c.expires_at > now();
    IF v_prev.chat_id IS DISTINCT FROM p_chat_id THEN
      PERFORM app.auth_reset_revoke(p_user);
    END IF;
    IF v_prev.chat_id IS NOT NULL OR v_guard = p_chat_id THEN
      v_guard := NULL;
    END IF;
    RETURN QUERY SELECT v_prev.username, v_prev.first_name, v_prev.chat_id,
      v_prev.chat_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.telegram_links o
                                             WHERE o.chat_id = v_prev.chat_id),
      EXISTS (SELECT 1 FROM public.telegram_links o
              WHERE o.chat_id = p_chat_id AND o.user_id <> p_user),
      v_guard,
      v_guard IS NOT NULL AND EXISTS (SELECT 1 FROM public.telegram_links o
                                      WHERE o.chat_id = v_guard);
  END
  $$;
--> statement-breakpoint
-- Чья ссылка пришла в бот (как в 0011) и чем подтверждать привязку: confirm_chat_id — прежний чат
-- (привязанный или отвязанный последним), relink_free — можно ли без кода, relink_chat_id — в какой
-- чат по этой ссылке уже запрошен код (повтор того же сообщения от Telegram). Ничего не меняет.
DROP FUNCTION app.telegram_link_peek(text);
--> statement-breakpoint
CREATE FUNCTION app.telegram_link_peek(p_token_hash text)
  RETURNS TABLE (
    user_id uuid,
    org_id uuid,
    login text,
    org_name text,
    used boolean,
    expired boolean,
    linked_chat_id bigint,
    is_platform_admin boolean,
    user_blocked boolean,
    employee_active boolean,
    org_status text,
    confirm_chat_id bigint,
    relink_free boolean,
    relink_chat_id bigint
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.user_id, t.org_id, u.login::text, o.name, t.used_at IS NOT NULL, t.expires_at <= now(),
           l.chat_id, u.is_platform_admin, u.blocked, e.active, o.status,
           coalesce(l.chat_id, g.chat_id), coalesce(g.free_until > now(), false),
           (SELECT r.chat_id FROM public.telegram_relink_codes r
             WHERE r.token_hash = t.token_hash AND r.user_id = t.user_id
             ORDER BY r.created_at DESC LIMIT 1)
    FROM public.telegram_link_tokens t
    JOIN public.users u ON u.id = t.user_id
    LEFT JOIN public.employees e ON e.user_id = u.id
    LEFT JOIN public.organizations o ON o.id = t.org_id
    LEFT JOIN public.telegram_links l ON l.user_id = t.user_id
    LEFT JOIN public.telegram_link_guards g ON g.user_id = t.user_id
    WHERE t.token_hash = p_token_hash
  $$;
--> statement-breakpoint
-- Привязать чат по ссылке — только пользователю из контекста и только неиспользованной, не истёкшей
-- ссылкой (строка ссылки блокируется: одновременный повтор привяжет один раз). Другой чат вместо
-- прежнего (привязанного или отвязанного последним) так не привязывается — только кодом из прежнего
-- (app.telegram_relink_*), если привязка без кода сейчас не разрешена. Пусто — ссылка не действует
-- или нужен код.
DROP FUNCTION app.telegram_link_use(text, bigint, text, text);
--> statement-breakpoint
CREATE FUNCTION app.telegram_link_use(
    p_token_hash text, p_chat_id bigint, p_username text, p_first_name text)
  RETURNS TABLE (
    prev_username text,
    prev_first_name text,
    prev_chat_id bigint,
    prev_shared boolean,
    shared boolean,
    guard_chat_id bigint,
    guard_shared boolean
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_confirm record;
  BEGIN
    SELECT t.org_id INTO v_org FROM public.telegram_link_tokens t
      WHERE t.token_hash = p_token_hash AND t.user_id = v_user
        AND t.used_at IS NULL AND t.expires_at > now()
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_user FOR NO KEY UPDATE;
    SELECT * INTO v_confirm FROM app.telegram_confirm_chat(v_user);
    IF v_confirm.chat_id IS NOT NULL AND v_confirm.chat_id <> p_chat_id AND NOT v_confirm.free THEN
      RETURN;
    END IF;
    UPDATE public.telegram_link_tokens SET used_at = now() WHERE token_hash = p_token_hash;
    RETURN QUERY SELECT * FROM app.telegram_link_set(v_user, v_org, p_chat_id, p_username,
      p_first_name);
  END
  $$;
--> statement-breakpoint
-- Ссылку открыли в другом чате, а замена без кода не разрешена: ссылка использована (и при отказе по
-- пределам), код записан
-- (прежние ожидающие коды пользователя отменяются, коды старше суток удаляются), API отправит его в
-- прежний чат. Строка ссылки и строка пользователя блокируются, поэтому одновременные запросы не
-- превысят пределы. status: sent — код записан (chat_id и shared — куда отправить и привязан ли этот
-- чат к другим логинам); invalid — ссылка не действует; not_needed — код уже не нужен (привязать
-- обычной ссылкой); locked — за сутки p_max_failures неверных вводов; limited — за час уже
-- p_max_per_hour кодов.
CREATE FUNCTION app.telegram_relink_request(
    p_token_hash text, p_chat_id bigint, p_username text, p_first_name text, p_code_hash text,
    p_ttl_minutes integer, p_max_per_hour integer, p_max_failures integer)
  RETURNS TABLE (status text, expires_at timestamptz, chat_id bigint, shared boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_org uuid;
    v_confirm record;
    v_until timestamptz := now() + make_interval(mins => p_ttl_minutes);
  BEGIN
    SELECT t.org_id INTO v_org FROM public.telegram_link_tokens t
      WHERE t.token_hash = p_token_hash AND t.user_id = v_user
        AND t.used_at IS NULL AND t.expires_at > now()
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::timestamptz, NULL::bigint, false;
      RETURN;
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_user FOR NO KEY UPDATE;
    SELECT * INTO v_confirm FROM app.telegram_confirm_chat(v_user);
    IF v_confirm.chat_id IS NULL OR v_confirm.chat_id = p_chat_id OR v_confirm.free THEN
      RETURN QUERY SELECT 'not_needed'::text, NULL::timestamptz, NULL::bigint, false;
      RETURN;
    END IF;
    -- Дальше ссылка использована при любом ответе: повтор «/start» с ней не заставит снова считать
    -- хеш кода.
    UPDATE public.telegram_link_tokens SET used_at = now() WHERE token_hash = p_token_hash;
    IF app.telegram_relink_failures(v_user) >= p_max_failures THEN
      RETURN QUERY SELECT 'locked'::text, NULL::timestamptz, NULL::bigint, false;
      RETURN;
    END IF;
    IF (SELECT count(*) FROM public.telegram_relink_codes c
        WHERE c.user_id = v_user AND c.created_at > now() - interval '1 hour') >= p_max_per_hour THEN
      RETURN QUERY SELECT 'limited'::text, NULL::timestamptz, NULL::bigint, false;
      RETURN;
    END IF;
    UPDATE public.telegram_relink_codes c SET expires_at = now()
      WHERE c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > now();
    DELETE FROM public.telegram_relink_codes c
      WHERE c.user_id = v_user AND c.created_at < now() - interval '1 day';
    INSERT INTO public.telegram_relink_codes (user_id, org_id, token_hash, chat_id, username,
        first_name, code_hash, expires_at)
      VALUES (v_user, v_org, p_token_hash, p_chat_id, p_username, p_first_name, p_code_hash,
        v_until);
    RETURN QUERY SELECT 'sent'::text, v_until, v_confirm.chat_id,
      EXISTS (SELECT 1 FROM public.telegram_links o
              WHERE o.chat_id = v_confirm.chat_id AND o.user_id <> v_user);
  END
  $$;
--> statement-breakpoint
-- Код пришёл в новый чат (без входа, вебхук бота): последний неиспользованный код этого чата за сутки.
-- Попытка занимается до проверки кода (API сверяет хеш): +1, пока их меньше p_max_attempts и у
-- пользователя за сутки меньше p_max_failures неверных вводов; строка пользователя блокируется,
-- поэтому одновременные сообщения проверят не больше вариантов, чем позволяют пределы. status: none —
-- кода для этого чата нет (обычное сообщение); spent — код истёк или попытки кончились; ok — попытка
-- занята: хеш кода, сколько попыток останется после неё (меньший из остатков по коду и за сутки), имя в Telegram из сообщения со ссылкой и чья
-- учётная запись (для транзакции от её имени и проверки блокировки).
CREATE FUNCTION app.telegram_relink_attempt(
    p_chat_id bigint, p_max_attempts integer, p_max_failures integer)
  RETURNS TABLE (
    status text,
    code_id uuid,
    code_hash text,
    tries_left integer,
    username text,
    first_name text,
    user_id uuid,
    org_id uuid,
    login text,
    org_name text,
    is_platform_admin boolean,
    user_blocked boolean,
    employee_active boolean,
    org_status text
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_code record;
    v_attempts integer;
  BEGIN
    SELECT c.id, c.user_id INTO v_code FROM public.telegram_relink_codes c
      WHERE c.chat_id = p_chat_id AND c.used_at IS NULL AND c.created_at > now() - interval '1 day'
      ORDER BY c.created_at DESC
      LIMIT 1;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'none'::text, NULL::uuid, NULL::text, NULL::integer, NULL::text,
        NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::boolean, NULL::boolean,
        NULL::boolean, NULL::text;
      RETURN;
    END IF;
    PERFORM 1 FROM public.users u WHERE u.id = v_code.user_id FOR NO KEY UPDATE;
    IF app.telegram_relink_failures(v_code.user_id) < p_max_failures THEN
      UPDATE public.telegram_relink_codes c SET attempts = c.attempts + 1
        WHERE c.id = v_code.id AND c.used_at IS NULL AND c.expires_at > now()
          AND c.attempts < p_max_attempts
        RETURNING c.attempts INTO v_attempts;
    END IF;
    IF v_attempts IS NULL THEN
      RETURN QUERY SELECT 'spent'::text, NULL::uuid, NULL::text, NULL::integer, NULL::text,
        NULL::text, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::boolean, NULL::boolean,
        NULL::boolean, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY
      SELECT 'ok'::text, c.id, c.code_hash,
             least(p_max_attempts - v_attempts,
               p_max_failures - app.telegram_relink_failures(v_code.user_id)),
             c.username, c.first_name,
             u.id, u.org_id, u.login::text, o.name, u.is_platform_admin, u.blocked, e.active,
             o.status
      FROM public.telegram_relink_codes c
      JOIN public.users u ON u.id = c.user_id
      LEFT JOIN public.employees e ON e.user_id = u.id
      LEFT JOIN public.organizations o ON o.id = u.org_id
      WHERE c.id = v_code.id;
  END
  $$;
--> statement-breakpoint
-- Верный код: привязать чат из кода пользователю из контекста (код использован один раз, только свой
-- и не истёкший). Возвращает то же, что app.telegram_link_use; пусто — код уже не действует.
CREATE FUNCTION app.telegram_relink_use(p_code_id uuid)
  RETURNS TABLE (
    prev_username text,
    prev_first_name text,
    prev_chat_id bigint,
    prev_shared boolean,
    shared boolean,
    guard_chat_id bigint,
    guard_shared boolean
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid := app.current_user_id();
    v_code public.telegram_relink_codes%ROWTYPE;
  BEGIN
    PERFORM 1 FROM public.users u WHERE u.id = v_user FOR NO KEY UPDATE;
    UPDATE public.telegram_relink_codes c SET used_at = now()
      WHERE c.id = p_code_id AND c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > now()
      RETURNING c.* INTO v_code;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM app.telegram_link_set(v_user, v_code.org_id, v_code.chat_id,
      v_code.username, v_code.first_name);
  END
  $$;
--> statement-breakpoint
-- Отвязать Telegram пользователя из контекста (как в 0011): ожидающие коды «Забыли пароль?» и замены
-- отменяются, а отвязанный чат запоминается — следующий другой чат подтверждается кодом из него.
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
    INSERT INTO public.telegram_link_guards (user_id, org_id, chat_id)
      VALUES (v_user, v_removed.org_id, v_removed.chat_id)
      ON CONFLICT (user_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, updated_at = now();
    UPDATE public.telegram_relink_codes c SET expires_at = now()
      WHERE c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > now();
    PERFORM app.auth_reset_revoke(v_user);
    RETURN QUERY SELECT v_removed.chat_id, v_removed.username, v_removed.first_name,
      EXISTS (SELECT 1 FROM public.telegram_links o WHERE o.chat_id = v_removed.chat_id);
  END
  $$;
--> statement-breakpoint
-- Сброс пароля владельцем или администратором платформы (временный пароль уже задан): p_hours часов
-- Telegram привязывается без кода из прежнего чата — доступа к нему у пользователя может не быть.
-- Только учётной записи организации из контекста, только с временным паролем и только от имени
-- того, кто сбрасывает пароль: незаблокированного администратора платформы или владельца организации.
CREATE FUNCTION app.telegram_relink_allow(p_user uuid, p_hours integer)
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
    INSERT INTO public.telegram_link_guards (user_id, org_id, free_until)
      VALUES (p_user, v_org, now() + make_interval(hours => p_hours))
      ON CONFLICT (user_id) DO UPDATE SET free_until = EXCLUDED.free_until, updated_at = now();
  END
  $$;
--> statement-breakpoint
-- Журнал служебных сообщений (как в 0079): ещё и код замены Telegram — тоже без текста.
CREATE OR REPLACE FUNCTION app.telegram_log(
  p_user uuid, p_chat bigint, p_kind text, p_text text, p_ok boolean, p_error text
)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF p_kind NOT IN ('code', 'relink_code', 'linked', 'relinked', 'unlinked', 'pass_changed',
        'pass_reset') THEN
      RAISE EXCEPTION 'telegram_log: не служебное сообщение: %', p_kind;
    END IF;
    INSERT INTO public.telegram_outbox
      (org_id, user_id, chat_id, kind, text, status, tries, next_at, last_error, sent_at)
    SELECT u.org_id, u.id, p_chat, p_kind,
           CASE WHEN p_kind IN ('code', 'relink_code') THEN NULL ELSE p_text END,
           CASE WHEN p_ok THEN 'sent' ELSE 'error' END, 1, now(),
           CASE WHEN p_ok THEN NULL ELSE left(coalesce(p_error, ''), 300) END,
           CASE WHEN p_ok THEN now() END
    FROM public.users u
    WHERE u.id = p_user;
  END
  $$;
--> statement-breakpoint
-- «Повторить отправку» (как в 0084): код замены Telegram, как и код восстановления, повторно не
-- отправляется.
CREATE OR REPLACE FUNCTION app.admin_telegram_retry(p_ids uuid[], p_now timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH queued AS (
      UPDATE public.telegram_outbox
        SET status = 'pending', tries = 0, last_error = NULL, sent_at = NULL, next_at = p_now
        WHERE id = ANY (p_ids) AND status = 'error' AND kind NOT IN ('code', 'relink_code')
          AND (SELECT app.is_platform_admin())
        RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;
--> statement-breakpoint
-- Страница по ссылке (как в 0059): закрытая после неверных кодов за сутки — «closed» для всех, в том
-- числе для браузеров с запомненным кодом, до «Сменить код».
CREATE OR REPLACE FUNCTION app.contractor_page_state(p_slug text, p_inn text, p_token_hash text)
  RETURNS TABLE (state text, org_id uuid, contractor_id uuid, locked_until timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_page record;
  BEGIN
    SELECT p.org_id, p.contractor_id, p.code_version, p.locked_until, p.closed_at INTO v_page
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF v_page.closed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'closed'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF p_token_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.contractor_page_grants g
      WHERE g.token_hash = p_token_hash AND g.contractor_id = v_page.contractor_id
        AND g.code_version = v_page.code_version AND g.expires_at > now()
    ) THEN
      RETURN QUERY SELECT 'open'::text, v_page.org_id, v_page.contractor_id, NULL::timestamptz;
      RETURN;
    END IF;
    IF v_page.locked_until > now() THEN
      RETURN QUERY SELECT 'locked'::text, NULL::uuid, NULL::uuid, v_page.locked_until;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'code'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
  END
  $$;
--> statement-breakpoint
-- Ввод кода на странице без входа (как в 0066) и общий предел по ссылке: каждый неверный код
-- записывается по ссылке и номеру кода (rate_limits, вид «cp_page_fail»); p_day_max-й неверный за
-- p_day_window_hours часов с любых адресов закрывает страницу до «Сменить код» (closed_at, запись
-- «страница закрыта» в истории контрагента — в той же транзакции): «closed» с just_closed, номером
-- организации и контрагента — API сообщит ответственному. Закрытая страница — «closed» сразу, счёт не
-- ведётся. «Осталось попыток» — меньший из трёх остатков: по ссылке подряд, по адресу и по ссылке за
-- сутки.
DROP FUNCTION app.contractor_page_try_code(text, text, text, text, text, integer, integer, integer,
  integer, integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION app.contractor_page_try_code(
    p_slug text, p_inn text, p_code text, p_ip_hash text, p_token_hash text, p_tries integer,
    p_lock_minutes integer, p_ip_max integer, p_ip_window_minutes integer, p_ip_lock_minutes integer,
    p_remember_days integer, p_max_grants integer, p_day_max integer, p_day_window_hours integer)
  RETURNS TABLE (
    outcome text,
    tries_left integer,
    locked_until timestamptz,
    org_id uuid,
    contractor_id uuid,
    just_closed boolean
  )
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_page record;
    v_ip_until timestamptz;
    v_failures integer;
    v_ip_failures integer;
    v_day_failures integer;
    v_subject text;
    v_until timestamptz;
    v_closed boolean;
  BEGIN
    SELECT p.org_id, p.contractor_id, p.code, p.code_version, p.failures, p.locked_until,
        p.closed_at INTO v_page
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled
      FOR UPDATE OF p;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::integer, NULL::timestamptz, NULL::uuid,
        NULL::uuid, false;
      RETURN;
    END IF;
    IF v_page.closed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'closed'::text, NULL::integer, NULL::timestamptz, NULL::uuid, NULL::uuid,
        false;
      RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('cp_page_ip:' || p_ip_hash, 0));
    SELECT max(r.busy_until) INTO v_ip_until FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip_lock' AND r.subject = p_ip_hash AND r.busy_until > now();
    IF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until, NULL::uuid, NULL::uuid,
        false;
      RETURN;
    END IF;
    IF v_page.locked_until > now() THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_page.locked_until, NULL::uuid,
        NULL::uuid, false;
      RETURN;
    END IF;
    IF p_code = v_page.code THEN
      UPDATE public.contractor_pages p
        SET failures = 0, locked_until = NULL
        WHERE p.contractor_id = v_page.contractor_id;
      INSERT INTO public.contractor_page_grants (token_hash, org_id, contractor_id, code_version,
          expires_at)
        VALUES (p_token_hash, v_page.org_id, v_page.contractor_id, v_page.code_version,
          now() + make_interval(days => p_remember_days));
      DELETE FROM public.contractor_page_grants g
        WHERE g.contractor_id = v_page.contractor_id
          AND g.token_hash IN (
            SELECT x.token_hash FROM public.contractor_page_grants x
              WHERE x.contractor_id = v_page.contractor_id
              ORDER BY x.created_at DESC, x.token_hash
              OFFSET p_max_grants
          );
      RETURN QUERY SELECT 'ok'::text, NULL::integer, NULL::timestamptz, NULL::uuid, NULL::uuid,
        false;
      RETURN;
    END IF;
    v_subject := v_page.contractor_id::text || ':' || v_page.code_version::text;
    INSERT INTO public.rate_limits (kind, subject) VALUES ('cp_page_fail', v_subject);
    SELECT count(*) INTO v_day_failures FROM public.rate_limits r
      WHERE r.kind = 'cp_page_fail' AND r.subject = v_subject
        AND r.at > now() - make_interval(hours => p_day_window_hours);
    v_closed := v_day_failures >= p_day_max;
    v_failures := v_page.failures + 1;
    v_until := CASE WHEN v_failures >= p_tries AND NOT v_closed
      THEN now() + make_interval(mins => p_lock_minutes) END;
    UPDATE public.contractor_pages p
      SET failures = CASE WHEN v_until IS NULL AND NOT v_closed THEN v_failures ELSE 0 END,
          locked_until = v_until,
          closed_at = CASE WHEN v_closed THEN now() END
      WHERE p.contractor_id = v_page.contractor_id;
    IF v_closed OR v_until IS NOT NULL THEN
      INSERT INTO public.audit_log (org_id, entity, entity_id, action, changes, contractor_id,
          actor_user_id)
        VALUES (v_page.org_id, 'contractor_page', v_page.contractor_id::text,
          CASE WHEN v_closed THEN 'page_close' ELSE 'page_lock' END, '[]'::jsonb,
          v_page.contractor_id, NULL);
    END IF;
    INSERT INTO public.rate_limits (kind, subject) VALUES ('cp_page_ip', p_ip_hash);
    SELECT count(*) INTO v_ip_failures FROM public.rate_limits r
      WHERE r.kind = 'cp_page_ip' AND r.subject = p_ip_hash
        AND r.at > now() - make_interval(mins => p_ip_window_minutes);
    IF v_ip_failures >= p_ip_max THEN
      v_ip_until := now() + make_interval(mins => p_ip_lock_minutes);
      INSERT INTO public.rate_limits (kind, subject, busy_until)
        VALUES ('cp_page_ip_lock', p_ip_hash, v_ip_until);
    END IF;
    IF v_closed THEN
      RETURN QUERY SELECT 'closed'::text, NULL::integer, NULL::timestamptz, v_page.org_id,
        v_page.contractor_id, true;
    ELSIF v_until IS NOT NULL THEN
      RETURN QUERY SELECT 'locked'::text, NULL::integer, v_until, NULL::uuid, NULL::uuid, false;
    ELSIF v_ip_until IS NOT NULL THEN
      RETURN QUERY SELECT 'ip_locked'::text, NULL::integer, v_ip_until, NULL::uuid, NULL::uuid,
        false;
    ELSE
      RETURN QUERY SELECT 'wrong'::text,
        least(p_tries - v_failures, p_ip_max - v_ip_failures, p_day_max - v_day_failures),
        NULL::timestamptz, NULL::uuid, NULL::uuid, false;
    END IF;
  END
  $$;
--> statement-breakpoint
-- Вспомогательные функции вызываются только из функций выше (от владельца схемы): права схемы app
-- по умолчанию (миграция 0000) дают EXECUTE и роли приложения — снимаем.
REVOKE ALL ON FUNCTION app.telegram_confirm_chat(uuid), app.telegram_relink_failures(uuid),
  app.telegram_link_set(uuid, uuid, bigint, text, text) FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.telegram_link_peek(text), app.telegram_link_use(text, bigint, text, text),
  app.telegram_relink_request(text, bigint, text, text, text, integer, integer, integer),
  app.telegram_relink_attempt(bigint, integer, integer), app.telegram_relink_use(uuid),
  app.telegram_relink_allow(uuid, integer),
  app.contractor_page_try_code(text, text, text, text, text, integer, integer, integer, integer,
    integer, integer, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.telegram_link_peek(text),
  app.telegram_link_use(text, bigint, text, text),
  app.telegram_relink_request(text, bigint, text, text, text, integer, integer, integer),
  app.telegram_relink_attempt(bigint, integer, integer), app.telegram_relink_use(uuid),
  app.telegram_relink_allow(uuid, integer),
  app.contractor_page_try_code(text, text, text, text, text, integer, integer, integer, integer,
    integer, integer, integer, integer, integer) TO buhuchet_app;
--> statement-breakpoint
-- Кто отвязал Telegram до этой миграции (рабочий сайт — с 06.11.2026): отвязанный чат — из журнала
-- отправок (последнее «Telegram отвязан»), если сейчас ничего не привязано.
INSERT INTO public.telegram_link_guards (user_id, org_id, chat_id)
  SELECT DISTINCT ON (o.user_id) o.user_id, u.org_id, o.chat_id
    FROM public.telegram_outbox o
    JOIN public.users u ON u.id = o.user_id
    WHERE o.kind = 'unlinked'
      AND NOT EXISTS (SELECT 1 FROM public.telegram_links l WHERE l.user_id = o.user_id)
    ORDER BY o.user_id, o.created_at DESC
  ON CONFLICT (user_id) DO NOTHING;
