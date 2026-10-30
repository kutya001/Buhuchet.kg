-- Периоды обслуживания контрагентов, заведённых до задачи 2.12 (приостановки тогда не было): у постоянного —
-- один период с месяца начала обслуживания; у архивного он закончен месяцем отправки в архив (последней
-- правки по Бишкеку, не раньше начала). У разовых периодов нет (прототип addCpDlg).
insert into contractor_service_periods (org_id, contractor_id, from_month, to_month)
select
  c.org_id,
  c.id,
  date_trunc('month', c.start_date)::date,
  case
    when c.service_status = 'archived' then greatest(
      date_trunc('month', c.start_date)::date,
      date_trunc('month', c.updated_at at time zone 'Asia/Bishkek')::date
    )
  end
from contractors c
where c.kind = 'regular'
on conflict do nothing;
--> statement-breakpoint
-- Постоянный контрагент обслуживается с месяца начала (прототип addCpDlg: periods = [{from: ym(start), to: null}]):
-- первый период ставит база при создании записи, кто бы её ни создавал (форма, наполнение, тесты модулей), —
-- отчёты по расписанию создаются только за месяцы обслуживания. Разовому периоды не нужны. Функция работает с
-- правами того, кто создаёт контрагента: строка периода проходит ту же изоляцию организаций.
CREATE OR REPLACE FUNCTION app.contractor_initial_service_period() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  INSERT INTO public.contractor_service_periods (org_id, contractor_id, from_month)
  VALUES (NEW.org_id, NEW.id, date_trunc('month', NEW.start_date)::date)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER contractors_initial_service_period
  AFTER INSERT ON public.contractors
  FOR EACH ROW WHEN (NEW.kind = 'regular')
  EXECUTE FUNCTION app.contractor_initial_service_period();
