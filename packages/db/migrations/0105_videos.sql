CREATE TABLE "video_guest_stats" (
	"video_id" text PRIMARY KEY NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL,
	"pct_sum" real DEFAULT 0 NOT NULL,
	CONSTRAINT "video_guest_stats_check" CHECK ("video_guest_stats"."starts" >= 0 and "video_guest_stats"."pct_sum" >= 0)
);
--> statement-breakpoint
ALTER TABLE "video_guest_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "video_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"segs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_sessions_segs_check" CHECK (jsonb_typeof("video_sessions"."segs") = 'array')
);
--> statement-breakpoint
ALTER TABLE "video_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "video_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"s3_upload_id" text,
	"file_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"duration" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_uploads_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "video_uploads_kind_check" CHECK ("video_uploads"."kind" in ('video', 'cover')),
	CONSTRAINT "video_uploads_state_check" CHECK ("video_uploads"."state" in ('uploading', 'ready')),
	CONSTRAINT "video_uploads_type_check" CHECK (("video_uploads"."kind" = 'video' and "video_uploads"."content_type" in ('video/mp4', 'video/webm')) or ("video_uploads"."kind" = 'cover' and "video_uploads"."content_type" = 'image/jpeg')),
	CONSTRAINT "video_uploads_size_check" CHECK ("video_uploads"."size_bytes" between 1 and 524288000)
);
--> statement-breakpoint
ALTER TABLE "video_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "video_views" (
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"segs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pos" real DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"opens" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_views_pk" PRIMARY KEY("user_id","video_id"),
	CONSTRAINT "video_views_segs_check" CHECK (jsonb_typeof("video_views"."segs") = 'array'),
	CONSTRAINT "video_views_pos_check" CHECK ("video_views"."pos" >= 0 and "video_views"."opens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "video_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"yt_id" text,
	"file_key" text,
	"file_name" text,
	"file_size" bigint,
	"file_type" text,
	"duration" integer,
	"cover_key" text,
	"cover_kind" text,
	"description" text DEFAULT '' NOT NULL,
	"module" text,
	"article" text,
	"ord" integer DEFAULT 0 NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"off" boolean DEFAULT false NOT NULL,
	"landing" boolean DEFAULT false NOT NULL,
	"landing_ord" integer DEFAULT 1 NOT NULL,
	"yt_bad" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "videos_id_check" CHECK ("videos"."id" ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
	CONSTRAINT "videos_title_check" CHECK (char_length("videos"."title") between 1 and 120),
	CONSTRAINT "videos_description_check" CHECK (char_length("videos"."description") <= 1000),
	CONSTRAINT "videos_kind_check" CHECK ("videos"."kind" in ('instr', 'pres')),
	CONSTRAINT "videos_source_check" CHECK ("videos"."source" in ('file', 'yt')),
	CONSTRAINT "videos_audience_check" CHECK ("videos"."audience" in ('all', 'adm')),
	CONSTRAINT "videos_status_check" CHECK ("videos"."status" in ('draft', 'published')),
	CONSTRAINT "videos_yt_check" CHECK (("videos"."source" = 'yt') = ("videos"."yt_id" is not null) and ("videos"."yt_id" is null or "videos"."yt_id" ~ '^[A-Za-z0-9_-]{11}$')),
	CONSTRAINT "videos_file_check" CHECK (("videos"."source" = 'file' and ("videos"."file_key" is not null or "videos"."deleted_at" is not null) and "videos"."file_type" in ('video/mp4', 'video/webm') and "videos"."file_size" between 1 and 524288000) or ("videos"."source" = 'yt' and "videos"."file_key" is null)),
	CONSTRAINT "videos_duration_check" CHECK ("videos"."duration" is null or "videos"."duration" between 1 and 43200),
	CONSTRAINT "videos_cover_check" CHECK (("videos"."cover_key" is null) = ("videos"."cover_kind" is null) and ("videos"."cover_kind" is null or "videos"."cover_kind" in ('own', 'frame'))),
	CONSTRAINT "videos_module_check" CHECK (("videos"."module" is null or "videos"."module" ~ '^[a-z][a-z0-9]{0,31}$') and ("videos"."kind" <> 'instr' or "videos"."module" is not null)),
	CONSTRAINT "videos_article_check" CHECK ("videos"."article" is null or "videos"."article" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "videos_ord_check" CHECK ("videos"."ord" between 0 and 100000 and "videos"."landing_ord" between 1 and 100000),
	CONSTRAINT "videos_published_check" CHECK (("videos"."status" = 'published') = ("videos"."published_at" is not null)),
	CONSTRAINT "videos_landing_check" CHECK (not "videos"."landing" or ("videos"."status" = 'published' and "videos"."deleted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "videos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_progress" DROP CONSTRAINT "kb_progress_how_check";--> statement-breakpoint
ALTER TABLE "video_guest_stats" ADD CONSTRAINT "video_guest_stats_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_uploads" ADD CONSTRAINT "video_uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_sessions_view_idx" ON "video_sessions" USING btree ("org_id","user_id","video_id","opened_at");--> statement-breakpoint
CREATE INDEX "video_sessions_video_idx" ON "video_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "video_uploads_created_idx" ON "video_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "video_views_org_idx" ON "video_views" USING btree ("org_id","video_id");--> statement-breakpoint
CREATE INDEX "video_views_video_idx" ON "video_views" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "videos_module_idx" ON "videos" USING btree ("module");--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_how_check" CHECK ("kb_progress"."done_how" is null or "kb_progress"."done_how" in ('action', 'data', 'show', 'art', 'use', 'visit', 'hand', 'video'));--> statement-breakpoint
CREATE POLICY "video_guest_stats_admin_read" ON "video_guest_stats" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "video_sessions_isolation" ON "video_sessions" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING ("video_sessions"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "video_sessions_own_insert" ON "video_sessions" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("video_sessions"."org_id" = app.current_org_id() and "video_sessions"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "video_sessions_own_update" ON "video_sessions" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING ("video_sessions"."org_id" = app.current_org_id() and "video_sessions"."user_id" = app.current_user_id()) WITH CHECK ("video_sessions"."org_id" = app.current_org_id() and "video_sessions"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "video_sessions_platform_admin_read" ON "video_sessions" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "video_uploads_admin" ON "video_uploads" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (app.is_platform_admin() and "video_uploads"."created_by" = app.current_user_id()) WITH CHECK (app.is_platform_admin() and "video_uploads"."created_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "video_views_isolation" ON "video_views" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING ("video_views"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "video_views_own_insert" ON "video_views" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("video_views"."org_id" = app.current_org_id() and "video_views"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "video_views_own_update" ON "video_views" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING ("video_views"."org_id" = app.current_org_id() and "video_views"."user_id" = app.current_user_id()) WITH CHECK ("video_views"."org_id" = app.current_org_id() and "video_views"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "video_views_platform_admin_read" ON "video_views" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "videos_read" ON "videos" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (app.is_platform_admin() or ("videos"."status" = 'published' and not "videos"."off" and "videos"."deleted_at" is null and "videos"."audience" = 'all') or exists (select 1 from video_views w where w.video_id = "videos"."id"));--> statement-breakpoint
CREATE POLICY "videos_admin_insert" ON "videos" AS PERMISSIVE FOR INSERT TO "buhuchet_app" WITH CHECK (app.is_platform_admin());--> statement-breakpoint
CREATE POLICY "videos_admin_update" ON "videos" AS PERMISSIVE FOR UPDATE TO "buhuchet_app" USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());