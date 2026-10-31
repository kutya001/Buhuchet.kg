CREATE TABLE "closed_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"month" date NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_months_org_month_unique" UNIQUE("org_id","month"),
	CONSTRAINT "closed_months_month_check" CHECK ("closed_months"."month" = date_trunc('month', "closed_months"."month")::date)
);
--> statement-breakpoint
ALTER TABLE "closed_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "money_operations" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "closed_months" ADD CONSTRAINT "closed_months_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_months" ADD CONSTRAINT "closed_months_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "fee_payments_delete_receipt_part" ON "fee_payments" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING ("fee_payments"."operation_id" is not null);--> statement-breakpoint
CREATE POLICY "closed_months_isolation" ON "closed_months" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("closed_months"."org_id" = app.current_org_id()) WITH CHECK ("closed_months"."org_id" = app.current_org_id());