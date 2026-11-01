CREATE TABLE "one_off_service_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"service_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "one_off_service_payments_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "one_off_service_payments_amount_check" CHECK ("one_off_service_payments"."amount" > 0 and "one_off_service_payments"."amount" <= 1000000000000),
	CONSTRAINT "one_off_service_payments_note_check" CHECK (char_length("one_off_service_payments"."note") <= 500),
	CONSTRAINT "one_off_service_payments_delete_check" CHECK (("one_off_service_payments"."deleted_at" is null) = ("one_off_service_payments"."deleted_by" is null) and ("one_off_service_payments"."deleted_at" is null) = ("one_off_service_payments"."delete_reason" is null) and char_length(coalesce("one_off_service_payments"."delete_reason", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "one_off_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"contractor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"performer_employee_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "one_off_services_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "one_off_services_amount_check" CHECK ("one_off_services"."amount" > 0 and "one_off_services"."amount" <= 1000000000000),
	CONSTRAINT "one_off_services_text_check" CHECK (char_length(btrim("one_off_services"."name")) > 0 and char_length("one_off_services"."name") <= 300 and char_length("one_off_services"."description") <= 2000),
	CONSTRAINT "one_off_services_delete_check" CHECK (("one_off_services"."deleted_at" is null) = ("one_off_services"."deleted_by" is null) and ("one_off_services"."deleted_at" is null) = ("one_off_services"."delete_reason" is null) and char_length(coalesce("one_off_services"."delete_reason", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "one_off_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ADD CONSTRAINT "one_off_service_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ADD CONSTRAINT "one_off_service_payments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ADD CONSTRAINT "one_off_service_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ADD CONSTRAINT "one_off_service_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_payments" ADD CONSTRAINT "one_off_service_payments_service_fk" FOREIGN KEY ("service_id","org_id") REFERENCES "public"."one_off_services"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_contractor_fk" FOREIGN KEY ("contractor_id","org_id") REFERENCES "public"."contractors"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_services" ADD CONSTRAINT "one_off_services_performer_fk" FOREIGN KEY ("performer_employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_off_service_payments_service_idx" ON "one_off_service_payments" USING btree ("service_id","paid_on");--> statement-breakpoint
CREATE INDEX "one_off_services_contractor_idx" ON "one_off_services" USING btree ("org_id","contractor_id","service_date");--> statement-breakpoint
CREATE POLICY "one_off_service_payments_isolation" ON "one_off_service_payments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("one_off_service_payments"."org_id" = app.current_org_id()) WITH CHECK ("one_off_service_payments"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "one_off_services_isolation" ON "one_off_services" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("one_off_services"."org_id" = app.current_org_id()) WITH CHECK ("one_off_services"."org_id" = app.current_org_id());