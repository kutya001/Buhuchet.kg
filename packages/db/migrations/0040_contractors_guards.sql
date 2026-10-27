-- Журнал тарифов обслуживания (ТЗ «Плата за обслуживание»): запись не меняется и не удаляется, новая
-- ставка — новая запись. Вместе с контрагентом записи удаляет каскад внешнего ключа.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE contractor_tariffs FROM buhuchet_app;
--> statement-breakpoint
-- История в карточке контрагента: запись истории ссылается на контрагента своей организации. Удалённый
-- контрагент (без отчётов, денег и проектов) оставляет записи истории, у них пропадает только ссылка.
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_contractor_fk FOREIGN KEY (contractor_id, org_id)
  REFERENCES contractors (id, org_id) ON DELETE SET NULL (contractor_id);
--> statement-breakpoint
-- Файл записи ссылается на контрагента своей организации (ключ, обещанный задачей 2.04 «Файлы»). Удалённый
-- контрагент (без отчётов, денег и проектов) оставляет файлы общими файлами организации.
ALTER TABLE files
  ADD CONSTRAINT files_contractor_fk FOREIGN KEY (contractor_id, org_id)
  REFERENCES contractors (id, org_id) ON DELETE SET NULL (contractor_id);
