CREATE TABLE "contractor_page_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"contractor_id" uuid NOT NULL,
	"code_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractor_page_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contractor_pages" (
	"contractor_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"code" text NOT NULL,
	"code_version" integer DEFAULT 1 NOT NULL,
	"hidden_sections" text[] DEFAULT '{}' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contractor_pages_code_check" CHECK ("contractor_pages"."code" ~ '^[0-9]{6}$'),
	CONSTRAINT "contractor_pages_hidden_check" CHECK ("contractor_pages"."hidden_sections" <@ array['pay', 'reports', 'money', 'fee', 'kpi', 'contacts']::text[]),
	CONSTRAINT "contractor_pages_failures_check" CHECK ("contractor_pages"."failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "contractor_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_page_grants" ADD CONSTRAINT "contractor_page_grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_page_grants" ADD CONSTRAINT "contractor_page_grants_contractor_id_contractor_pages_contractor_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractor_pages"("contractor_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_pages" ADD CONSTRAINT "contractor_pages_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contractor_page_grants_expires_idx" ON "contractor_page_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "contractor_page_grants_contractor_idx" ON "contractor_page_grants" USING btree ("contractor_id");--> statement-breakpoint
CREATE POLICY "contractor_page_grants_isolation" ON "contractor_page_grants" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_page_grants"."org_id" = app.current_org_id()) WITH CHECK ("contractor_page_grants"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "contractor_pages_isolation" ON "contractor_pages" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("contractor_pages"."org_id" = app.current_org_id()) WITH CHECK ("contractor_pages"."org_id" = app.current_org_id());