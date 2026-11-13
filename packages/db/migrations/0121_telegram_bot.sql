ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "telegram_actions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "via" text DEFAULT nullif(current_setting('app.via', true), '');--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "plain_text" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD COLUMN "message_id" bigint;--> statement-breakpoint
ALTER TABLE "status_history" ADD COLUMN "via" text DEFAULT nullif(current_setting('app.via', true), '');--> statement-breakpoint
CREATE INDEX "telegram_outbox_message_idx" ON "telegram_outbox" USING btree ("chat_id","message_id") WHERE "telegram_outbox"."message_id" is not null and "telegram_outbox"."payload" is not null;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_via_check" CHECK ("audit_log"."via" is null or "audit_log"."via" = 'telegram');--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_code_payload_check" CHECK ("telegram_outbox"."kind" not in ('code', 'relink_code') or "telegram_outbox"."payload" is null);--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert', 'relink_code', 'page_closed', 'bot_test'));--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_via_check" CHECK ("status_history"."via" is null or "status_history"."via" = 'telegram');