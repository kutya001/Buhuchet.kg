-- Функции контекста RLS не зависят от search_path сессии (ревью безопасности Р-21, docs/decisions.md
-- п. О-31): каждое имя в теле — со схемой (`pg_catalog.current_setting`, `pg_catalog.uuid`, сравнение
-- `OPERATOR(pg_catalog.=)`), поэтому функция, тип или оператор из другой схемы впереди пути их не
-- подменят. `SET search_path` у функций нет намеренно: с ним PostgreSQL не встраивает функцию в запрос, и
-- проверка RLS вызывает её на каждую строку — в замере почти в 4 раза медленнее. Остальное как было: пустая
-- строка (настройка осталась от прошлой транзакции) — как не задано, права и владелец не меняются.
CREATE OR REPLACE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE WHEN pg_catalog.current_setting('app.org_id', true) OPERATOR(pg_catalog.=) ''
      THEN NULL
      ELSE pg_catalog.current_setting('app.org_id', true)::pg_catalog.uuid
    END
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$
    SELECT CASE WHEN pg_catalog.current_setting('app.user_id', true) OPERATOR(pg_catalog.=) ''
      THEN NULL
      ELSE pg_catalog.current_setting('app.user_id', true)::pg_catalog.uuid
    END
  $$;
