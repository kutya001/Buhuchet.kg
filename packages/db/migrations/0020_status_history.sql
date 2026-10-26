CREATE TABLE "status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"scale" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"is_rollback" boolean DEFAULT false NOT NULL,
	"reason" text,
	"actor_user_id" uuid DEFAULT app.current_user_id(),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_history_status_check" CHECK (("status_history"."scale" = 'report' and "status_history"."to_status" in ('todo', 'in_progress', 'submitted', 'waiting', 'confirmed', 'needs_fix', 'not_required') and ("status_history"."from_status" is null or "status_history"."from_status" in ('todo', 'in_progress', 'submitted', 'waiting', 'confirmed', 'needs_fix', 'not_required'))) or ("status_history"."scale" = 'payment' and "status_history"."to_status" in ('unpaid', 'partial', 'paid', 'not_required') and ("status_history"."from_status" is null or "status_history"."from_status" in ('unpaid', 'partial', 'paid', 'not_required'))) or ("status_history"."scale" = 'task' and "status_history"."to_status" in ('todo', 'in_progress', 'rework', 'on_confirm', 'confirmed', 'done', 'failed', 'cancelled') and ("status_history"."from_status" is null or "status_history"."from_status" in ('todo', 'in_progress', 'rework', 'on_confirm', 'confirmed', 'done', 'failed', 'cancelled'))) or ("status_history"."scale" = 'service' and "status_history"."to_status" in ('active', 'paused', 'archived') and ("status_history"."from_status" is null or "status_history"."from_status" in ('active', 'paused', 'archived'))) or ("status_history"."scale" = 'project' and "status_history"."to_status" in ('planned', 'in_progress', 'done', 'cancelled') and ("status_history"."from_status" is null or "status_history"."from_status" in ('planned', 'in_progress', 'done', 'cancelled'))) or ("status_history"."scale" = 'indicator' and "status_history"."to_status" in ('empty', 'filled', 'checked') and ("status_history"."from_status" is null or "status_history"."from_status" in ('empty', 'filled', 'checked')))),
	CONSTRAINT "status_history_change_check" CHECK ("status_history"."from_status" is distinct from "status_history"."to_status"),
	CONSTRAINT "status_history_rollback_reason_check" CHECK (not "status_history"."is_rollback" or ("status_history"."from_status" is not null and "status_history"."reason" is not null and btrim("status_history"."reason") <> '')),
	CONSTRAINT "status_history_reason_check" CHECK ("status_history"."reason" is null or char_length("status_history"."reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "status_history_entity_idx" ON "status_history" USING btree ("org_id","scale","entity_id","at");--> statement-breakpoint
CREATE POLICY "status_history_isolation" ON "status_history" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("status_history"."org_id" = app.current_org_id()) WITH CHECK ("status_history"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "status_history_insert_guard" ON "status_history" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("status_history"."actor_user_id" is not distinct from app.current_user_id() and "status_history"."at" = now() and app.history_actor_allowed("status_history"."actor_user_id", "status_history"."org_id"));