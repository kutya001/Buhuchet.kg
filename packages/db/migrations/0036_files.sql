CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid DEFAULT app.current_org_id() NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid,
	"contractor_id" uuid,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" text NOT NULL,
	"note" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid DEFAULT app.current_user_id() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "files_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "files_source_kind_check" CHECK ("files"."source_kind" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "files_state_check" CHECK ("files"."state" in ('pending', 'ready', 'deleted')),
	CONSTRAINT "files_size_check" CHECK ("files"."size_bytes" between 0 and 20971520),
	CONSTRAINT "files_name_check" CHECK (char_length("files"."name") between 1 and 255),
	CONSTRAINT "files_key_check" CHECK ("files"."storage_key" = 'org/' || "files"."org_id"::text || '/files/' || "files"."id"::text),
	CONSTRAINT "files_deleted_check" CHECK (("files"."state" = 'deleted') = ("files"."deleted_at" is not null and "files"."deleted_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "status_history" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fk" FOREIGN KEY ("created_by","org_id") REFERENCES "public"."users"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_source_idx" ON "files" USING btree ("org_id","source_kind","source_id","created_at") WHERE "files"."state" = 'ready';--> statement-breakpoint
CREATE INDEX "files_contractor_idx" ON "files" USING btree ("org_id","contractor_id") WHERE "files"."contractor_id" is not null;--> statement-breakpoint
CREATE INDEX "files_pending_idx" ON "files" USING btree ("org_id","created_at") WHERE "files"."state" = 'pending';--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_file_fk" FOREIGN KEY ("file_id","org_id") REFERENCES "public"."files"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "files_isolation" ON "files" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING ("files"."org_id" = app.current_org_id()) WITH CHECK ("files"."org_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "files_insert_guard" ON "files" AS RESTRICTIVE FOR INSERT TO "buhuchet_app" WITH CHECK ("files"."created_by" = app.current_user_id() and "files"."state" = 'pending');--> statement-breakpoint
CREATE POLICY "files_update_guard" ON "files" AS RESTRICTIVE FOR UPDATE TO "buhuchet_app" USING ("files"."state" <> 'deleted') WITH CHECK ("files"."state" <> 'deleted' or "files"."deleted_by" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "files_delete_pending" ON "files" AS RESTRICTIVE FOR DELETE TO "buhuchet_app" USING ("files"."state" = 'pending');