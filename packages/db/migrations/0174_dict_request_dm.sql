-- «Попросить шаблон» «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 3, пункт 2; общий план
-- 20.11, этап 2, П7, поток И; прототип v155 `dmAskDlg`): код справочника `dm` в запросах организаций
-- администратору платформы. Таблица запросов маленькая: проверка строк под ACCESS EXCLUSIVE — доли секунды.
-- Предел ожидания блокировки — 5 с, в конце снимается (после `pnpm db:generate` строки SET LOCAL вернуть руками).
-- Откат: новая миграция с прежним списком — только после того, как код перестал создавать `dm` и строки с
-- `dm` убраны (иначе ADD CONSTRAINT упадёт с 23514 и выпуск откатится целиком). Откату кода миграция не
-- мешает: прежний код `dm` не шлёт.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "dict_change_requests" DROP CONSTRAINT "dict_change_requests_dict_check";--> statement-breakpoint
ALTER TABLE "dict_change_requests" ADD CONSTRAINT "dict_change_requests_dict_check" CHECK ("dict_change_requests"."dict" in ('types', 'regimes', 'forms', 'organs', 'benefits', 'banks', 'cats', 'reasons', 'ugns', 'bases', 'dm'));--> statement-breakpoint
SET LOCAL lock_timeout TO DEFAULT;
