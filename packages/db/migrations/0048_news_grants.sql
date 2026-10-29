-- «Новости» (docs/decisions.md п. Г-3): отметки «прочитана» только добавляются — не меняются и не
-- удаляются (уходят только вместе с пользователем или черновиком).
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE news_reads FROM buhuchet_app;
--> statement-breakpoint
REVOKE TRUNCATE ON TABLE news FROM buhuchet_app;
--> statement-breakpoint
-- ОТКЛОНЕНИЕ: docs/deviations.md#Г-3
-- Когда создана учётная запись вошедшего: новости, вышедшие раньше, у него прочитаны
-- (docs/deviations.md п. Г-3). Свою строку `users` администратор платформы по RLS не видит (организации у
-- него нет), поэтому — функция, которая отдаёт только момент создания и только вошедшего.
CREATE OR REPLACE FUNCTION app.current_user_created_at() RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT created_at FROM public.users WHERE id = app.current_user_id() $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_user_created_at() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_created_at() TO buhuchet_app;
