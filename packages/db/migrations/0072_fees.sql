CREATE TABLE "fee_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"payment_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "fee_allocations_amount_check" CHECK ("fee_allocations"."amount" > 0 and "fee_allocations"."amount" <= 1000000000000),
	CONSTRAINT "fee_allocations_month_check" CHECK ("fee_allocations"."month" = date_trunc('month', "fee_allocations"."month")::date)
);
--> statement-breakpoint
ALTER TABLE "fee_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"to_kind" text NOT NULL,
	"to_account_id" uuid,
	"to_label" text DEFAULT '' NOT NULL,
	"operation_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fee_payments_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "fee_payments_amount_check" CHECK ("fee_payments"."amount" > 0 and "fee_payments"."amount" <= 1000000000000),
	CONSTRAINT "fee_payments_to_check" CHECK ("fee_payments"."to_kind" in ('org', 'owner') and ("fee_payments"."to_kind" = 'org' or "fee_payments"."to_account_id" is null) and char_length("fee_payments"."to_label") <= 300),
	CONSTRAINT "fee_payments_note_check" CHECK (char_length("fee_payments"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "fee_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "one_sum" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_allocations" ADD CONSTRAINT "fee_allocations_payment_fk" FOREIGN KEY ("payment_id","org_id") REFERENCES "public"."fee_payments"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_operation_fk" FOREIGN KEY ("operation_id","org_id") REFERENCES "public"."money_operations"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_allocations_key" ON "fee_allocations" USING btree ("payment_id","month");--> statement-breakpoint
CREATE INDEX "fee_payments_contractor_idx" ON "fee_payments" USING btree ("org_id","contractor_id","paid_on");--> statement-breakpoint
CREATE INDEX "fee_payments_operation_idx" ON "fee_payments" USING btree ("operation_id") WHERE "fee_payments"."operation_id" is not null;--> statement-breakpoint
CREATE POLICY "fee_allocations_isolation" ON "fee_allocations" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("fee_allocations"."org_id" = app.current_org_id()) WITH CHECK ("fee_allocations"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "fee_payments_isolation" ON "fee_payments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("fee_payments"."org_id" = app.current_org_id()) WITH CHECK ("fee_payments"."org_id" = app.current_org_id());