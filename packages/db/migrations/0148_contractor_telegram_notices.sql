-- «К оплате» и «Оплата за обслуживание» по дням (доработки 14.11.2026, блок 3, этап 2, поток К). Само
-- «К оплате» уходит в каждый отмеченный день «за N» — одно на месяц, чат и день. Прежнее само (одно на
-- месяц и чат) получает день отправки по Бишкеку: в этот день оно уже ушло, второго в тот же день не будет.
-- Блокировки таблицы ждём не дольше 10 с, как в 0147: её трогают нажатия клиентов и задачи.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
UPDATE "contractor_telegram_messages"
  SET "day" = ("created_at" AT TIME ZONE 'Asia/Bishkek')::date
  WHERE "kind" = 'pay' AND "auto" AND "day" IS NULL;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" DROP CONSTRAINT "contractor_telegram_messages_kind_check";--> statement-breakpoint
DROP INDEX "contractor_telegram_messages_auto_key";--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_auto_key" ON "contractor_telegram_messages" USING btree ("link_id","month","day") WHERE "contractor_telegram_messages"."kind" = 'pay' and "contractor_telegram_messages"."auto";--> statement-breakpoint
-- Прежняя версия сайта пишет само «К оплате» без дня (day = null): миграции идут до выкладки нового кода,
-- а откат версии базу не откатывает. Такой строке день ставит база — день записи по Бишкеку; ключ по дню
-- не даст второго сообщения в тот же день. Убрать, когда прежней версии на сайтах не останется.
CREATE FUNCTION app.contractor_telegram_pay_day_default()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.kind = 'pay' AND NEW.auto AND NEW.day IS NULL THEN
      NEW.day := (pg_catalog.now() AT TIME ZONE 'Asia/Bishkek')::date;
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_telegram_pay_day_default() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
CREATE TRIGGER contractor_telegram_messages_pay_day_default
  BEFORE INSERT ON public.contractor_telegram_messages
  FOR EACH ROW
  EXECUTE FUNCTION app.contractor_telegram_pay_day_default();--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_pay_day_check" CHECK ("contractor_telegram_messages"."kind" <> 'pay' or not "contractor_telegram_messages"."auto" or "contractor_telegram_messages"."day" is not null);--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask', 'debt', 'fee', 'receipt'));