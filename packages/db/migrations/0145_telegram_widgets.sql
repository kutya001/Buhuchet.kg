CREATE TABLE "telegram_widgets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"items" jsonb NOT NULL,
	"data" text NOT NULL,
	"sent_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_widgets_chat_check" CHECK ("telegram_widgets"."chat_id" > 0),
	CONSTRAINT "telegram_widgets_data_check" CHECK (octet_length("telegram_widgets"."data") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "telegram_widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_widgets" ADD CONSTRAINT "telegram_widgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_widgets" ADD CONSTRAINT "telegram_widgets_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_widgets_org_idx" ON "telegram_widgets" USING btree ("org_id","sent_on");--> statement-breakpoint
CREATE POLICY "telegram_widgets_isolation" ON "telegram_widgets" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_widgets"."org_id" = app.current_org_id()) WITH CHECK ("telegram_widgets"."org_id" = app.current_org_id());