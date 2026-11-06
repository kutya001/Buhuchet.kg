-- Раздел «Файлы» страницы контрагента (решение заказчика 06.11.2026, прототип v74; ТЗ «Страница
-- контрагента по ссылке» → «Файлы», «Файловый менеджер» → «Показ файла на странице контрагента»):
-- раздел в галочках учётной политики и блока «Страница контрагента» после «Отчётов»; отметка файла
-- «скрыт со страницы контрагента» — у самого файла, меняет её роль приложения (право «Управлять
-- страницей контрагента» проверяет API). Организациям, созданным раньше, раздел добавляется
-- отмеченным (по умолчанию все разделы; прототип v74, миграция v74 в core/data.js); повтор ничего не меняет.
ALTER TABLE "contractor_pages" DROP CONSTRAINT "contractor_pages_hidden_check";--> statement-breakpoint
ALTER TABLE "org_settings" ALTER COLUMN "page_sections" SET DEFAULT '{pay,reports,files,money,fee,kpi,contacts}';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "page_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_hidden_check" CHECK ("contractor_pages"."hidden_sections" <@ array['pay', 'reports', 'files', 'money', 'fee', 'kpi', 'contacts']::text[]);--> statement-breakpoint
GRANT UPDATE (page_hidden) ON TABLE files TO buhuchet_app;--> statement-breakpoint
UPDATE org_settings s
  SET page_sections = (
    SELECT array_agg(x ORDER BY array_position(
      ARRAY['pay', 'reports', 'files', 'money', 'fee', 'kpi', 'contacts']::text[], x))
    FROM unnest(s.page_sections || ARRAY['files']::text[]) AS x
  )
  WHERE NOT ('files' = ANY (s.page_sections));
