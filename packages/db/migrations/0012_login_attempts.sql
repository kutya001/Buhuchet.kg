CREATE TABLE "login_attempts" (
	"login" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "login_attempts_last_attempt_idx" ON "login_attempts" USING btree ("last_attempt_at");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "failed_logins";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locked_until";