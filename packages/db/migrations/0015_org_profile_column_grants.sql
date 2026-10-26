-- «Моя организация»: роль приложения меняет у организации только поля профиля и служебные поля правки
-- (версия, «Изменено», «Изменил»). Статус, причину блокировки, отметку демо и автора создания она не
-- меняет: их ведёт администратор платформы (Админка, #18). Права по умолчанию (миграция 0000) дали
-- UPDATE на всю таблицу — забираем его и выдаём на перечисленные столбцы. SELECT … FOR UPDATE
-- (updateWithHistory) работает и с правом на часть столбцов.
REVOKE UPDATE ON TABLE organizations FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (name, inn, slug, address, phone, head, logo_key, updated_by, updated_at, version)
  ON TABLE organizations TO buhuchet_app;
