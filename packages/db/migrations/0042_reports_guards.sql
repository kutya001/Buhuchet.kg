-- Изменения срока отчёта — журнал: записи не меняются и не удаляются.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE report_due_changes FROM buhuchet_app;
