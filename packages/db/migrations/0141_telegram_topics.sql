CREATE TABLE "telegram_topics" (
	"chat_id" bigint NOT NULL,
	"key" text NOT NULL,
	"thread_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_topics_pk" PRIMARY KEY("chat_id","key"),
	CONSTRAINT "telegram_topics_key_check" CHECK ("telegram_topics"."key" ~ '^(rep|task|lead|sec|org:[0-9a-f-]{36})$')
);
--> statement-breakpoint
ALTER TABLE "telegram_topics" ENABLE ROW LEVEL SECURITY;