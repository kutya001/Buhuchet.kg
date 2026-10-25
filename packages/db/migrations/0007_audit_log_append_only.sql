-- История изменений только дополняется: роль приложения читает и добавляет записи своей организации
-- (политики audit_log_isolation и audit_log_insert_guard), но не меняет и не удаляет их. Права
-- по умолчанию (миграция 0000) дали ей UPDATE и DELETE на все новые таблицы — у истории их забираем.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM buhuchet_app;
