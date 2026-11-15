-- Подсказки и обучение на странице контрагента (доработки 15.11.2026, поток К; прототип v120
-- admin/cp-help-admin.js): тексты «Добро пожаловать», облачка обзора, частые вопросы «Помощи»,
-- «Словарик» и подсказки в окнах — раздел `cpHelp` справочника `platform_reference` (наполнение кладёт
-- его из refDB.json `kbUi.cpHelp` отдельной строкой). Его правит администратор платформы в Админке →
-- «База знаний (содержимое)» → «Страница контрагента» той же функцией, что налоги и разделы «Базы
-- знаний»: в список разделов добавлен `cpHelp`. Остальное — как в 0069; права на функцию сохраняются
-- (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION app.admin_set_reference(p_key text, p_payload jsonb, p_checksum text, p_version integer)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    result integer;
  BEGIN
    IF NOT app.is_platform_admin()
      OR p_key NOT IN ('taxes', 'propertyRates', 'gkedGroups', 'kbSteps', 'kbArticles', 'kbLevels', 'kbShows', 'cpHelp')
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
