CREATE TABLE "report_tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"line_key" text NOT NULL,
	"label" text NOT NULL,
	"rate" text DEFAULT '' NOT NULL,
	"cash" boolean,
	"revenue" bigint,
	"tax" bigint NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_tax_lines_key" UNIQUE("org_id","report_id","kind","line_key"),
	CONSTRAINT "report_tax_lines_kind_check" CHECK ("report_tax_lines"."kind" in ('rate', 'payment')),
	CONSTRAINT "report_tax_lines_amounts_check" CHECK ("report_tax_lines"."tax" >= 0 and ("report_tax_lines"."revenue" is null or "report_tax_lines"."revenue" >= 0))
);
--> statement-breakpoint
ALTER TABLE "report_tax_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_tax_lines" ADD CONSTRAINT "report_tax_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_tax_lines" ADD CONSTRAINT "report_tax_lines_report_fk" FOREIGN KEY ("report_id","org_id") REFERENCES "public"."reports"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "report_tax_lines_isolation" ON "report_tax_lines" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("report_tax_lines"."org_id" = app.current_org_id()) WITH CHECK ("report_tax_lines"."org_id" = app.current_org_id());