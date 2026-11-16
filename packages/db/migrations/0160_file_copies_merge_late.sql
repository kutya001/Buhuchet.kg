-- Второй перенос задвоенных чеков (доработки 16.11.2026, этап 2, поток К; docs/deviations.md п. К-19,
-- docs/decisions.md п. О-57): копии принятых чеков, которые прежний код сделал, пока шёл выпуск этапа 1
-- (миграция 0159 уже прошла, новый код ещё не выложен), объединяются с оригиналом так же, как в 0159.
-- Граница — не время выкладки (его заранее не знаем), а то, как прикреплял копию прежний код: сразу после
-- «Сохранить» окна денег, тем же нажатием. Поэтому копия здесь — ещё и прикреплённая не позже 10 минут
-- после создания своей записи денег (поступления или оплаты за обслуживание); файл, загруженный в карточку
-- записи позже, не трогается, сколько бы ни прошло со дня выпуска. Повтор ничего не меняет, вызвать можно
-- в любом следующем выпуске (например, если этапы пакета выйдут одним «выпускай»).
-- Предел ожидания блокировок — как у 0157 и 0159.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
CREATE FUNCTION app.file_copies_merge_late()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    merged integer;
    left_over integer;
  BEGIN
    WITH originals AS (
      SELECT f.id, f.org_id, f.contractor_id, f.size_bytes, f.created_at, s.name AS sent_name,
        s.content_type AS sent_type, s.decided_at
      FROM public.contractor_sent_files s
      JOIN public.files f ON f.id = s.file_id AND f.org_id = s.org_id
        AND f.contractor_id = s.contractor_id
      WHERE s.status = 'accepted' AND s.decided_at IS NOT NULL AND f.state = 'ready'
        AND f.replaced_at IS NULL
    ),
    copies AS (
      SELECT c.id, c.org_id, c.contractor_id, c.name, c.content_type, c.size_bytes, c.source_kind,
        c.source_id, c.created_by, c.created_at
      FROM public.files c
      WHERE c.state = 'ready' AND c.source_kind IN ('receipt', 'fee_payment')
        AND c.source_id IS NOT NULL AND c.replaced_at IS NULL AND c.note IS NULL
        AND c.created_at >= timestamptz '2026-11-15 00:00:00+06'
        -- Прикреплена тем же «Сохранить», что создало запись денег.
        AND EXISTS (
          SELECT 1 FROM public.money_operations m
          WHERE c.source_kind = 'receipt' AND m.id = c.source_id AND m.org_id = c.org_id
            AND m.kind = 'in' AND c.created_at >= m.created_at
            AND c.created_at <= m.created_at + interval '10 minutes'
          UNION ALL
          SELECT 1 FROM public.fee_payments p
          WHERE c.source_kind = 'fee_payment' AND p.id = c.source_id AND p.org_id = c.org_id
            AND c.created_at >= p.created_at
            AND c.created_at <= p.created_at + interval '10 minutes'
        )
    ),
    pairs AS (
      SELECT c.id AS copy_id, c.org_id, c.source_kind, c.source_id, c.created_by, c.created_at,
        (array_agg(o.id))[1] AS orig_id
      FROM copies c
      JOIN originals o ON o.org_id = c.org_id AND o.contractor_id = c.contractor_id
        AND o.sent_name = c.name AND o.sent_type = c.content_type AND o.size_bytes = c.size_bytes
        AND o.id <> c.id AND c.created_at >= o.decided_at AND c.created_at >= o.created_at
      GROUP BY c.id, c.org_id, c.source_kind, c.source_id, c.created_by, c.created_at
      HAVING count(*) = 1
    ),
    linked AS (
      INSERT INTO public.file_links (org_id, file_id, source_kind, source_id, created_by, created_at)
        SELECT p.org_id, p.orig_id, p.source_kind, p.source_id, p.created_by, p.created_at FROM pairs p
        ON CONFLICT DO NOTHING
        RETURNING 1
    ),
    gone AS (
      UPDATE public.files f
        SET state = 'deleted', deleted_at = now(), deleted_by = p.created_by,
          updated_by = p.created_by, updated_at = now(), version = f.version + 1
        FROM pairs p
        WHERE f.id = p.copy_id
        RETURNING f.storage_key
    ),
    stored AS (
      INSERT INTO public.storage_delete_retries (key)
        SELECT g.storage_key FROM gone g
        ON CONFLICT (key) DO NOTHING
        RETURNING 1
    )
    SELECT count(*)::integer INTO merged FROM gone;
    -- Похожие копии без пары (подходят к нескольким оригиналам) — в журнал выпуска для отчёта; копии,
    -- прикреплённые позже 10 минут после записи денег, сюда не входят.
    SELECT count(*)::integer INTO left_over
      FROM public.files c
      WHERE c.state = 'ready' AND c.source_kind IN ('receipt', 'fee_payment')
        AND c.source_id IS NOT NULL AND c.replaced_at IS NULL AND c.note IS NULL
        AND c.created_at >= timestamptz '2026-11-15 00:00:00+06'
        AND EXISTS (
          SELECT 1 FROM public.money_operations m
          WHERE c.source_kind = 'receipt' AND m.id = c.source_id AND m.org_id = c.org_id
            AND m.kind = 'in' AND c.created_at >= m.created_at
            AND c.created_at <= m.created_at + interval '10 minutes'
          UNION ALL
          SELECT 1 FROM public.fee_payments p
          WHERE c.source_kind = 'fee_payment' AND p.id = c.source_id AND p.org_id = c.org_id
            AND c.created_at >= p.created_at
            AND c.created_at <= p.created_at + interval '10 minutes'
        )
        AND EXISTS (
          SELECT 1 FROM public.contractor_sent_files s
          JOIN public.files f ON f.id = s.file_id AND f.org_id = s.org_id
          WHERE s.org_id = c.org_id AND s.contractor_id = c.contractor_id AND s.status = 'accepted'
            AND f.state = 'ready' AND s.name = c.name AND s.content_type = c.content_type
            AND f.size_bytes = c.size_bytes
        );
    RAISE NOTICE 'file_copies_merge_late: объединено %, похожих копий без пары %', merged, left_over;
    RETURN merged;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.file_copies_merge_late() FROM PUBLIC, buhuchet_app;--> statement-breakpoint
DO $$
BEGIN
  RAISE NOTICE 'file_copies_merge_late (0160): %', app.file_copies_merge_late();
END
$$;
