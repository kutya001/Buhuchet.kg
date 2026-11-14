-- Напоминание клиенту о долге в Telegram (доработки 13.11.2026, задача К5; прототип v94): права роли
-- приложения. «Напоминать о долге в Telegram» у контрагента выключает сотрудник в карточке (столбец
-- страницы контрагента), у своего чата — сам клиент кнопкой «Не напоминать» (столбец подключения).
-- Обратно клиентскую отметку роль приложения не снимает иначе, как новым значением этого же столбца.
GRANT UPDATE (tg_debt_off) ON TABLE contractor_pages TO buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (no_debt) ON TABLE contractor_telegram_links TO buhuchet_app;
--> statement-breakpoint
-- Отметка «Не напоминать» — выбор клиента: её меняет только транзакция без пользователя (нажатие и
-- команда клиента в боте идут без входа). Сотрудник выключает напоминание у контрагента своим
-- переключателем (`contractor_pages.tg_debt_off`), а клиентскую отметку не трогает.
CREATE FUNCTION app.contractor_telegram_no_debt_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.no_debt IS DISTINCT FROM OLD.no_debt AND app.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'contractor_telegram_links: отметку «Не напоминать» меняет только клиент'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_no_debt_guard() FROM PUBLIC, buhuchet_app;
--> statement-breakpoint
CREATE TRIGGER contractor_telegram_links_no_debt_guard
  BEFORE UPDATE OF no_debt ON contractor_telegram_links
  FOR EACH ROW
  EXECUTE FUNCTION app.contractor_telegram_no_debt_guard();
