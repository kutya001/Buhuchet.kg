-- Админка → «Справочники платформы», часть 2 задачи 2.36: режимы налогообложения правятся общим
-- механизмом (миграция 0039) — строкой перечня. «Виды деятельности (ГКЭД)» режима (столбец gked) — не в
-- перечне: их правит задача 2.38. «Используется» режима — ссылки внешними ключами (виды отчётов,
-- контрагенты) считаются сами.
INSERT INTO app.platform_dict_specs (dict, table_name, columns, ordered) VALUES
  ('regimes', 'tax_regimes', ARRAY['name', 'full_name', 'kind', 'frees', 'who', 'how', 'combines', 'accountant_note', 'article'], true);
