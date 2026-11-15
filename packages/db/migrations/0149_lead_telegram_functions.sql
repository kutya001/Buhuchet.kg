-- Доработки 14.11.2026, блок 1 (поток Т; прототип v113 modules/tg-lead.js): Telegram заявителя до
-- создания организации и пароль владельца по ссылке. Таблицы ссылок (0147) роль приложения не видит —
-- только эти функции. В базе — только SHA-256 ключей ссылок; сами ключи знает лишь браузер заявителя и
-- чат владельца.

-- «Подключить Telegram» после заявки: ссылка на бота на p_ttl_hours часов. Только в той же подаче, что
-- создала или повторила заявку (запись истории гостя в этот же момент p_now, как у app.lead_notify).
-- Действующая ссылка у заявки одна. Пока она действует, повтор с того же телефона другой ссылки не
-- получает (иначе посторонний, зная телефон, получил бы её и подключил свой Telegram раньше заявителя):
-- браузеру, который получил ссылку (p_prior — её ключ из cookie), — та же ссылка (same), остальным —
-- ничего. Ссылка истекла, а «Старта» не было — повтор получает новую (new), как в прототипе: «Отправьте
-- заявку ещё раз — придёт новая ссылка». Telegram подключён — «уже подключён» (linked) только браузеру с
-- ключом ссылки этой заявки, остальным — ничего.
CREATE FUNCTION app.lead_tg_issue(
  p_lead uuid, p_hash text, p_prior text, p_now timestamptz, p_ttl_hours integer
)
  RETURNS TABLE (outcome text, till timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_kind text;
    v_linked boolean;
    v_tok public.platform_lead_tg_tokens%ROWTYPE;
    v_till timestamptz;
  BEGIN
    SELECT e.kind INTO v_kind FROM public.platform_lead_events e
      WHERE e.lead_id = p_lead AND e.at = p_now AND e.kind IN ('created', 'repeat')
        AND e.actor_user_id IS NULL
      ORDER BY e.id DESC
      LIMIT 1;
    IF v_kind IS NULL THEN
      RETURN;
    END IF;
    SELECT l.tg_chat_id IS NOT NULL INTO v_linked FROM public.platform_leads l
      WHERE l.id = p_lead
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF v_linked THEN
      IF v_kind = 'repeat' AND p_prior IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.platform_lead_tg_tokens t
        WHERE t.token_hash = p_prior AND t.lead_id = p_lead
      ) THEN
        RETURN QUERY SELECT 'linked'::text, NULL::timestamptz;
      END IF;
      RETURN;
    END IF;
    SELECT * INTO v_tok FROM public.platform_lead_tg_tokens t
      WHERE t.lead_id = p_lead AND t.used_at IS NULL AND t.expires_at > p_now
      ORDER BY t.expires_at DESC
      LIMIT 1;
    IF FOUND THEN
      IF v_kind = 'repeat' AND v_tok.token_hash = p_prior THEN
        RETURN QUERY SELECT 'same'::text, v_tok.expires_at;
      END IF;
      RETURN;
    END IF;
    IF p_hash IS NULL THEN
      RETURN;
    END IF;
    v_till := p_now + make_interval(hours => p_ttl_hours);
    INSERT INTO public.platform_lead_tg_tokens (token_hash, lead_id, expires_at, created_at)
      VALUES (p_hash, p_lead, v_till, p_now);
    RETURN QUERY SELECT 'new'::text, v_till;
  END
  $$;
