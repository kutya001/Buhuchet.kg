-- Частота действий (docs/decisions.md, п. 38): выгрузка «В Excel» — одна одновременно и не больше 20 в
-- час на пользователя; поток Е добавит сюда счёт кодов страницы контрагента. Как и счёт неверных
-- паролей (миграция 0013), таблицу роль приложения не видит и не меняет — только узкими функциями от
-- владельца схемы (SECURITY DEFINER).
CREATE TABLE "rate_limits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_limits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"busy_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "rate_limits_subject_idx" ON "rate_limits" USING btree ("kind","subject","at");
--> statement-breakpoint
-- Занять действие вида p_kind от p_subject: не больше p_max за p_window_seconds, а при p_lease_seconds —
-- ещё и одновременно одно (строка «занята» p_lease_seconds или до app.rate_limit_release). Запросы
-- одного субъекта проверяются по очереди: блокировка до конца транзакции, и каждый следующий оператор
-- функции видит строку, вставленную предыдущим запросом. outcome — ok (ticket — номер строки), busy
-- (идёт прежнее действие) или limited (предел за окно).
CREATE FUNCTION app.rate_limit_take(
    p_kind text, p_subject text, p_max integer, p_window_seconds integer, p_lease_seconds integer)
  RETURNS TABLE (outcome text, ticket bigint)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_id bigint;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:' || p_kind || ':' || p_subject, 0));
    IF p_lease_seconds IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.rate_limits r
      WHERE r.kind = p_kind AND r.subject = p_subject AND r.busy_until > clock_timestamp()
    ) THEN
      RETURN QUERY SELECT 'busy'::text, NULL::bigint;
      RETURN;
    END IF;
    IF (
      SELECT count(*) FROM public.rate_limits r
      WHERE r.kind = p_kind AND r.subject = p_subject
        AND r.at > clock_timestamp() - make_interval(secs => p_window_seconds)
    ) >= p_max THEN
      RETURN QUERY SELECT 'limited'::text, NULL::bigint;
      RETURN;
    END IF;
    INSERT INTO public.rate_limits (kind, subject, at, busy_until)
      VALUES (p_kind, p_subject, clock_timestamp(),
              clock_timestamp() + make_interval(secs => p_lease_seconds))
      RETURNING id INTO v_id;
    RETURN QUERY SELECT 'ok'::text, v_id;
  END
  $$;
--> statement-breakpoint
-- Действие закончилось (успешно или нет): строка больше не «занята», но считается в окне.
CREATE FUNCTION app.rate_limit_release(p_ticket bigint)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ UPDATE public.rate_limits SET busy_until = NULL WHERE id = p_ticket $$;
--> statement-breakpoint
-- Очистка по расписанию: строки старше p_keep_seconds, которые уже не «заняты». Окна всех пределов
-- короче, поэтому удаление ничего не меняет в счёте.
CREATE FUNCTION app.rate_limit_cleanup(p_keep_seconds integer)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (
      DELETE FROM public.rate_limits
      WHERE at <= clock_timestamp() - make_interval(secs => p_keep_seconds)
        AND (busy_until IS NULL OR busy_until <= clock_timestamp())
      RETURNING 1
    )
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.rate_limit_take(text, text, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.rate_limit_release(bigint) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.rate_limit_cleanup(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.rate_limit_take(text, text, integer, integer, integer),
  app.rate_limit_release(bigint), app.rate_limit_cleanup(integer) TO buhuchet_app;
--> statement-breakpoint
-- Таблицу и её счётчик номеров роль приложения не читает и не меняет напрямую — только функциями выше.
REVOKE ALL ON TABLE public.rate_limits FROM buhuchet_app;
--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.rate_limits_id_seq FROM buhuchet_app;
