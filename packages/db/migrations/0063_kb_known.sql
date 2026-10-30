CREATE TABLE "kb_known" (
	"user_id" uuid NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id(),
	"key" text NOT NULL,
	"known_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_known_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "kb_known_key_check" CHECK (char_length("kb_known"."key") between 3 and 300 and "kb_known"."key" ~ '^[gs]:')
);
--> statement-breakpoint
ALTER TABLE "kb_known" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_known" ADD CONSTRAINT "kb_known_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_known" ADD CONSTRAINT "kb_known_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_known" ADD CONSTRAINT "kb_known_user_org_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_known_org_idx" ON "kb_known" USING btree ("org_id");--> statement-breakpoint
CREATE POLICY "kb_known_own" ON "kb_known" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("kb_known"."org_id" = app.current_org_id() and "kb_known"."user_id" = app.current_user_id()) WITH CHECK ("kb_known"."org_id" = app.current_org_id() and "kb_known"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "kb_known_platform_admin" ON "kb_known" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("kb_known"."org_id" is null and app.current_org_id() is null and "kb_known"."user_id" = app.current_user_id() and app.is_platform_admin()) WITH CHECK ("kb_known"."org_id" is null and app.current_org_id() is null and "kb_known"."user_id" = app.current_user_id() and app.is_platform_admin());