--> statement-breakpoint
-- «Старт» по ссылке заявителя (только из личного чата — проверяет вебхук): ссылка действует один раз и
-- до срока, у заявки ещё нет Telegram. Заявка получает чат и имя из Telegram, в истории — «Telegram
-- подключён: <имя>» через Telegram. Ответ: linked — «Заявка получена»; refused — по заявке уже отказали:
-- бот сразу присылает причину (и после этого её не повторяет, tg_refusal_event); again — Telegram
-- повторил доставку того же «Старта» из того же чата (второй раз не отвечать); bad — «Ссылка устарела».
CREATE FUNCTION app.lead_tg_start(
  p_hash text, p_chat bigint, p_username text, p_first_name text, p_name text, p_now timestamptz
)
  RETURNS TABLE (outcome text, firm text, reason text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_tok public.platform_lead_tg_tokens%ROWTYPE;
    v_lead public.platform_leads%ROWTYPE;
    v_event bigint;
    v_reason text;
  BEGIN
    IF p_chat IS NULL OR p_chat <= 0 THEN
      RETURN QUERY SELECT 'bad'::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    SELECT * INTO v_tok FROM public.platform_lead_tg_tokens t
      WHERE t.token_hash = p_hash
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'bad'::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    IF v_tok.used_at IS NOT NULL THEN
      RETURN QUERY SELECT CASE WHEN v_tok.used_chat_id = p_chat THEN 'again' ELSE 'bad' END,
        NULL::text, NULL::text;
      RETURN;
    END IF;
    SELECT * INTO v_lead FROM public.platform_leads l
      WHERE l.id = v_tok.lead_id
      FOR UPDATE;
    IF v_tok.expires_at <= p_now OR NOT FOUND OR v_lead.tg_chat_id IS NOT NULL THEN
      RETURN QUERY SELECT 'bad'::text, NULL::text, NULL::text;
      RETURN;
    END IF;
    UPDATE public.platform_lead_tg_tokens t SET used_at = p_now, used_chat_id = p_chat
      WHERE t.token_hash = p_hash;
    IF v_lead.status = 'rejected' THEN
      SELECT e.id, nullif(btrim(e.text), '') INTO v_event, v_reason
        FROM public.platform_lead_events e
        WHERE e.lead_id = v_lead.id AND e.to_status = 'rejected'
        ORDER BY e.id DESC
        LIMIT 1;
    END IF;
    UPDATE public.platform_leads l
      SET tg_chat_id = p_chat,
          tg_linked_at = p_now,
          tg_username = nullif(btrim(coalesce(p_username, '')), ''),
          tg_first_name = nullif(btrim(coalesce(p_first_name, '')), ''),
          tg_refusal_event = CASE WHEN v_reason IS NOT NULL THEN v_event ELSE l.tg_refusal_event END,
          version = l.version + 1,
          updated_at = p_now,
          updated_by = NULL
      WHERE l.id = v_lead.id;
    INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, text, via)
      VALUES (v_lead.id, p_now, NULL, 'tg', left(p_name, 100), 'telegram');
    RETURN QUERY SELECT CASE WHEN v_reason IS NOT NULL THEN 'refused' ELSE 'linked' END,
      v_lead.firm, v_reason;
  END
  $$;
