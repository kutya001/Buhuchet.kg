CREATE TABLE "dues_recalcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"reports" integer DEFAULT 0 NOT NULL,
	"orgs" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "dues_recalcs_kind_check" CHECK ("dues_recalcs"."kind" in ('types', 'statuses', 'calendar')),
	CONSTRAINT "dues_recalcs_counts_check" CHECK (least("dues_recalcs"."attempts", "dues_recalcs"."reports", "dues_recalcs"."orgs") >= 0)
);
--> statement-breakpoint
ALTER TABLE "dues_recalcs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dues_recalcs" ADD CONSTRAINT "dues_recalcs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dues_recalcs_pending_idx" ON "dues_recalcs" USING btree ("created_at") WHERE "dues_recalcs"."done_at" is null;--> statement-breakpoint
CREATE POLICY "dues_recalcs_service" ON "dues_recalcs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (true) WITH CHECK (true);