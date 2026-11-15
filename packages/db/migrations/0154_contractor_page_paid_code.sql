-- Страница контрагента: «Забыли код? Прислать в Telegram» и код на 1 день (доработки 14.11.2026,
-- блок 6, этап 3, поток К; прототип v116 modules/cp-paid.js, cp-page.js PG_KEEP).
--
-- Чья страница по ссылке, пока код не введён: «Забыли код?» отправляет код в Telegram, подключённый к
-- этому контрагенту, — для этого API нужны организация и контрагент. Как app.contractor_page_state
-- (0102): выключенная страница, неизвестный адрес или ИНН, архивный контрагент, заблокированная
-- организация, выключенная функция «Страница контрагента» — ничего; закрытая после неверных кодов —
-- с отметкой closed (код не присылается). Код сам функция не отдаёт: его читает транзакция организации.
CREATE FUNCTION app.contractor_page_target(p_slug text, p_inn text)
  RETURNS TABLE (org_id uuid, contractor_id uuid, closed boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT p.org_id, p.contractor_id, p.closed_at IS NOT NULL
      FROM public.organizations o
      JOIN public.org_settings s ON s.org_id = o.id
      JOIN public.contractors c ON c.org_id = o.id AND c.inn = p_inn
      JOIN public.contractor_pages p ON p.contractor_id = c.id AND p.org_id = o.id
      WHERE o.slug = p_slug AND o.status = 'active' AND (s.features ->> 'cppage') = 'true'
        AND c.service_status <> 'archived' AND p.enabled
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.contractor_page_target(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.contractor_page_target(text, text) TO buhuchet_app;--> statement-breakpoint
-- Верный код теперь запоминается на 1 день с момента ввода (было 30): уже запомненные браузеры тоже
-- спросят код, когда пройдут сутки с ввода, — иначе более строгий срок заработал бы только через месяц.
UPDATE public.contractor_page_grants
  SET expires_at = created_at + interval '1 day'
  WHERE expires_at > created_at + interval '1 day';