--> statement-breakpoint
-- Причина отказа заявителю в Telegram — после «Отклонить» на сайте или в чате бота (после транзакции
-- отказа, от имени отказавшего администратора платформы). Только заявке «Отказ» с подключённым Telegram
-- и только ещё не отправленную причину: повтор вызова, «Отказ» после «Старта» с причиной и повторное
-- нажатие второго сообщения не шлют.
CREATE FUNCTION app.lead_tg_refusal_take(p_lead uuid)
  RETURNS TABLE (chat_id bigint, firm text, reason text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_lead public.platform_leads%ROWTYPE;
    v_event bigint;
    v_reason text;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN;
    END IF;
    SELECT * INTO v_lead FROM public.platform_leads l
      WHERE l.id = p_lead
      FOR UPDATE;
    IF NOT FOUND OR v_lead.status <> 'rejected' OR v_lead.tg_chat_id IS NULL THEN
      RETURN;
    END IF;
    SELECT e.id, nullif(btrim(e.text), '') INTO v_event, v_reason
      FROM public.platform_lead_events e
      WHERE e.lead_id = p_lead AND e.to_status = 'rejected'
      ORDER BY e.id DESC
      LIMIT 1;
    IF v_event IS NULL OR v_reason IS NULL OR v_event <= coalesce(v_lead.tg_refusal_event, 0) THEN
      RETURN;
    END IF;
    UPDATE public.platform_leads l SET tg_refusal_event = v_event WHERE l.id = p_lead;
    RETURN QUERY SELECT v_lead.tg_chat_id, v_lead.firm, v_reason;
  END
  $$;
--> statement-breakpoint
-- «Одобрить» (в транзакции создания организации по заявке): Telegram заявителя становится Telegram
-- владельца новой организации — та же привязка, что «Старт» по ссылке из «Мой профиль»
-- (app.telegram_link_set). Только незаблокированный администратор платформы, только действующий
-- владелец организации, созданной по этой заявке, который ещё не входил, не задавал пароль по ссылке и
-- не привязывал и не отвязывал Telegram (иначе это была бы замена Telegram в обход кода из прежнего
-- чата), и только если заявитель подключил Telegram. false — нет.
CREATE FUNCTION app.lead_owner_tg_link(p_lead uuid, p_user uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_lead public.platform_leads%ROWTYPE;
    v_org uuid;
    v_chat bigint;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN false;
    END IF;
    SELECT * INTO v_lead FROM public.platform_leads l
      WHERE l.id = p_lead
      FOR UPDATE;
    IF NOT FOUND OR v_lead.created_org_id IS NULL OR v_lead.tg_chat_id IS NULL THEN
      RETURN false;
    END IF;
    SELECT u.org_id INTO v_org FROM public.users u
      JOIN public.employees e ON e.user_id = u.id AND e.org_id = u.org_id AND e.active
      JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
      WHERE u.id = p_user AND u.org_id = v_lead.created_org_id AND NOT u.blocked
        AND u.last_login_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.telegram_link_guards g WHERE g.user_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.password_setup_tokens t WHERE t.user_id = u.id AND t.used_at IS NOT NULL
        )
      FOR UPDATE OF u;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    SELECT k.chat_id INTO v_chat FROM public.telegram_links k WHERE k.user_id = p_user;
    IF FOUND THEN
      RETURN v_chat = v_lead.tg_chat_id;
    END IF;
    PERFORM app.telegram_link_set(p_user, v_org, v_lead.tg_chat_id, v_lead.tg_username,
      v_lead.tg_first_name);
    RETURN true;
  END
  $$;
--> statement-breakpoint
-- Ссылка «Задать пароль» владельцу организации, созданной по заявке: после «Одобрить» (первая) и
-- «Отправить новую ссылку для пароля» в карточке организации. Только администратор платформы; владелец
-- не заблокирован, вход не закрыт, организация активна; пароль ещё не задан — ни одной использованной
-- ссылки, а первая — только тому, кто ни разу не входил и не получал временный пароль. Прежние ссылки
-- перестают действовать. Ответ: ok — чат, куда отправить (привязанный к владельцу сейчас), логин и
-- организация; no_telegram — у владельца не привязан Telegram, ссылка не выдана; пусто — нельзя.
CREATE FUNCTION app.password_setup_issue(
  p_user uuid, p_hash text, p_now timestamptz, p_days integer
)
  RETURNS TABLE (outcome text, chat_id bigint, login text, org_name text, first boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid;
    v_login text;
    v_org_name text;
    v_fresh boolean;
    v_first boolean;
    v_chat bigint;
  BEGIN
    IF NOT app.is_platform_admin() OR p_hash IS NULL THEN
      RETURN;
    END IF;
    SELECT u.org_id, u.login::text, o.name, u.last_login_at IS NULL AND NOT u.must_change_password
      INTO v_org, v_login, v_org_name, v_fresh
      FROM public.users u
      JOIN public.organizations o ON o.id = u.org_id AND o.status = 'active'
      JOIN public.employees e ON e.user_id = u.id AND e.org_id = u.org_id AND e.active
      JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
      WHERE u.id = p_user AND NOT u.blocked AND u.login_locked_at IS NULL
        AND EXISTS (SELECT 1 FROM public.platform_leads l WHERE l.created_org_id = u.org_id)
      FOR UPDATE OF u;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.password_setup_tokens t
      WHERE t.user_id = p_user AND t.used_at IS NOT NULL
    ) THEN
      RETURN;
    END IF;
    v_first := NOT EXISTS (SELECT 1 FROM public.password_setup_tokens t WHERE t.user_id = p_user);
    IF v_first AND NOT v_fresh THEN
      RETURN;
    END IF;
    SELECT k.chat_id INTO v_chat FROM public.telegram_links k WHERE k.user_id = p_user;
    IF v_chat IS NULL THEN
      RETURN QUERY SELECT 'no_telegram'::text, NULL::bigint, v_login, v_org_name, v_first;
      RETURN;
    END IF;
    UPDATE public.password_setup_tokens t SET expires_at = p_now
      WHERE t.user_id = p_user AND t.used_at IS NULL AND t.expires_at > p_now;
    INSERT INTO public.password_setup_tokens
        (token_hash, user_id, org_id, expires_at, created_by, created_at)
      VALUES (p_hash, p_user, v_org, p_now + make_interval(days => p_days), app.current_user_id(),
              p_now);
    RETURN QUERY SELECT 'ok'::text, v_chat, v_login, v_org_name, v_first;
  END
  $$;
--> statement-breakpoint
-- Страница «Задать пароль»: действующая ссылка — чья она (логин, организация). Неизвестная, истёкшая,
-- использованная, заменённая новой, у заблокированного владельца или организации и при закрытом входе —
-- одинаково пусто («Ссылка устарела»). Ссылку не тратит: её откроет и предпросмотр ссылок в Telegram.
CREATE FUNCTION app.password_setup_peek(p_hash text, p_now timestamptz)
  RETURNS TABLE (user_id uuid, org_id uuid, login text, org_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.org_id, u.login::text, o.name
    FROM public.password_setup_tokens t
    JOIN public.users u ON u.id = t.user_id AND u.org_id = t.org_id
    JOIN public.organizations o ON o.id = t.org_id
    WHERE t.token_hash = p_hash AND t.used_at IS NULL AND t.expires_at > p_now
      AND NOT u.blocked AND u.login_locked_at IS NULL AND o.status = 'active'
      AND EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = u.id AND e.active)
  $$;
--> statement-breakpoint
-- «Задать пароль»: ссылка тратится один раз (проверки — как у app.password_setup_peek, атомарно);
-- новый пароль, временного больше нет, все сеансы завершены, счёт неверных паролей снят (как
-- app.auth_reset_complete). Только для организации и пользователя из контекста — владельца ссылки
-- (историю и причину конца сеансов пишет API в той же транзакции); ждущие коды «Забыли пароль?» гаснут.
-- Сначала блокируется пользователь, потом ссылка — тот же порядок, что у смены пароля с триггером
-- users_password_setup_revoke, без взаимного ожидания. Ответ — логин; пусто — ссылка не подошла.
CREATE FUNCTION app.password_setup_complete(p_hash text, p_password_hash text, p_now timestamptz)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user uuid;
    v_login text;
  BEGIN
    IF p_password_hash IS NULL OR p_password_hash = '' THEN
      RETURN NULL;
    END IF;
    v_user := app.current_user_id();
    PERFORM 1 FROM public.users u
      WHERE u.id = v_user AND u.org_id = app.current_org_id()
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    PERFORM 1
      FROM public.password_setup_tokens t
      JOIN public.users u ON u.id = t.user_id AND u.org_id = t.org_id
      JOIN public.organizations o ON o.id = t.org_id
      WHERE t.token_hash = p_hash AND t.used_at IS NULL AND t.expires_at > p_now
        AND t.user_id = v_user AND t.org_id = app.current_org_id()
        AND NOT u.blocked AND u.login_locked_at IS NULL AND o.status = 'active'
        AND EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = u.id AND e.active)
      FOR UPDATE OF t;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    UPDATE public.password_setup_tokens t SET used_at = p_now WHERE t.token_hash = p_hash;
    UPDATE public.users u
      SET password_hash = p_password_hash, must_change_password = false, login_failures = 0,
          version = u.version + 1, updated_at = p_now
      WHERE u.id = v_user
      RETURNING u.login::text INTO v_login;
    DELETE FROM public.sessions s WHERE s.user_id = v_user;
    DELETE FROM public.login_attempts a WHERE a.login = lower(v_login);
    -- Ждущие коды «Забыли пароль?» больше не действуют (как app.auth_reset_revoke при смене пароля).
    UPDATE public.password_reset_codes c SET expires_at = least(c.expires_at, p_now)
      WHERE c.user_id = v_user AND c.used_at IS NULL AND c.expires_at > p_now;
    RETURN v_login;
  END
  $$;
