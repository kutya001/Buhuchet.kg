CREATE TABLE "project_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"project_id" uuid NOT NULL,
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
	CONSTRAINT "project_payments_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "project_payments_amount_check" CHECK ("project_payments"."amount" > 0 and "project_payments"."amount" <= 1000000000000),
	CONSTRAINT "project_payments_note_check" CHECK (char_length("project_payments"."note") <= 500),
	CONSTRAINT "project_payments_delete_check" CHECK (("project_payments"."deleted_at" is null) = ("project_payments"."deleted_by" is null) and ("project_payments"."deleted_at" is null) = ("project_payments"."delete_reason" is null) and char_length(coalesce("project_payments"."delete_reason", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "project_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_payments" ADD CONSTRAINT "project_payments_project_fk" FOREIGN KEY ("project_id","org_id") REFERENCES "public"."projects"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_payments_project_idx" ON "project_payments" USING btree ("project_id","paid_on");--> statement-breakpoint
CREATE POLICY "project_payments_isolation" ON "project_payments" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("project_payments"."org_id" = app.current_org_id()) WITH CHECK ("project_payments"."org_id" = app.current_org_id());