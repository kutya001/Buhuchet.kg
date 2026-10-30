-- Первый запуск организации (docs/decisions.md п. Г-4): строку приветствия организации не удаляют
-- (она уходит вместе с организацией); отметку «приветствие уже видел» только добавляют.
REVOKE DELETE, TRUNCATE ON TABLE org_onboarding FROM buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE welcome_seen FROM buhuchet_app;