--> statement-breakpoint
-- «Пароль не задан: ссылка в Telegram» в карточках Админки (прототип: noPass с «Одобрить»): ни одна
-- ссылка не использована и пароль не меняли иначе (смена пароля гасит ссылки триггером), а ссылки
-- выдавались или это владелец организации по заявке, который ещё не входил и не получал временный
-- пароль (первая ссылка не ушла — тогда её выдаст «Отправить новую ссылку для пароля»). Только
-- пользователю организации из контекста или администратору платформы.
CREATE FUNCTION app.password_unset(p_user uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = p_user
        AND (u.org_id = app.current_org_id() OR (SELECT app.is_platform_admin()))
        AND NOT EXISTS (
          SELECT 1 FROM public.password_setup_tokens t
          WHERE t.user_id = u.id AND t.used_at IS NOT NULL
        )
        AND (
          EXISTS (SELECT 1 FROM public.password_setup_tokens t WHERE t.user_id = u.id)
          OR (
            u.last_login_at IS NULL AND NOT u.must_change_password
            AND EXISTS (SELECT 1 FROM public.platform_leads l WHERE l.created_org_id = u.org_id)
            AND EXISTS (
              SELECT 1 FROM public.employees e
              JOIN public.roles r ON r.id = e.role_id AND r.org_id = e.org_id AND r.is_owner
              WHERE e.user_id = u.id AND e.org_id = u.org_id
            )
          )
        )
    )
  $$;
