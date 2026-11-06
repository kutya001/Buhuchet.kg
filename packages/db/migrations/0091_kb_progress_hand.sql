-- База знаний: способ «hand» — «Отметить выполненным» (решение заказчика 06.11.2026, прототип v74).
ALTER TABLE "kb_progress" DROP CONSTRAINT "kb_progress_how_check";--> statement-breakpoint
ALTER TABLE "kb_progress" ADD CONSTRAINT "kb_progress_how_check" CHECK ("kb_progress"."done_how" is null or "kb_progress"."done_how" in ('action', 'data', 'show', 'art', 'use', 'visit', 'hand'));