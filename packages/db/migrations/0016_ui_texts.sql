CREATE TABLE "ui_texts" (
	"lang" text DEFAULT 'ru' NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"section" text NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ui_texts_lang_key_pk" PRIMARY KEY("lang","key")
);
--> statement-breakpoint
ALTER TABLE "ui_texts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ui_texts" ADD CONSTRAINT "ui_texts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "ui_texts_read" ON "ui_texts" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);