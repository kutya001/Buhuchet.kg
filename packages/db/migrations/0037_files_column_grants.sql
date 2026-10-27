-- Файлы: роль приложения меняет у записи файла только состояние (загружен, удалён — кто и когда),
-- контрагента (если его сменила запись-источник), комментарий и служебные поля правки. Имя, размер,
-- тип, ключ хранилища, источник и автора загрузки после вставки не меняет никто, кроме миграций. Права
-- по умолчанию (миграция 0000) дали UPDATE на всю таблицу — забираем его и выдаём на эти столбцы.
-- TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, TRUNCATE ON TABLE files FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (state, contractor_id, note, deleted_at, deleted_by, updated_by, updated_at, version)
  ON TABLE files TO buhuchet_app;
