CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"login" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_login_unique" UNIQUE("login"),
	CONSTRAINT "users_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "users_org_or_platform_admin" CHECK (("users"."is_platform_admin" and "users"."org_id" is null) or (not "users"."is_platform_admin" and "users"."org_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"perm_group" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_id" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_scopes" (
	"org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"perm_group" text NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "role_scopes_role_id_perm_group_pk" PRIMARY KEY("role_id","perm_group"),
	CONSTRAINT "role_scopes_group_check" CHECK ("role_scopes"."perm_group" in ('cps', 'reports', 'fin', 'projects', 'kpi', 'files')),
	CONSTRAINT "role_scopes_scope_check" CHECK ("role_scopes"."scope" in ('own', 'all'))
);
--> statement-breakpoint
ALTER TABLE "role_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_templates" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] NOT NULL,
	"scopes" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"template_code" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_org_name_unique" UNIQUE("org_id","name"),
	CONSTRAINT "roles_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"short_name" text NOT NULL,
	"phone" text,
	"role_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "employees_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "employees_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"features" jsonb NOT NULL,
	"remind_days" integer[] DEFAULT '{7,3}' NOT NULL,
	"overdue_repeat" boolean DEFAULT true NOT NULL,
	"digest_time" time DEFAULT '09:00' NOT NULL,
	"timezone" text DEFAULT 'Asia/Bishkek' NOT NULL,
	"confirm_wait_days" integer DEFAULT 3 NOT NULL,
	"default_role_id" uuid,
	"task_confirm" boolean DEFAULT true NOT NULL,
	"report_confirm" boolean DEFAULT true NOT NULL,
	"pay_before_submit" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("role_id","org_id") REFERENCES "public"."roles"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_scopes" ADD CONSTRAINT "role_scopes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_scopes" ADD CONSTRAINT "role_scopes_role_fk" FOREIGN KEY ("role_id","org_id") REFERENCES "public"."roles"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_fk" FOREIGN KEY ("user_id","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_fk" FOREIGN KEY ("role_id","org_id") REFERENCES "public"."roles"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_default_role_fk" FOREIGN KEY ("default_role_id","org_id") REFERENCES "public"."roles"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_one_owner_idx" ON "roles" USING btree ("org_id") WHERE "roles"."is_owner";--> statement-breakpoint
CREATE INDEX "employees_org_idx" ON "employees" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "employees_role_idx" ON "employees" USING btree ("role_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_inn_unique" UNIQUE("inn");--> statement-breakpoint
CREATE POLICY "users_isolation" ON "users" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("users"."org_id" = app.current_org_id()) WITH CHECK ("users"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "permissions_read" ON "permissions" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "role_permissions_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("role_permissions"."org_id" = app.current_org_id()) WITH CHECK ("role_permissions"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "role_scopes_isolation" ON "role_scopes" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("role_scopes"."org_id" = app.current_org_id()) WITH CHECK ("role_scopes"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "role_templates_read" ON "role_templates" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "roles_isolation" ON "roles" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("roles"."org_id" = app.current_org_id()) WITH CHECK ("roles"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "employees_isolation" ON "employees" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("employees"."org_id" = app.current_org_id()) WITH CHECK ("employees"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "org_settings_isolation" ON "org_settings" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_settings"."org_id" = app.current_org_id()) WITH CHECK ("org_settings"."org_id" = app.current_org_id());