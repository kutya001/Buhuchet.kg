CREATE TABLE "scheduler_jobs" (
	"job" text PRIMARY KEY NOT NULL,
	"last_slot" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"fails" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"alert" text,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "scheduler_jobs_fails_check" CHECK ("scheduler_jobs"."fails" >= 0),
	CONSTRAINT "scheduler_jobs_alert_check" CHECK ("scheduler_jobs"."alert" in ('failing', 'missed'))
);
--> statement-breakpoint
ALTER TABLE "scheduler_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "scheduler_runs_unfinished_idx" ON "scheduler_runs" USING btree ("started_at") WHERE "scheduler_runs"."finished_at" is null;--> statement-breakpoint
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_attempts_check" CHECK ("scheduler_runs"."attempts" >= 1);--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead', 'login_locked', 'alert'));--> statement-breakpoint
CREATE POLICY "scheduler_jobs_service" ON "scheduler_jobs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (true) WITH CHECK (true);