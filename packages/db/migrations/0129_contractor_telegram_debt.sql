ALTER TABLE "contractor_telegram_messages" DROP CONSTRAINT "contractor_telegram_messages_kind_check";--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD COLUMN "tg_debt_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ADD COLUMN "no_debt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD COLUMN "week" date;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "cp_tg_debt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_debt_key" ON "contractor_telegram_messages" USING btree ("link_id","week") WHERE "contractor_telegram_messages"."kind" = 'debt';--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_debt_check" CHECK (("contractor_telegram_messages"."kind" = 'debt') = ("contractor_telegram_messages"."week" is not null) and ("contractor_telegram_messages"."kind" <> 'debt' or ("contractor_telegram_messages"."total" is not null and "contractor_telegram_messages"."total" > 0)));--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask', 'debt'));