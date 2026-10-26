CREATE TABLE "view_settings" (
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"grid_key" text NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_settings_pk" PRIMARY KEY("user_id","grid_key"),
	CONSTRAINT "view_settings_grid_key_check" CHECK ("view_settings"."grid_key" ~ '^[a-z][a-z0-9-]{0,30}\.[a-z][a-z0-9-]{0,30}$'),
	CONSTRAINT "view_settings_size_check" CHECK (octet_length("view_settings"."settings"::text) <= 32768)
);
--> statement-breakpoint
ALTER TABLE "view_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "view_settings" ADD CONSTRAINT "view_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_settings" ADD CONSTRAINT "view_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_settings" ADD CONSTRAINT "view_settings_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "view_settings_org_idx" ON "view_settings" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "view_settings_isolation" ON "view_settings" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("view_settings"."org_id" = app.current_org_id() and "view_settings"."user_id" = app.current_user_id()) WITH CHECK ("view_settings"."org_id" = app.current_org_id() and "view_settings"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "view_settings_platform_admin" ON "view_settings" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("view_settings"."org_id" is null and app.current_org_id() is null and "view_settings"."user_id" = app.current_user_id()) WITH CHECK ("view_settings"."org_id" is null and app.current_org_id() is null and "view_settings"."user_id" = app.current_user_id());