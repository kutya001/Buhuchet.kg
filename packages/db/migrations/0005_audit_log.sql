CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"contractor_id" uuid,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"actor_user_id" uuid DEFAULT app.current_user_id(),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("org_id","entity","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_contractor_idx" ON "audit_log" USING btree ("org_id","contractor_id","at") WHERE "audit_log"."contractor_id" is not null;--> statement-breakpoint
CREATE POLICY "audit_log_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("audit_log"."org_id" = app.current_org_id()) WITH CHECK ("audit_log"."org_id" = app.current_org_id());