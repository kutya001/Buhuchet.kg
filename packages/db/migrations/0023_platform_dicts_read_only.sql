-- Справочники платформы для контрагентов и отчётов (миграция 0022) роль приложения только читает: права на
-- запись по умолчанию (миграция 0000) у неё забираются, как у ui_texts (0017). Так ни ошибка в коде, ни
-- подменённый запрос не изменят каталог видов отчётов, режимы или календарь всех организаций и не
-- заблокируют эти таблицы; правку из Админки (поток Д) сделает узкая функция для администратора платформы.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  authorities,
  tax_regimes,
  report_bases,
  tax_offices,
  report_types,
  report_type_regimes,
  report_type_bases,
  tax_benefits,
  tax_benefit_report_types,
  tax_benefit_offices,
  tax_benefit_due_rules,
  production_calendar
FROM buhuchet_app;
