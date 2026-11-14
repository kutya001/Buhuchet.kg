CREATE TABLE "telegram_group_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_group_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_groups" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"title" text NOT NULL,
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" boolean DEFAULT true NOT NULL,
	"gone_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "telegram_groups_chat_key" UNIQUE("chat_id"),
	CONSTRAINT "telegram_groups_chat_check" CHECK ("telegram_groups"."chat_id" < 0),
	CONSTRAINT "telegram_groups_title_check" CHECK (char_length("telegram_groups"."title") between 1 and 128)
);
--> statement-breakpoint
ALTER TABLE "telegram_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_group_tokens" ADD CONSTRAINT "telegram_group_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_group_tokens" ADD CONSTRAINT "telegram_group_tokens_user_org_fk" FOREIGN KEY ("created_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_groups" ADD CONSTRAINT "telegram_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_groups" ADD CONSTRAINT "telegram_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_groups" ADD CONSTRAINT "telegram_groups_linked_by_fk" FOREIGN KEY ("linked_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_group_tokens_org_idx" ON "telegram_group_tokens" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group'));--> statement-breakpoint
CREATE POLICY "telegram_group_tokens_isolation" ON "telegram_group_tokens" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_group_tokens"."org_id" = app.current_org_id()) WITH CHECK ("telegram_group_tokens"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "telegram_groups_isolation" ON "telegram_groups" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_groups"."org_id" = app.current_org_id()) WITH CHECK ("telegram_groups"."org_id" = app.current_org_id());