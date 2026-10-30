-- Знакомые элементы показов (docs/decisions.md п. Г-5): строки только добавляются и удаляются
-- («Показывать всё заново») самим пользователем; менять их незачем.
REVOKE UPDATE, TRUNCATE ON TABLE kb_known FROM buhuchet_app;
