CREATE TABLE "org_report_types" (
	"org_id" uuid NOT NULL,
	"report_type_code" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"remind_days" integer[] NOT NULL,
	"need_file" boolean DEFAULT false NOT NULL,
	"need_receipt" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_report_types_org_id_report_type_code_pk" PRIMARY KEY("org_id","report_type_code"),
	CONSTRAINT "org_report_types_remind_days_check" CHECK (1 <= all("org_report_types"."remind_days") and 60 >= all("org_report_types"."remind_days"))
);
--> statement-breakpoint
ALTER TABLE "org_report_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_report_types" ADD CONSTRAINT "org_report_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_report_types" ADD CONSTRAINT "org_report_types_report_type_code_report_types_code_fk" FOREIGN KEY ("report_type_code") REFERENCES "public"."report_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_report_types" ADD CONSTRAINT "org_report_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_report_types" ADD CONSTRAINT "org_report_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_report_types_type_idx" ON "org_report_types" USING btree ("report_type_code");--> statement-breakpoint
CREATE POLICY "org_report_types_isolation" ON "org_report_types" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("org_report_types"."org_id" = app.current_org_id()) WITH CHECK ("org_report_types"."org_id" = app.current_org_id());