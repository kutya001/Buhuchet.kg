-- Заявки с лендинга (ТЗ «Лендинг» → «Форма «Оставить заявку»», «Админка» → «Вкладка «Заявки»»;
-- прототип modules/landing.js, admin/leads.js; решение заказчика 01.11.2026). Таблицы заявок и их
-- истории (миграция 0088) роль приложения не видит и не меняет: прав на них у неё нет (сняты ниже),
-- RLS включён, политик нет. Заявку гостя
-- пишет только app.lead_submit — единственный метод API без входа на лендинге; читает и меняет только
-- администратор платформы — представлениями и функциями от владельца схемы, как app.admin_organizations
-- (0024): в контексте (app.user_id) должен быть незаблокированный администратор платформы.
--
-- Заявка гостя: не больше p_ip_limit заявок за p_ip_window секунд с одного адреса (общая таблица
-- rate_limits, вид «lead», субъект — хеш адреса); повторная с тем же телефоном за p_repeat_hours часов
-- новой не создаётся — её комментарий дописывается к первой заявке, в историю первой пишется «Повторная
-- заявка с того же телефона»; новая заявка ставит сообщение p_tg_text в очередь Telegram каждому
-- незаблокированному администратору платформы с привязанным Telegram (с тестового стенда p_tg_text
-- пусто — в Telegram не уходит). p_trap — заполнено поле-ловушка: заявка засчитывается в предел по
-- адресу, но не сохраняется (ответ гостю тот же, что на обычную заявку, — ловушку не распознать).
-- outcome — created, repeat, trap или limited. p_now — часы приложения.
CREATE FUNCTION app.lead_submit(
  p_ip text, p_name text, p_firm text, p_phone text, p_size text, p_telegram text, p_note text,
  p_stand boolean, p_trap boolean, p_tg_text text, p_now timestamptz,
  p_ip_limit integer, p_ip_window integer, p_repeat_hours integer, p_note_max integer
)
  RETURNS TABLE (outcome text, lead_id uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_take text;
    v_id uuid;
    v_note text := nullif(btrim(coalesce(p_note, '')), '');
  BEGIN
    SELECT t.outcome INTO v_take FROM app.rate_limit_take('lead', p_ip, p_ip_limit, p_ip_window, NULL) t;
    IF v_take IS DISTINCT FROM 'ok' THEN
      RETURN QUERY SELECT 'limited'::text, NULL::uuid;
      RETURN;
    END IF;
    IF p_trap THEN
      RETURN QUERY SELECT 'trap'::text, NULL::uuid;
      RETURN;
    END IF;
    -- Две заявки с одного телефона одновременно: вторая ждёт первую и становится повторной.
    PERFORM pg_advisory_xact_lock(hashtextextended('lead:' || p_phone, 0));
    SELECT l.id INTO v_id FROM public.platform_leads l
      WHERE l.phone = p_phone AND l.created_at > p_now - make_interval(hours => p_repeat_hours)
      ORDER BY l.created_at
      LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE public.platform_leads l
        SET note = CASE WHEN v_note IS NULL THEN l.note
                        ELSE left(concat_ws(E'\n', nullif(l.note, ''), v_note), p_note_max) END,
            version = l.version + 1,
            updated_at = p_now,
            updated_by = NULL
        WHERE l.id = v_id;
      INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, text)
        VALUES (v_id, p_now, NULL, 'repeat', v_note);
      RETURN QUERY SELECT 'repeat'::text, v_id;
      RETURN;
    END IF;
    INSERT INTO public.platform_leads
        (created_at, name, firm, phone, size, telegram, note, status, from_stand, updated_at)
      VALUES (p_now, p_name, p_firm, p_phone, p_size, nullif(btrim(coalesce(p_telegram, '')), ''),
              v_note, 'new', p_stand, p_now)
      RETURNING id INTO v_id;
    INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind, to_status)
      VALUES (v_id, p_now, NULL, 'created', 'new');
    IF NOT p_stand AND p_tg_text IS NOT NULL THEN
      -- Ключ `lead:<заявка>:<администратор>` связывает сообщение с заявкой: в тексте имя и телефон,
      -- поэтому удаление заявки стирает и его запись в журнале Telegram.
      INSERT INTO public.telegram_outbox
        (org_id, user_id, chat_id, kind, text, status, tries, next_at, dedupe_key)
      SELECT NULL, u.id, l.chat_id, 'lead', p_tg_text, 'pending', 0, p_now,
        'lead:' || v_id::text || ':' || u.id::text
      FROM public.telegram_links l
      JOIN public.users u ON u.id = l.user_id AND u.is_platform_admin AND NOT u.blocked;
    END IF;
    RETURN QUERY SELECT 'created'::text, v_id;
  END
  $$;
--> statement-breakpoint
-- Список заявок Админки: строки отдаются, только если в контексте — незаблокированный администратор
-- платформы (security_barrier: условие не обойти функцией в WHERE запроса). Название организации,
-- созданной по заявке, — ссылка в столбце «Организация».
CREATE VIEW app.admin_leads WITH (security_barrier = true) AS
  SELECT
    l.id,
    l.created_at,
    l.name,
    l.firm,
    l.phone,
    l.size,
    l.telegram,
    l.note,
    l.status,
    l.status_before,
    l.created_org_id,
    g.name AS org_name,
    l.admin_note,
    l.from_stand,
    l.version,
    l.updated_at,
    l.updated_by
  FROM public.platform_leads l
  LEFT JOIN public.organizations g ON g.id = l.created_org_id
  WHERE (SELECT app.is_platform_admin());
