-- История статусов только дополняется, как audit_log (миграция 0007): роль приложения читает и
-- добавляет записи своей организации (политики status_history_isolation и
-- status_history_insert_guard), но не меняет и не удаляет их. Права по умолчанию (миграция 0000) дали
-- ей UPDATE и DELETE на все новые таблицы — у истории статусов их забираем.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE status_history FROM buhuchet_app;
