-- Вид отчёта организация не удаляет, а отключает (enabled = false): строка хранит её настройки по виду
-- для повторного подключения. Удалить строку приложению нечем.
REVOKE DELETE, TRUNCATE ON TABLE org_report_types FROM buhuchet_app;
