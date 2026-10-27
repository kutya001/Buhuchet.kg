CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid DEFAULT app.current_user_id() NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comments_text_check" CHECK (char_length(btrim("task_comments"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_code" text NOT NULL,
	"contractor_id" uuid,
	"executor_employee_id" uuid NOT NULL,
	"author_employee_id" uuid NOT NULL,
	"term" text DEFAULT 'day' NOT NULL,
	"due_date" date NOT NULL,
	"need_file" boolean DEFAULT false NOT NULL,
	"confirm" boolean NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"done_at" timestamp with time zone,
	"fail_reason" text DEFAULT '' NOT NULL,
	"rework_reason" text DEFAULT '' NOT NULL,
	"rework_by_employee_id" uuid,
	"confirmed_by_employee_id" uuid,
	"confirmed_at" timestamp with time zone,
	"confirm_note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tasks_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "tasks_title_check" CHECK (char_length(btrim("tasks"."title")) > 0),
	CONSTRAINT "tasks_term_check" CHECK ("tasks"."term" in ('day', 'month')),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('todo', 'in_progress', 'rework', 'on_confirm', 'confirmed', 'done', 'failed', 'cancelled')),
	CONSTRAINT "tasks_month_due_check" CHECK ("tasks"."term" <> 'month' or "tasks"."due_date" = (date_trunc('month', "tasks"."due_date") + interval '1 month - 1 day')::date),
	CONSTRAINT "tasks_confirm_status_check" CHECK ("tasks"."confirm" or "tasks"."status" not in ('on_confirm', 'confirmed', 'rework')),
	CONSTRAINT "tasks_confirmed_check" CHECK ("tasks"."status" <> 'confirmed' or ("tasks"."confirmed_by_employee_id" is not null and "tasks"."confirmed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fk" FOREIGN KEY ("task_id","org_id") REFERENCES "public"."tasks"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_code_task_categories_code_fk" FOREIGN KEY ("category_code") REFERENCES "public"."task_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_executor_fk" FOREIGN KEY ("executor_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_author_fk" FOREIGN KEY ("author_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_rework_by_fk" FOREIGN KEY ("rework_by_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_confirmed_by_fk" FOREIGN KEY ("confirmed_by_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("org_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_executor_idx" ON "tasks" USING btree ("org_id","executor_employee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_author_idx" ON "tasks" USING btree ("org_id","author_employee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_contractor_idx" ON "tasks" USING btree ("org_id","contractor_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("org_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_pending_idx" ON "tasks" USING btree ("org_id") WHERE "tasks"."status" = 'on_confirm';--> statement-breakpoint
CREATE UNIQUE INDEX "task_categories_name_key" ON "task_categories" USING btree ("name");--> statement-breakpoint
CREATE POLICY "task_comments_isolation" ON "task_comments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("task_comments"."org_id" = app.current_org_id()) WITH CHECK ("task_comments"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "task_comments_insert_own" ON "task_comments" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("task_comments"."author_user_id" = app.current_user_id() and "task_comments"."created_at" = now());--> statement-breakpoint
CREATE POLICY "tasks_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("tasks"."org_id" = app.current_org_id()) WITH CHECK ("tasks"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "task_categories_read" ON "task_categories" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);