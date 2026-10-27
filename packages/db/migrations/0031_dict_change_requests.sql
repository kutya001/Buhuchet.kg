CREATE TABLE "dict_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dict" text NOT NULL,
	"what" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dict_change_requests_dict_check" CHECK ("dict_change_requests"."dict" in ('types', 'regimes', 'forms', 'organs', 'benefits', 'banks', 'cats', 'reasons', 'ugns', 'bases')),
	CONSTRAINT "dict_change_requests_status_check" CHECK ("dict_change_requests"."status" in ('new', 'added', 'rejected')),
	CONSTRAINT "dict_change_requests_what_check" CHECK (length(btrim("dict_change_requests"."what")) between 1 and 300),
	CONSTRAINT "dict_change_requests_comment_check" CHECK (length("dict_change_requests"."comment") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "dict_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dict_change_requests_org_idx" ON "dict_change_requests" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "dict_change_requests_isolation" ON "dict_change_requests" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("dict_change_requests"."org_id" = app.current_org_id()) WITH CHECK ("dict_change_requests"."org_id" = app.current_org_id());