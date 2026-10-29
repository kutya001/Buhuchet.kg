CREATE TABLE "news" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"release" text,
	"publish_date" date NOT NULL,
	"short" text NOT NULL,
	"md" text NOT NULL,
	"link_kind" text,
	"link_id" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"show_on_login" boolean DEFAULT true NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"off" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "news_id_check" CHECK ("news"."id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "news_type_check" CHECK ("news"."type" in ('update', 'feature', 'fix', 'announce')),
	CONSTRAINT "news_audience_check" CHECK ("news"."audience" in ('all', 'adm')),
	CONSTRAINT "news_status_check" CHECK ("news"."status" in ('draft', 'published')),
	CONSTRAINT "news_link_check" CHECK (("news"."link_kind" is null and "news"."link_id" is null) or ("news"."link_kind" in ('art', 'mod') and "news"."link_id" ~ '^[A-Za-z0-9_-]{1,64}$')),
	CONSTRAINT "news_published_check" CHECK (("news"."status" = 'published') = ("news"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "news" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "news_reads" (
	"user_id" uuid NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"news_id" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_reads_pk" PRIMARY KEY("user_id","news_id")
);
--> statement-breakpoint
ALTER TABLE "news_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news" ADD CONSTRAINT "news_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_news_id_news_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."news"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_reads" ADD CONSTRAINT "news_reads_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_publish_idx" ON "news" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "news_reads_news_idx" ON "news_reads" USING btree ("news_id");--> statement-breakpoint
CREATE INDEX "news_reads_org_idx" ON "news_reads" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "news_read" ON "news" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin() or ("news"."status" = 'published' and not "news"."off" and "news"."audience" = 'all' and ("news"."publish_date" + time '09:00') at time zone 'Asia/Bishkek' <= now()));--> statement-breakpoint
CREATE POLICY "news_admin_insert" ON "news" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "news_admin_update" ON "news" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "news_admin_delete" ON "news" AS PERMISSIVE FOR DELETE TO "buhuchet_app" USING (app.is_platform_admin() and "news"."status" = 'draft');--> statement-breakpoint
CREATE POLICY "news_reads_own" ON "news_reads" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("news_reads"."org_id" = app.current_org_id() and "news_reads"."user_id" = app.current_user_id()) WITH CHECK ("news_reads"."org_id" = app.current_org_id() and "news_reads"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "news_reads_platform_admin" ON "news_reads" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("news_reads"."org_id" is null and app.current_org_id() is null and "news_reads"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("news_reads"."org_id" is null and app.current_org_id() is null and "news_reads"."user_id" = app.current_user_id() and app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "news_reads_admin_count" ON "news_reads" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
ALTER POLICY "kb_article_reads_platform_admin" ON "kb_article_reads" TO buhuchet_app USING ("kb_article_reads"."org_id" is null and app.current_org_id() is null and "kb_article_reads"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("kb_article_reads"."org_id" is null and app.current_org_id() is null and "kb_article_reads"."user_id" = app.current_user_id() and app.is_platform_admin());--> statement-breakpoint
ALTER POLICY "kb_levels_platform_admin" ON "kb_levels" TO buhuchet_app USING ("kb_levels"."org_id" is null and app.current_org_id() is null and "kb_levels"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("kb_levels"."org_id" is null and app.current_org_id() is null and "kb_levels"."user_id" = app.current_user_id() and app.is_platform_admin());--> statement-breakpoint
ALTER POLICY "kb_progress_platform_admin" ON "kb_progress" TO buhuchet_app USING ("kb_progress"."org_id" is null and app.current_org_id() is null and "kb_progress"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("kb_progress"."org_id" is null and app.current_org_id() is null and "kb_progress"."user_id" = app.current_user_id() and app.is_platform_admin());