CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "session_log_org_started_idx" ON "session_log" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "status_history_org_at_idx" ON "status_history" USING btree ("org_id","at");