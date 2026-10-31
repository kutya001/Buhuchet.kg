CREATE TABLE "telegram_digest_days" (
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_digest_days_pk" PRIMARY KEY("org_id","day")
);
--> statement-breakpoint
ALTER TABLE "telegram_digest_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_notify_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"mode" text DEFAULT 'all' NOT NULL,
	"off" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "telegram_notify_settings_mode_check" CHECK ("telegram_notify_settings"."mode" in ('all', 'digest', 'manual')),
	CONSTRAINT "telegram_notify_settings_off_check" CHECK ("telegram_notify_settings"."off" <@ array['before', 'over', 'tasks', 'regtasks', 'week']::text[])
);
--> statement-breakpoint
ALTER TABLE "telegram_notify_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"tries" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_outbox_dedupe_key" UNIQUE("dedupe_key"),
	CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast')),
	CONSTRAINT "telegram_outbox_status_check" CHECK ("telegram_outbox"."status" in ('pending', 'sent', 'error')),
	CONSTRAINT "telegram_outbox_tries_check" CHECK ("telegram_outbox"."tries" >= 0),
	CONSTRAINT "telegram_outbox_code_text_check" CHECK ("telegram_outbox"."kind" <> 'code' or "telegram_outbox"."text" is null)
);
--> statement-breakpoint
ALTER TABLE "telegram_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_digest_days" ADD CONSTRAINT "telegram_digest_days_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_notify_settings" ADD CONSTRAINT "telegram_notify_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_notify_settings" ADD CONSTRAINT "telegram_notify_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_notify_settings" ADD CONSTRAINT "telegram_notify_settings_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_outbox_due_idx" ON "telegram_outbox" USING btree ("org_id","next_at") WHERE "telegram_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "telegram_outbox_org_created_idx" ON "telegram_outbox" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "telegram_digest_days_isolation" ON "telegram_digest_days" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_digest_days"."org_id" = app.current_org_id()) WITH CHECK ("telegram_digest_days"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "telegram_notify_settings_isolation" ON "telegram_notify_settings" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_notify_settings"."org_id" = app.current_org_id()) WITH CHECK ("telegram_notify_settings"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "telegram_outbox_isolation" ON "telegram_outbox" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_outbox"."org_id" = app.current_org_id()) WITH CHECK ("telegram_outbox"."org_id" = app.current_org_id());