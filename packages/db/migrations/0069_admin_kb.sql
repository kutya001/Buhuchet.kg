-- Админка → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11): шаги уроков,
-- статьи, уровни и сценарии показов остаются разделами `platform_reference` (kbSteps, kbArticles,
-- kbLevels, kbShows) — их пишет администратор платформы той же функцией, что налоги и группы кодов
-- ГКЭД. Раздел той версии, что видел администратор; отвечает новой версией, пусто — версия устарела,
-- раздела нет или в контексте не администратор платформы. Права на функцию сохраняются (CREATE OR
-- REPLACE).
CREATE OR REPLACE FUNCTION app.admin_set_reference(p_key text, p_payload jsonb, p_checksum text, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    result integer;
  BEGIN
    IF NOT app.is_platform_admin()
      OR p_key NOT IN ('taxes', 'propertyRates', 'gkedGroups', 'kbSteps', 'kbArticles', 'kbLevels', 'kbShows')
      OR p_payload IS NULL OR p_checksum IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE public.platform_reference AS r
      SET payload = p_payload, checksum = p_checksum, version = r.version + 1, source = 'admin',
          updated_at = now(), updated_by = app.current_user_id()
      WHERE r.key = p_key AND r.version = p_version
      RETURNING r.version INTO result;
    RETURN result;
  END
  $$;