--> statement-breakpoint
-- История заявки для окна заявки: кто (логин администратора платформы; пусто — гость с лендинга),
-- когда и что.
CREATE VIEW app.admin_lead_events WITH (security_barrier = true) AS
  SELECT
    e.id,
    e.lead_id,
    e.at,
    e.actor_user_id,
    u.login::text AS actor_login,
    e.kind,
    e.from_status,
    e.to_status,
    e.text
  FROM public.platform_lead_events e
  LEFT JOIN public.users u ON u.id = e.actor_user_id
  WHERE (SELECT app.is_platform_admin());
--> statement-breakpoint
-- Права на таблицы заявок роль приложения получила по умолчанию (0000_foundation); их снимаем, чтобы
-- защищал не только RLS без политик: заявки пишут и читают только функции и представления ниже.
REVOKE ALL ON TABLE public.platform_leads, public.platform_lead_events FROM buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.platform_lead_events_id_seq FROM buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON TABLE app.admin_leads, app.admin_lead_events FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT ON TABLE app.admin_leads, app.admin_lead_events TO buhuchet_app;
--> statement-breakpoint
-- Смена статуса заявки (шаг шкалы, «Отказ» с причиной, откат с причиной, «Снять «Отказ»»,
-- «Подключена» после «Создать организацию»): допустимость шага проверяет приложение (правила домена),
-- функция — что меняет администратор платформы и запись не изменилась (p_version; пусто — не сверять,
-- так её вызывает создание организации в той же транзакции). p_rollback — откат: в истории — «Откат».
-- p_org — созданная по заявке организация: тогда в историю пишется «Создана организация» (p_text — её
-- название); у заявки, по которой организация уже создана, вторую не привязать. Отвечает новой
-- версией; null — не администратор, заявки нет, её уже изменили или организация уже создана.
CREATE FUNCTION app.admin_lead_status(
  p_id uuid, p_version integer, p_to text, p_before text, p_rollback boolean, p_org uuid,
  p_text text, p_now timestamptz
)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_from text;
    v_org uuid;
    v_version integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    SELECT l.status, l.created_org_id INTO v_from, v_org FROM public.platform_leads l
      WHERE l.id = p_id AND (p_version IS NULL OR l.version = p_version)
      FOR UPDATE;
    IF NOT FOUND OR (p_org IS NOT NULL AND v_org IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    UPDATE public.platform_leads l
      SET status = p_to,
          status_before = p_before,
          created_org_id = coalesce(p_org, l.created_org_id),
          version = l.version + 1,
          updated_at = p_now,
          updated_by = app.current_user_id()
      WHERE l.id = p_id
      RETURNING l.version INTO v_version;
    IF p_org IS NOT NULL THEN
      INSERT INTO public.platform_lead_events
          (lead_id, at, actor_user_id, kind, from_status, to_status, text)
        VALUES (p_id, p_now, app.current_user_id(), 'org',
                CASE WHEN v_from <> p_to THEN v_from END, CASE WHEN v_from <> p_to THEN p_to END,
                p_text);
    ELSIF v_from <> p_to THEN
      INSERT INTO public.platform_lead_events
          (lead_id, at, actor_user_id, kind, from_status, to_status, text)
        VALUES (p_id, p_now, app.current_user_id(),
                CASE WHEN p_rollback THEN 'rollback' ELSE 'status' END, v_from, p_to, p_text);
    END IF;
    RETURN v_version;
  END
  $$;
--> statement-breakpoint
-- «Заметка администратора»: изменение пишется в историю заявки (ТЗ). Ответ — как у app.admin_lead_status.
CREATE FUNCTION app.admin_lead_note(p_id uuid, p_version integer, p_note text, p_now timestamptz)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_version integer;
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN NULL;
    END IF;
    UPDATE public.platform_leads l
      SET admin_note = nullif(btrim(coalesce(p_note, '')), ''),
          version = l.version + 1,
          updated_at = p_now,
          updated_by = app.current_user_id()
      WHERE l.id = p_id AND l.version = p_version
      RETURNING l.version INTO v_version;
    IF v_version IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.platform_lead_events (lead_id, at, actor_user_id, kind)
      VALUES (p_id, p_now, app.current_user_id(), 'note');
    RETURN v_version;
  END
  $$;
--> statement-breakpoint
-- «Удалить» — заявка стирается полностью вместе с историей (ТЗ: «Имя и телефон будут стёрты»,
-- например по просьбе человека). true — стёрта; false — не администратор или заявки нет.
CREATE FUNCTION app.admin_lead_delete(p_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN false;
    END IF;
    DELETE FROM public.platform_leads WHERE id = p_id;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    -- Сообщение администраторам о заявке (имя и телефон) — вместе с заявкой, и из журнала Telegram.
    DELETE FROM public.telegram_outbox
      WHERE kind = 'lead' AND org_id IS NULL AND dedupe_key LIKE 'lead:' || p_id::text || ':%';
    RETURN true;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, timestamptz, integer, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_lead_status(uuid, integer, text, text, boolean, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_lead_note(uuid, integer, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_lead_delete(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  app.lead_submit(text, text, text, text, text, text, text, boolean, boolean, text, timestamptz, integer, integer, integer, integer),
  app.admin_lead_status(uuid, integer, text, text, boolean, uuid, text, timestamptz),
  app.admin_lead_note(uuid, integer, text, timestamptz),
  app.admin_lead_delete(uuid) TO buhuchet_app;
