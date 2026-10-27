-- Админка → «Справочники платформы», часть 2 задачи 2.36: основания для отчётов и режимы
-- налогообложения правятся общим механизмом (миграция 0039) — строками перечня. «Виды деятельности
-- (ГКЭД)» режима (столбец gked) — не в перечне: их правит задача 2.38. «Используется» — ссылки
-- внешними ключами (виды отчётов, контрагенты) считаются сами.
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('bases', 'report_bases', ARRAY['name', 'description', 'note'], true),
  ('regimes', 'tax_regimes', ARRAY['name', 'full_name', 'kind', 'frees', 'who', 'how', 'combines', 'accountant_note', 'article'], true);
--> statement-breakpoint
-- Поля-связи значения: коды значений другого справочника в таблице связей, а не в столбце значения.
-- Виды отчётов основания — та же связь, что «Основание» у вида отчёта (ТЗ «связь с видами правится с
-- любой стороны и пересчитывается во второй»). tag_column и tag — у таблиц, где одна таблица держит
-- несколько полей (у льгот «Делает ненужными» и «Добавляет»): поле — строки с этой меткой.
CREATE TABLE app.platform_dict_links (
  dict text NOT NULL REFERENCES app.platform_dict_specs (dict),
  field text NOT NULL,
  table_name text NOT NULL,
  key_column text NOT NULL,
  link_column text NOT NULL,
  tag_column text,
  tag text,
  PRIMARY KEY (dict, field),
  CHECK ((tag_column IS NULL) = (tag IS NULL))
);
--> statement-breakpoint
REVOKE ALL ON TABLE app.platform_dict_links FROM PUBLIC;
--> statement-breakpoint
INSERT INTO app.platform_dict_links (dict, field, table_name, key_column, link_column) VALUES
  ('bases', 'types', 'report_type_bases', 'base_code', 'report_type_code');
--> statement-breakpoint
-- Поля-связи значения целиком: p_links — {поле: [коды]}; поля, которых нет в p_links, не меняются.
-- Сначала убираются связи, которых нет в новом списке (по всем полям), потом добавляются новые — так
-- код, перенесённый из одного поля в другое той же таблицы, не теряется. Есть ли связанные значения,
-- проверяют внешние ключи таблицы связей. Строка значения на время записи закрыта для других правок.
-- Отвечает true; false — нет значения; пусто — справочника нет в перечне или не администратор.
CREATE OR REPLACE FUNCTION app.admin_dict_set_links(p_dict text, p_code text, p_links jsonb)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    link app.platform_dict_links;
    codes text[];
    tagged text;
    found_rows integer;
  BEGIN
    IF NOT app.is_platform_admin() OR jsonb_typeof(p_links) IS DISTINCT FROM 'object' THEN
      RETURN NULL;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    EXECUTE format('SELECT 1 FROM public.%I t WHERE t.code = $1 FOR UPDATE', spec.table_name)
      USING p_code;
    GET DIAGNOSTICS found_rows = ROW_COUNT;
    IF found_rows = 0 THEN
      RETURN false;
    END IF;
    FOR link IN
      SELECT * FROM app.platform_dict_links l WHERE l.dict = p_dict AND p_links ? l.field ORDER BY l.field
    LOOP
      codes := ARRAY(SELECT jsonb_array_elements_text(p_links -> link.field));
      tagged := CASE WHEN link.tag_column IS NULL THEN ''
        ELSE format(' AND t.%I = %L', link.tag_column, link.tag) END;
      EXECUTE format('DELETE FROM public.%I AS t WHERE t.%I = $1 AND NOT (t.%I = ANY($2))%s',
        link.table_name, link.key_column, link.link_column, tagged)
        USING p_code, codes;
    END LOOP;
    FOR link IN
      SELECT * FROM app.platform_dict_links l WHERE l.dict = p_dict AND p_links ? l.field ORDER BY l.field
    LOOP
      codes := ARRAY(SELECT jsonb_array_elements_text(p_links -> link.field));
      IF link.tag_column IS NULL THEN
        EXECUTE format('INSERT INTO public.%I (%I, %I) SELECT $1, x FROM unnest($2) AS x ON CONFLICT DO NOTHING',
          link.table_name, link.key_column, link.link_column)
          USING p_code, codes;
      ELSE
        EXECUTE format('INSERT INTO public.%I (%I, %I, %I) SELECT $1, x, $3 FROM unnest($2) AS x ON CONFLICT DO NOTHING',
          link.table_name, link.key_column, link.link_column, link.tag_column)
          USING p_code, codes, link.tag;
      END IF;
    END LOOP;
    RETURN true;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_dict_set_links(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_dict_set_links(text, text, jsonb) TO buhuchet_app;
