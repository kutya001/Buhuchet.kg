-- «База знаний» (docs/decisions.md п. Г-2): отметки обучения не удаляются; у прочитанных статей и
-- полученных уровней — только добавление, у шагов меняются лишь способ, момент и пропуск.
REVOKE DELETE, TRUNCATE ON TABLE kb_progress, kb_article_reads, kb_levels FROM buhuchet_app;
--> statement-breakpoint
REVOKE UPDATE ON TABLE kb_progress, kb_article_reads, kb_levels FROM buhuchet_app;
--> statement-breakpoint
GRANT UPDATE (done_how, done_at, skipped_at) ON TABLE kb_progress TO buhuchet_app;
