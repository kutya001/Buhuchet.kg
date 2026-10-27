CREATE TABLE "kb_article_reads" (
	"user_id" uuid NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"article_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_reads_pk" PRIMARY KEY("user_id","article_id"),
	CONSTRAINT "kb_article_reads_article_check" CHECK ("kb_article_reads"."article_id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "kb_article_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_levels" (
	"user_id" uuid NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"level" smallint NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_levels_pk" PRIMARY KEY("user_id","level"),
	CONSTRAINT "kb_levels_level_check" CHECK ("kb_levels"."level" between 0 and 20)
);
--> statement-breakpoint
ALTER TABLE "kb_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "kb_progress" (
	"user_id" uuid NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"step_id" text NOT NULL,
	"done_how" text,
	"done_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	CONSTRAINT "kb_progress_pk" PRIMARY KEY("user_id","step_id"),
	CONSTRAINT "kb_progress_step_check" CHECK ("kb_progress"."step_id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "kb_progress_how_check" CHECK ("kb_progress"."done_how" is null or "kb_progress"."done_how" in ('action', 'data', 'show', 'art', 'use', 'visit')),
	CONSTRAINT "kb_progress_done_check" CHECK (("kb_progress"."done_how" is null) = ("kb_progress"."done_at" is null))
);
--> statement-breakpoint
ALTER TABLE "kb_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_article_reads" ADD CONSTRAINT "kb_article_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_reads" ADD CONSTRAINT "kb_article_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_reads" ADD CONSTRAINT "kb_article_reads_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_levels" ADD CONSTRAINT "kb_levels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_levels" ADD CONSTRAINT "kb_levels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_levels" ADD CONSTRAINT "kb_levels_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_article_reads_org_idx" ON "kb_article_reads" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kb_levels_org_idx" ON "kb_levels" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kb_progress_org_idx" ON "kb_progress" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("org_id","actor_user_id","entity","at");--> statement-breakpoint
CREATE POLICY "kb_article_reads_isolation" ON "kb_article_reads" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING ("kb_article_reads"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "kb_article_reads_own_insert" ON "kb_article_reads" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("kb_article_reads"."org_id" = app.current_org_id() and "kb_article_reads"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_article_reads_own_update" ON "kb_article_reads" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING ("kb_article_reads"."org_id" = app.current_org_id() and "kb_article_reads"."user_id" = app.current_user_id()) WITH CHECK ("kb_article_reads"."org_id" = app.current_org_id() and "kb_article_reads"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_article_reads_platform_admin" ON "kb_article_reads" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("kb_article_reads"."org_id" is null and app.current_org_id() is null and "kb_article_reads"."user_id" = app.current_user_id()) WITH CHECK ("kb_article_reads"."org_id" is null and app.current_org_id() is null and "kb_article_reads"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_levels_isolation" ON "kb_levels" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING ("kb_levels"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "kb_levels_own_insert" ON "kb_levels" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("kb_levels"."org_id" = app.current_org_id() and "kb_levels"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_levels_own_update" ON "kb_levels" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING ("kb_levels"."org_id" = app.current_org_id() and "kb_levels"."user_id" = app.current_user_id()) WITH CHECK ("kb_levels"."org_id" = app.current_org_id() and "kb_levels"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_levels_platform_admin" ON "kb_levels" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("kb_levels"."org_id" is null and app.current_org_id() is null and "kb_levels"."user_id" = app.current_user_id()) WITH CHECK ("kb_levels"."org_id" is null and app.current_org_id() is null and "kb_levels"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_progress_isolation" ON "kb_progress" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING ("kb_progress"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "kb_progress_own_insert" ON "kb_progress" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("kb_progress"."org_id" = app.current_org_id() and "kb_progress"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_progress_own_update" ON "kb_progress" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING ("kb_progress"."org_id" = app.current_org_id() and "kb_progress"."user_id" = app.current_user_id()) WITH CHECK ("kb_progress"."org_id" = app.current_org_id() and "kb_progress"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_progress_platform_admin" ON "kb_progress" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("kb_progress"."org_id" is null and app.current_org_id() is null and "kb_progress"."user_id" = app.current_user_id()) WITH CHECK ("kb_progress"."org_id" is null and app.current_org_id() is null and "kb_progress"."user_id" = app.current_user_id());