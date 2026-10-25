-- RLS у всех таблиц public; политики только для роли приложения buhuchet_app (docs/decisions.md, п. 11).
ALTER TABLE "gked_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduler_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "gked_items_read" ON "gked_items" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "platform_reference_read" ON "platform_reference" AS PERMISSIVE FOR SELECT TO "buhuchet_app" USING (true);--> statement-breakpoint
CREATE POLICY "scheduler_runs_service" ON "scheduler_runs" AS PERMISSIVE FOR ALL TO "buhuchet_app" USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER POLICY "organizations_isolation" ON "organizations" TO buhuchet_app USING ("organizations"."id" = app.current_org_id()) WITH CHECK ("organizations"."id" = app.current_org_id());