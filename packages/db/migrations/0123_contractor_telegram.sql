CREATE TABLE "contractor_telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'wait' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"by_client" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contractor_telegram_links_status_check" CHECK ("contractor_telegram_links"."status" in ('wait', 'on', 'no', 'off')),
	CONSTRAINT "contractor_telegram_links_name_check" CHECK (char_length("contractor_telegram_links"."name") between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_telegram_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_chat_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractor_telegram_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_pages" DROP CONSTRAINT "contractor_pages_hidden_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "org_settings" ALTER COLUMN "page_sections" SET DEFAULT '{pay,reports,files,money,fee,kpi,contacts,tg}';--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ADD CONSTRAINT "contractor_telegram_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ADD CONSTRAINT "contractor_telegram_links_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ADD CONSTRAINT "contractor_telegram_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_links" ADD CONSTRAINT "contractor_telegram_links_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_tokens" ADD CONSTRAINT "contractor_telegram_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_tokens" ADD CONSTRAINT "contractor_telegram_tokens_contractor_id_contractor_pages_contractor_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractor_pages"("contractor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_telegram_tokens" ADD CONSTRAINT "contractor_telegram_tokens_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_telegram_links_contractor_idx" ON "contractor_telegram_links" USING btree ("org_id","contractor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_telegram_links_active_key" ON "contractor_telegram_links" USING btree ("contractor_id","chat_id") WHERE "contractor_telegram_links"."status" in ('wait', 'on');--> statement-breakpoint
CREATE INDEX "contractor_telegram_links_chat_idx" ON "contractor_telegram_links" USING btree ("chat_id") WHERE "contractor_telegram_links"."status" = 'on';--> statement-breakpoint
CREATE INDEX "contractor_telegram_tokens_contractor_idx" ON "contractor_telegram_tokens" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "contractor_telegram_tokens_expires_idx" ON "contractor_telegram_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_hidden_check" CHECK ("contractor_pages"."hidden_sections" <@ array['pay', 'reports', 'files', 'money', 'fee', 'kpi', 'contacts', 'tg']::text[]);--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request'));--> statement-breakpoint
CREATE POLICY "contractor_telegram_links_isolation" ON "contractor_telegram_links" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_telegram_links"."org_id" = app.current_org_id()) WITH CHECK ("contractor_telegram_links"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_telegram_tokens_isolation" ON "contractor_telegram_tokens" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_telegram_tokens"."org_id" = app.current_org_id()) WITH CHECK ("contractor_telegram_tokens"."org_id" = app.current_org_id());