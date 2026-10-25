CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gked_items" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"parent_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sort_order" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_reference" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_runs" (
	"job" text NOT NULL,
	"slot" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"error" text,
	CONSTRAINT "scheduler_runs_job_slot_pk" PRIMARY KEY("job","slot")
);
--> statement-breakpoint
CREATE INDEX "gked_items_parent_idx" ON "gked_items" USING btree ("parent_code");--> statement-breakpoint
CREATE INDEX "gked_items_name_trgm_idx" ON "gked_items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "organizations_isolation" ON "organizations" AS PERMISSIVE FOR ALL TO public USING ("organizations"."id" = app.current_org_id()) WITH CHECK ("organizations"."id" = app.current_org_id());