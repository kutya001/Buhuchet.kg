CREATE TABLE "org_onboarding" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_onboarding_state_check" CHECK ("org_onboarding"."state" in ('new', 'later', 'done'))
);
--> statement-breakpoint
ALTER TABLE "org_onboarding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "welcome_seen" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "welcome_seen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_onboarding" ADD CONSTRAINT "org_onboarding_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_onboarding" ADD CONSTRAINT "org_onboarding_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_seen" ADD CONSTRAINT "welcome_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_seen" ADD CONSTRAINT "welcome_seen_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_seen" ADD CONSTRAINT "welcome_seen_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "welcome_seen_org_idx" ON "welcome_seen" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "org_onboarding_isolation" ON "org_onboarding" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_onboarding"."org_id" = app.current_org_id()) WITH CHECK ("org_onboarding"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "welcome_seen_own" ON "welcome_seen" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("welcome_seen"."org_id" = app.current_org_id() and "welcome_seen"."user_id" = app.current_user_id()) WITH CHECK ("welcome_seen"."org_id" = app.current_org_id() and "welcome_seen"."user_id" = app.current_user_id());