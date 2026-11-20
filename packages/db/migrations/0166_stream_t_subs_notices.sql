CREATE TABLE "org_memory_notices" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_memory_notices_level_check" CHECK ("org_memory_notices"."level" in (0, 80, 100))
);
--> statement-breakpoint
ALTER TABLE "org_memory_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "org_memory_notices" ADD CONSTRAINT "org_memory_notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test', 'cp_tg_request', 'task_started', 'task_done', 'bot_ask', 'nudge', 'not_me', 'bot_cmd', 'group', 'cp_file', 'setup_link', 'sub', 'sub_check', 'storage_check'));--> statement-breakpoint
CREATE POLICY "org_memory_notices_isolation" ON "org_memory_notices" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_memory_notices"."org_id" = app.current_org_id()) WITH CHECK ("org_memory_notices"."org_id" = app.current_org_id());