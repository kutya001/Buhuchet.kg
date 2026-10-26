-- Время правки текста словаря ставит сама база: по числу текстов и времени последней правки API
-- узнаёт, что словарь изменился (uiTextsStamp). Так правка видна со следующего запроса, даже если
-- текст поменяли в таблице прямо, без updated_at (например, запросом в редакторе SQL).
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.touch_updated_at() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER ui_texts_touch BEFORE UPDATE ON ui_texts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
