-- Видео платформы (решение заказчика 08.11.2026, прототип v79): права роли приложения и узкие функции от
-- владельца схемы (SECURITY DEFINER) там, где в контексте нет администратора платформы, — задача по
-- расписанию убирает незаконченные загрузки, зритель сообщает длительность видео YouTube и что видео
-- недоступно на YouTube, гость лендинга прибавляет запуск и процент просмотра.

-- Видео не удаляются строкой (удалённое остаётся для статистики просмотров с пометкой), просмотры и
-- открытия — тоже; счёт гостей меняет только функция app.video_guest_add.
REVOKE DELETE ON TABLE public.videos FROM buhuchet_app;
--> statement-breakpoint
REVOKE DELETE ON TABLE public.video_views, public.video_sessions FROM buhuchet_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.video_guest_stats FROM buhuchet_app;
--> statement-breakpoint
-- Незаконченные загрузки и неиспользованные обложки старше p_before (задача kb.cleanup-video-uploads):
-- ключ в хранилище и номер многочастной загрузки S3, чтобы её прервать.
CREATE FUNCTION app.video_uploads_stale(p_before timestamptz, p_limit integer)
  RETURNS TABLE (id uuid, storage_key text, s3_upload_id text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, u.storage_key, u.s3_upload_id FROM public.video_uploads u
    WHERE u.created_at < p_before
    ORDER BY u.created_at
    LIMIT least(greatest(p_limit, 0), 1000)
  $$;
--> statement-breakpoint
-- Убрать строки загрузок, файлы которых уже удалены из хранилища; отвечает, сколько убрано.
CREATE FUNCTION app.video_uploads_drop(p_ids uuid[], p_before timestamptz)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH gone AS (
      DELETE FROM public.video_uploads u WHERE u.id = ANY (p_ids) AND u.created_at < p_before
      RETURNING 1
    )
    SELECT count(*)::integer FROM gone
  $$;
--> statement-breakpoint
-- Длительность видео стала известна у зрителя (YouTube до первого запуска, WebM без длительности в
-- файле): только вошедший пользователь, только у опубликованного видео и только пока она неизвестна —
-- записанную длительность меняет лишь администратор платформы. Версия записи не меняется: это не правка.
CREATE FUNCTION app.video_set_duration(p_id text, p_duration integer)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH done AS (
      UPDATE public.videos v SET duration = p_duration
      WHERE v.id = p_id AND v.duration IS NULL AND p_duration BETWEEN 1 AND 43200
        AND app.current_user_id() IS NOT NULL
        AND v.status = 'published' AND NOT v.off AND v.deleted_at IS NULL
      RETURNING 1
    )
    SELECT exists (SELECT 1 FROM done)
  $$;
--> statement-breakpoint
-- Видео YouTube не воспроизводится (удалено или закрыто на YouTube) или снова играет: пометка
-- «YouTube: видео недоступно» в Админке. Сообщает только вошедший пользователь.
CREATE FUNCTION app.video_set_yt_bad(p_id text, p_bad boolean)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH done AS (
      UPDATE public.videos v SET yt_bad = p_bad
      WHERE v.id = p_id AND v.source = 'yt' AND v.yt_bad IS DISTINCT FROM p_bad
        AND app.current_user_id() IS NOT NULL AND v.deleted_at IS NULL
      RETURNING 1
    )
    SELECT exists (SELECT 1 FROM done)
  $$;
--> statement-breakpoint
-- Гость лендинга запустил видео (p_start) или закрыл окно, посмотрев p_pct процентов: только у видео,
-- которое сейчас на лендинге (опубликовано, не снято, не удалено, «Показывать на лендинге», для всех).
-- Без имён и адресов — только число запусков и сумма процентов.
CREATE FUNCTION app.video_guest_add(p_id text, p_start boolean, p_pct real)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH ok AS (
      SELECT v.id FROM public.videos v
      WHERE v.id = p_id AND v.status = 'published' AND NOT v.off AND v.deleted_at IS NULL
        AND v.landing AND v.audience = 'all'
    ), done AS (
      INSERT INTO public.video_guest_stats AS g (video_id, starts, pct_sum)
        SELECT ok.id, CASE WHEN p_start THEN 1 ELSE 0 END,
          CASE WHEN p_start THEN 0 ELSE least(100, greatest(0, coalesce(p_pct, 0))) END
        FROM ok
      ON CONFLICT (video_id) DO UPDATE SET
        starts = g.starts + excluded.starts,
        pct_sum = g.pct_sum + excluded.pct_sum
      RETURNING 1
    )
    SELECT exists (SELECT 1 FROM done)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.video_uploads_stale(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.video_uploads_drop(uuid[], timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.video_set_duration(text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.video_set_yt_bad(text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.video_guest_add(text, boolean, real) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.video_uploads_stale(timestamptz, integer),
  app.video_uploads_drop(uuid[], timestamptz), app.video_set_duration(text, integer),
  app.video_set_yt_bad(text, boolean), app.video_guest_add(text, boolean, real) TO buhuchet_app;
