CREATE TABLE "platform_lead_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_lead_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lead_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"text" text,
	CONSTRAINT "platform_lead_events_kind_check" CHECK ("platform_lead_events"."kind" in ('created', 'repeat', 'status', 'rollback', 'note', 'org'))
);
--> statement-breakpoint
ALTER TABLE "platform_lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"firm" text NOT NULL,
	"phone" text NOT NULL,
	"size" text NOT NULL,
	"telegram" text,
	"note" text,
	"status" text DEFAULT 'new' NOT NULL,
	"status_before" text,
	"created_org_id" uuid,
	"admin_note" text,
	"from_stand" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "platform_leads_status_check" CHECK ("platform_leads"."status" in ('new', 'in_progress', 'connected', 'rejected')),
	CONSTRAINT "platform_leads_status_before_check" CHECK ("platform_leads"."status_before" is null or "platform_leads"."status_before" in ('new', 'in_progress', 'connected', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "platform_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_outbox" DROP CONSTRAINT "telegram_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "platform_lead_events" ADD CONSTRAINT "platform_lead_events_lead_id_platform_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."platform_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_lead_events" ADD CONSTRAINT "platform_lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_created_org_id_organizations_id_fk" FOREIGN KEY ("created_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_leads" ADD CONSTRAINT "platform_leads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_lead_events_lead_idx" ON "platform_lead_events" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX "platform_leads_created_idx" ON "platform_leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_leads_phone_idx" ON "platform_leads" USING btree ("phone","created_at");--> statement-breakpoint
ALTER TABLE "telegram_outbox" ADD CONSTRAINT "telegram_outbox_kind_check" CHECK ("telegram_outbox"."kind" in ('reminders', 'task_new', 'task_on_confirm', 'task_confirmed', 'task_rework', 'task_cancelled', 'report_fix', 'code', 'linked', 'relinked', 'unlinked', 'pass_changed', 'pass_reset', 'broadcast', 'lead'));