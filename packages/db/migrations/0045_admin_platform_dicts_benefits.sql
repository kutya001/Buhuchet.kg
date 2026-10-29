-- Админка → «Справочники платформы», задача 2.36: «Льготы и статусы» правятся общим механизмом
-- (миграция 0043) — строкой перечня. «Делает ненужными» и «Добавляет» — одна таблица связей
-- tax_benefit_report_types с меткой effect, «Ставится по УГНС» — tax_benefit_offices (миграция 0044,
-- app.admin_dict_set_links). «Меняет сроки» — строки tax_benefit_due_rules, пишет
-- app.admin_benefit_set_due_rules. «Виды деятельности (ГКЭД)» (gked, gked_main_only), «Подсказки» (suggest)
-- и налог тарифа (tax_code) — не в перечне: ГКЭД правит задача 2.38, остальное окно статуса не правит.
-- Без «№» и «Выше»/«Ниже» (docs/deviations.md п. Д-2): список — по коду, как в прототипе.
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('benefits', 'tax_benefits', ARRAY['name', 'kind', 'gives', 'article', 'payer', 'conditions', 'confirmation', 'combines', 'term', 'valid_until', 'verify', 'verify_note'], false);
--> statement-breakpoint
INSERT INTO app.platform_dict_links (dict, field, table_name, key_column, link_column, tag_column, tag) VALUES
  ('benefits', 'removes', 'tax_benefit_report_types', 'benefit_code', 'report_type_code', 'effect', 'removes'),
  ('benefits', 'adds', 'tax_benefit_report_types', 'benefit_code', 'report_type_code', 'effect', 'adds'),
  ('benefits', 'offices', 'tax_benefit_offices', 'benefit_code', 'tax_office_code', NULL, NULL);
--> statement-breakpoint
-- «Используется» без собственных строк значения: внешний ключ с ON DELETE CASCADE — часть самого
-- значения (связи и сроки статуса, связи вида отчёта), удаляется вместе с ним и использованием не
-- считается. Иначе статус со своими «Добавляет» или «Меняет сроки» нельзя было бы удалить, хотя в
-- прототипе удаление запрещают только контрагенты. Остальное — как в миграции 0043.
CREATE OR REPLACE FUNCTION app.admin_dict_usage(p_dict text)
  RETURNS TABLE (code text, ref text, n bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    spec app.platform_dict_specs;
    link record;
    parts text[] := ARRAY[]::text[];
  BEGIN
    IF NOT app.is_platform_admin() THEN
      RETURN;
    END IF;
    SELECT * INTO spec FROM app.platform_dict_specs s WHERE s.dict = p_dict;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    FOR link IN
      SELECT ns.nspname AS schema, a.attname AS col, cl.relname AS name
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = format('public.%I', spec.table_name)::regclass
        AND cardinality(c.conkey) = 1
        AND fa.attname = 'code'
        -- Связи платформы с ON DELETE CASCADE уходят вместе со значением и использованием не
        -- считаются; ссылка из таблицы организации (есть org_id) считается всегда.
        AND (c.confdeltype <> 'c' OR EXISTS (
          SELECT 1 FROM pg_attribute oa
            WHERE oa.attrelid = c.conrelid AND oa.attname = 'org_id' AND NOT oa.attisdropped
        ))
    LOOP
      parts := parts || format(
        'SELECT %1$I::text AS code, %2$L::text AS ref FROM %3$I.%2$I WHERE %1$I IS NOT NULL',
        link.col, link.name, link.schema);
    END LOOP;
    FOR link IN
      SELECT r.table_name, r.column_name FROM app.platform_dict_array_refs r WHERE r.dict = p_dict
    LOOP
      parts := parts || format(
        'SELECT unnest(%1$I)::text AS code, %2$L::text AS ref FROM public.%2$I',
        link.column_name, link.table_name);
    END LOOP;
    IF cardinality(parts) = 0 THEN
      RETURN;
    END IF;
    RETURN QUERY EXECUTE format(
      'SELECT x.code, x.ref, count(*) FROM (%s) x GROUP BY x.code, x.ref',
      array_to_string(parts, ' UNION ALL '));
  END
  $$;
--> statement-breakpoint
-- «Меняет сроки» статуса целиком: p_rules — [{reportType, dueDay, dueAfter, dueMonth, payDay,
-- payAfter}]; прежние строки статуса заменяются новыми. Вид отчёта проверяет внешний ключ, дни и
-- месяцы — ограничение таблицы. Строка статуса на время записи закрыта для других правок. Отвечает
-- true; false — нет статуса; пусто — не администратор платформы или p_rules не массив.
CREATE OR REPLACE FUNCTION app.admin_benefit_set_due_rules(p_code text, p_rules jsonb)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NOT app.is_platform_admin() OR jsonb_typeof(p_rules) IS DISTINCT FROM 'array' THEN
      RETURN NULL;
    END IF;
    PERFORM 1 FROM public.tax_benefits t WHERE t.code = p_code FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    DELETE FROM public.tax_benefit_due_rules r WHERE r.benefit_code = p_code;
    INSERT INTO public.tax_benefit_due_rules
      (benefit_code, report_type_code, due_day, due_after, due_month, pay_day, pay_after)
    SELECT p_code, x."reportType", x."dueDay", x."dueAfter", x."dueMonth", x."payDay", x."payAfter"
    FROM jsonb_to_recordset(p_rules) AS x(
      "reportType" text, "dueDay" smallint, "dueAfter" smallint, "dueMonth" smallint,
      "payDay" smallint, "payAfter" smallint);
    RETURN true;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.admin_benefit_set_due_rules(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.admin_benefit_set_due_rules(text, jsonb) TO buhuchet_app;
--> statement-breakpoint
-- «Виды отчётов» правятся тем же механизмом (прототип typeEditDlg). «Применимые режимы» и «Не для
-- режимов» — строки report_type_regimes с меткой relation, «Основания» — report_type_bases (та же
-- связь, что «Виды отчётов» основания). «Виды деятельности (ГКЭД)» (gked) правит задача 2.38, сверку с
-- ГНС (gns_checked_at, gns_checked_by) — задача 2.37; «Пропускать кварталы», «Период по назначению»,
-- «Добавляемые строки ставок», «Подсказка подбора» и «Примечание» окно вида не правит — их меняет
-- только наполнение. Без «№» и «Выше»/«Ниже» (docs/deviations.md п. Д-2): список — в порядке каталога.
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('types', 'report_types', ARRAY['name', 'short_name', 'form_code', 'stat_index', 'respondents', 'authority_code', 'period', 'due_day', 'due_after', 'due_month', 'due_from', 'pay_day', 'pay_after', 'pay_month', 'pay_schedule', 'shift_to_workday', 'one_off', 'event_label', 'act', 'payments', 'kind', 'payer', 'rates', 'not_for_en_rates', 'biz_sizes', 'pick_group', 'preselect', 'choice_note', 'description', 'client_note', 'article', 'source', 'verify', 'verify_note'], false);
--> statement-breakpoint
INSERT INTO app.platform_dict_links (dict, field, table_name, key_column, link_column, tag_column, tag) VALUES
  ('types', 'regimes', 'report_type_regimes', 'report_type_code', 'regime_code', 'relation', 'applies'),
  ('types', 'notForRegimes', 'report_type_regimes', 'report_type_code', 'regime_code', 'relation', 'excludes'),
  ('types', 'bases', 'report_type_bases', 'report_type_code', 'base_code', NULL, NULL);
