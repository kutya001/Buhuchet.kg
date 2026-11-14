CREATE TABLE "contractor_telegram_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" bigint,
	"kind" text NOT NULL,
	"month" text,
	"total" bigint,
	"auto" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_telegram_messages_kind_check" CHECK ("contractor_telegram_messages"."kind" in ('pay', 'ask')),
	CONSTRAINT "contractor_telegram_messages_month_check" CHECK ("contractor_telegram_messages"."month" is null or "contractor_telegram_messages"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "contractor_telegram_messages_pay_check" CHECK ("contractor_telegram_messages"."kind" <> 'pay' or ("contractor_telegram_messages"."month" is not null and "contractor_telegram_messages"."total" is not null and "contractor_telegram_messages"."total" > 0))
);
--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "cp_tg_pay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_links_scope_key" ON "contractor_telegram_links" USING btree ("id","org_id","contractor_id","chat_id");--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_messages" ADD CONSTRAINT "contractor_telegram_messages_link_fk" FOREIGN KEY ("link_id","org_id","contractor_id","chat_id") REFERENCES "public"."contractor_telegram_links"("id","org_id","contractor_id","chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_chat_key" ON "contractor_telegram_messages" USING btree ("chat_id","message_id") WHERE "contractor_telegram_messages"."message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_messages_auto_key" ON "contractor_telegram_messages" USING btree ("link_id","month") WHERE "contractor_telegram_messages"."kind" = 'pay' and "contractor_telegram_messages"."auto";--> statement-breakpoint
CREATE INDEX "contractor_telegram_messages_contractor_idx" ON "contractor_telegram_messages" USING btree ("org_id","contractor_id","created_at");--> statement-breakpoint
CREATE POLICY "contractor_telegram_messages_isolation" ON "contractor_telegram_messages" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_telegram_messages"."org_id" = app.current_org_id()) WITH CHECK ("contractor_telegram_messages"."org_id" = app.current_org_id());