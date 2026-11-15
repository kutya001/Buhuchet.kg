-- «К оплате» и «Оплата за обслуживание» по дням (доработки 14.11.2026, блок 3, этап 2, поток К). Само
-- «К оплате» уходит в каждый отмеченный день «за N» — одно на месяц, чат и день. Прежнее само (одно на
-- месяц и чат) получает день отправки по Бишкеку: в этот день оно уже ушло, второго в тот же день не будет.
UPDATE "contractor_telegram_messages"
  SET "day" = ("created_at" AT TIME ZONE 'Asia/Bishkek')::date
  WHERE "kind" = 'pay' AND "auto" AND "day" IS NULL;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" DROP CONSTRAINT "contractor_telegram_messages_kind_check";--> statement-breakpoint
DROP INDEX "contractor_telegram_messages_auto_key";--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_auto_key" ON "contractor_telegram_messages" USING btree ("link_id","month","day") WHERE "contractor_telegram_messages"."kind" = 'pay' and "contractor_telegram_messages"."auto";--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_pay_day_check" CHECK ("contractor_telegram_messages"."kind" <> 'pay' or not "contractor_telegram_messages"."auto" or "contractor_telegram_messages"."day" is not null);--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask', 'debt', 'fee', 'receipt'));