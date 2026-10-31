CREATE TABLE "money_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"operation_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "money_allocations_amount_check" CHECK ("money_allocations"."amount" > 0 and "money_allocations"."amount" <= 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "money_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "money_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"total" bigint,
	"op_date" date NOT NULL,
	"holder_kind" text NOT NULL,
	"holder_employee_id" uuid,
	"report_id" uuid,
	"self" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "money_operations_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "money_operations_kind_check" CHECK ("money_operations"."kind" in ('in', 'pay', 'bonus', 'refund', 'back', 'corr', 'xfer')),
	CONSTRAINT "money_operations_holder_check" CHECK ("money_operations"."holder_kind" in ('org', 'employee', 'client') and ("money_operations"."holder_kind" = 'employee') = ("money_operations"."holder_employee_id" is not null)),
	CONSTRAINT "money_operations_amount_check" CHECK (abs("money_operations"."amount") <= 1000000000000 and case "money_operations"."kind" when 'corr' then "money_operations"."amount" <> 0 when 'in' then "money_operations"."amount" >= 0 else "money_operations"."amount" > 0 end),
	CONSTRAINT "money_operations_total_check" CHECK (("money_operations"."kind" = 'in') = ("money_operations"."total" is not null) and ("money_operations"."total" is null or ("money_operations"."total" > 0 and "money_operations"."total" >= "money_operations"."amount" and "money_operations"."total" <= 1000000000000))),
	CONSTRAINT "money_operations_report_check" CHECK (("money_operations"."kind" not in ('pay', 'back') or "money_operations"."report_id" is not null) and ("money_operations"."kind" in ('pay', 'back') or "money_operations"."report_id" is null)),
	CONSTRAINT "money_operations_self_check" CHECK (("money_operations"."self" = ("money_operations"."holder_kind" = 'client')) and (not "money_operations"."self" or "money_operations"."kind" = 'pay')),
	CONSTRAINT "money_operations_cancel_check" CHECK (("money_operations"."cancelled_at" is null) = ("money_operations"."cancelled_by" is null) and ("money_operations"."cancelled_at" is null) = ("money_operations"."cancel_reason" is null) and char_length(coalesce("money_operations"."cancel_reason", '')) <= 500),
	CONSTRAINT "money_operations_note_check" CHECK (char_length("money_operations"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "money_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractors" ADD COLUMN "need_receipt_file" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "paid" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_operation_fk" FOREIGN KEY ("operation_id","org_id") REFERENCES "public"."money_operations"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_allocations" ADD CONSTRAINT "money_allocations_report_fk" FOREIGN KEY ("report_id","org_id") REFERENCES "public"."reports"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_holder_fk" FOREIGN KEY ("holder_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_report_fk" FOREIGN KEY ("report_id","org_id") REFERENCES "public"."reports"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "money_allocations_key" ON "money_allocations" USING btree ("operation_id","report_id");--> statement-breakpoint
CREATE INDEX "money_allocations_report_idx" ON "money_allocations" USING btree ("org_id","report_id");--> statement-breakpoint
CREATE INDEX "money_operations_contractor_idx" ON "money_operations" USING btree ("org_id","contractor_id","op_date");--> statement-breakpoint
CREATE INDEX "money_operations_report_idx" ON "money_operations" USING btree ("org_id","report_id") WHERE "money_operations"."report_id" is not null;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_paid_check" CHECK ("reports"."paid" >= 0);--> statement-breakpoint
CREATE POLICY "money_allocations_isolation" ON "money_allocations" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("money_allocations"."org_id" = app.current_org_id()) WITH CHECK ("money_allocations"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "money_operations_isolation" ON "money_operations" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("money_operations"."org_id" = app.current_org_id()) WITH CHECK ("money_operations"."org_id" = app.current_org_id());