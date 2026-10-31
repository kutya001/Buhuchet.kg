ALTER TABLE "money_operations" ADD COLUMN "ref_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_ref_fk" FOREIGN KEY ("ref_operation_id","org_id") REFERENCES "public"."money_operations"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "money_operations_ref_idx" ON "money_operations" USING btree ("ref_operation_id") WHERE "money_operations"."ref_operation_id" is not null;--> statement-breakpoint
ALTER TABLE "money_operations" ADD CONSTRAINT "money_operations_ref_check" CHECK ("money_operations"."ref_operation_id" is null or "money_operations"."kind" = 'corr');--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_delete_check" CHECK (("fee_payments"."deleted_at" is null) = ("fee_payments"."deleted_by" is null) and ("fee_payments"."deleted_at" is null) = ("fee_payments"."delete_reason" is null) and char_length(coalesce("fee_payments"."delete_reason", '')) <= 500);