CREATE TABLE "project_members" (
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "project_members_pk" PRIMARY KEY("project_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"executor_employee_id" uuid NOT NULL,
	"due_date" date,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_works_name_check" CHECK (char_length(btrim("project_works"."name")) > 0 and char_length("project_works"."name") <= 300)
);
--> statement-breakpoint
ALTER TABLE "project_works" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"plan" bigint,
	"status" text DEFAULT 'planned' NOT NULL,
	"lead_employee_id" uuid NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "projects_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "projects_id_contractor_org_unique" UNIQUE("id","contractor_id","org_id"),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('planned', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "projects_dates_check" CHECK ("projects"."ends_on" >= "projects"."starts_on"),
	CONSTRAINT "projects_plan_check" CHECK ("projects"."plan" is null or ("projects"."plan" >= 0 and "projects"."plan" <= 1000000000000)),
	CONSTRAINT "projects_text_check" CHECK (char_length(btrim("projects"."name")) > 0 and char_length("projects"."name") <= 300 and char_length("projects"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_works" ADD CONSTRAINT "project_works_executor_fk" FOREIGN KEY ("executor_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_fk" FOREIGN KEY ("lead_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_employee_idx" ON "project_members" USING btree ("org_id","employee_id");--> statement-breakpoint
CREATE INDEX "project_works_project_idx" ON "project_works" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "projects_contractor_idx" ON "projects" USING btree ("org_id","contractor_id");--> statement-breakpoint
CREATE INDEX "projects_ends_idx" ON "projects" USING btree ("org_id","ends_on");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("project_id","contractor_id","org_id") REFERENCES "public"."projects"("id","contractor_id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("org_id","project_id") WHERE "tasks"."project_id" is not null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_check" CHECK ("tasks"."project_id" is null or "tasks"."contractor_id" is not null);--> statement-breakpoint
CREATE POLICY "project_members_isolation" ON "project_members" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("project_members"."org_id" = app.current_org_id()) WITH CHECK ("project_members"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "project_works_isolation" ON "project_works" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("project_works"."org_id" = app.current_org_id()) WITH CHECK ("project_works"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "project_works_delete_open" ON "project_works" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING (not "project_works"."done");--> statement-breakpoint
CREATE POLICY "projects_isolation" ON "projects" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("projects"."org_id" = app.current_org_id()) WITH CHECK ("projects"."org_id" = app.current_org_id());