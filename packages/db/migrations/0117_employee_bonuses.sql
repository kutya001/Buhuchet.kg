CREATE TABLE "bonus_writeoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"note" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bonus_writeoffs_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "bonus_writeoffs_amount_check" CHECK ("bonus_writeoffs"."amount" > 0 and "bonus_writeoffs"."amount" <= 1000000000000),
	CONSTRAINT "bonus_writeoffs_note_check" CHECK (char_length(btrim("bonus_writeoffs"."note")) > 0 and char_length("bonus_writeoffs"."note") <= 300),
	CONSTRAINT "bonus_writeoffs_delete_check" CHECK (("bonus_writeoffs"."deleted_at" is null) = ("bonus_writeoffs"."deleted_by" is null))
);
--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "one_off_service_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"service_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_off_service_bonuses_employee_unique" UNIQUE("service_id","employee_id"),
	CONSTRAINT "one_off_service_bonuses_amount_check" CHECK ("one_off_service_bonuses"."amount" > 0 and "one_off_service_bonuses"."amount" <= 1000000000000)
);
--> statement-breakpoint
ALTER TABLE "one_off_service_bonuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ADD CONSTRAINT "bonus_writeoffs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ADD CONSTRAINT "bonus_writeoffs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ADD CONSTRAINT "bonus_writeoffs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ADD CONSTRAINT "bonus_writeoffs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_writeoffs" ADD CONSTRAINT "bonus_writeoffs_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_bonuses" ADD CONSTRAINT "one_off_service_bonuses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_bonuses" ADD CONSTRAINT "one_off_service_bonuses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_bonuses" ADD CONSTRAINT "one_off_service_bonuses_service_fk" FOREIGN KEY ("service_id","org_id") REFERENCES "public"."one_off_services"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_off_service_bonuses" ADD CONSTRAINT "one_off_service_bonuses_employee_fk" FOREIGN KEY ("employee_id","org_id") REFERENCES "public"."employees"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_writeoffs_employee_idx" ON "bonus_writeoffs" USING btree ("org_id","employee_id","paid_on");--> statement-breakpoint
CREATE INDEX "one_off_service_bonuses_employee_idx" ON "one_off_service_bonuses" USING btree ("org_id","employee_id");--> statement-breakpoint
CREATE POLICY "bonus_writeoffs_isolation" ON "bonus_writeoffs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("bonus_writeoffs"."org_id" = app.current_org_id()) WITH CHECK ("bonus_writeoffs"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "one_off_service_bonuses_isolation" ON "one_off_service_bonuses" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("one_off_service_bonuses"."org_id" = app.current_org_id()) WITH CHECK ("one_off_service_bonuses"."org_id" = app.current_org_id());--> statement-breakpoint
-- Списание бонуса не стирается: «Отменить списание» ставит отметку с автором и временем. Роль приложения
-- меняет только отметку и служебные столбцы; сотрудник, сумма, дата и основание после вставки не меняются.
-- TRUNCATE обходит политики RLS — его у роли приложения нет.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE bonus_writeoffs FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (deleted_at, deleted_by, updated_by, updated_at, version)
  ON TABLE bonus_writeoffs TO buhuchet_app;
--> statement-breakpoint
-- Строки бонусов услуги заменяются целиком (удалить и вставить) в одной транзакции с историей услуги:
-- правки строки на месте и TRUNCATE у роли приложения нет.
REVOKE UPDATE, TRUNCATE ON TABLE one_off_service_bonuses FROM buhuchet_app;
