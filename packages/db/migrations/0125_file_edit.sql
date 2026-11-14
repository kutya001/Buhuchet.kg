ALTER TABLE "files" DROP CONSTRAINT "files_key_check";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "replaced_by" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_replaces_fk" FOREIGN KEY ("replaces_id","org_id") REFERENCES "public"."files"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_replaces_check" CHECK ("files"."replaces_id" is null or "files"."state" = 'pending');--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_replaced_check" CHECK (("files"."replaced_at" is null) = ("files"."replaced_by" is null));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_key_check" CHECK ("files"."storage_key" ~ ('^org/' || "files"."org_id"::text || '/files/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'));