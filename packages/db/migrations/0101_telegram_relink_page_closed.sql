CREATE TABLE "telegram_link_guards" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"chat_id" bigint,
	"free_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_link_guards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_relink_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"token_hash" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_relink_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_code_text_check";--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_link_guards" ADD CONSTRAINT "telegram_link_guards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_guards" ADD CONSTRAINT "telegram_link_guards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_guards" ADD CONSTRAINT "telegram_link_guards_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_relink_codes" ADD CONSTRAINT "telegram_relink_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_relink_codes" ADD CONSTRAINT "telegram_relink_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_relink_codes" ADD CONSTRAINT "telegram_relink_codes_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_relink_codes_user_idx" ON "telegram_relink_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_relink_codes_chat_idx" ON "telegram_relink_codes" USING btree ("chat_id","created_at");--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed'));--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_code_text_check" CHECK ("telegram_outbox"."kind" not in ('code', 'relink_code') or "telegram_outbox"."text" is null);--> statement-breakpoint
CREATE POLICY "telegram_link_guards_isolation" ON "telegram_link_guards" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_link_guards"."org_id" = app.current_org_id()) WITH CHECK ("telegram_link_guards"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "telegram_relink_codes_isolation" ON "telegram_relink_codes" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("telegram_relink_codes"."org_id" = app.current_org_id()) WITH CHECK ("telegram_relink_codes"."org_id" = app.current_org_id());