--> statement-breakpoint
-- Пароль сменили иначе (временный от администратора, смена в «Мой профиль», «Забыли пароль?») — пароль
-- задан, ссылки «Задать пароль» больше не действуют. Блокировка и закрытый вход («Это не я», неверные
-- пароли) гасят ссылки насовсем: снятие блокировки их не возвращает.
CREATE FUNCTION app.password_setup_revoke()
  RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
      UPDATE public.password_setup_tokens t SET used_at = now()
        WHERE t.user_id = NEW.id AND t.used_at IS NULL;
    END IF;
    IF (NEW.blocked AND NOT OLD.blocked)
      OR (NEW.login_locked_at IS NOT NULL AND OLD.login_locked_at IS NULL) THEN
      -- Срок — момент выдачи: ссылка не действует ни на каких часах (проверки сравнивают со своим
      -- «сейчас», а не с часами базы).
      UPDATE public.password_setup_tokens t SET expires_at = least(t.expires_at, t.created_at)
        WHERE t.user_id = NEW.id AND t.used_at IS NULL;
    END IF;
    RETURN NULL;
  END
  $$;
--> statement-breakpoint
CREATE TRIGGER users_password_setup_revoke
  AFTER UPDATE OF password_hash, blocked, login_locked_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION app.password_setup_revoke();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.password_setup_revoke() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
-- «Повторить» в журнале отправок Админки: ссылка «Задать пароль», как код, не повторяется — её ключа в
-- базе нет, а без текста Telegram сообщение не примет (outboxRetryRefusal домена).
CREATE OR REPLACE FUNCTION app.admin_telegram_retry(p_ids uuid[], p_now timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH queued AS (
      UPDATE public.telegram_outbox
        SET status = 'pending', tries = 0, last_error = NULL, sent_at = NULL, next_at = p_now
        WHERE id = ANY (p_ids) AND status = 'error'
          AND kind NOT IN ('code', 'relink_code', 'bot_cmd', 'setup_link')
          AND (SELECT app.is_platform_admin())
        RETURNING 1
    )
    SELECT count(*)::integer FROM queued
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  app.lead_tg_issue(uuid, text, text, timestamptz, integer),
  app.lead_tg_start(text, bigint, text, text, text, timestamptz),
  app.lead_tg_refusal_take(uuid),
  app.lead_owner_tg_link(uuid, uuid),
  app.password_setup_issue(uuid, text, timestamptz, integer),
  app.password_setup_peek(text, timestamptz),
  app.password_setup_complete(text, text, timestamptz),
  app.password_unset(uuid)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.lead_tg_issue(uuid, text, text, timestamptz, integer),
  app.lead_tg_start(text, bigint, text, text, text, timestamptz),
  app.lead_tg_refusal_take(uuid),
  app.lead_owner_tg_link(uuid, uuid),
  app.password_setup_issue(uuid, text, timestamptz, integer),
  app.password_setup_peek(text, timestamptz),
  app.password_setup_complete(text, text, timestamptz),
  app.password_unset(uuid)
  TO buhuchet_app;
