-- Закрытие доступа по подписке (доработки 20.11.2026, блок 4, пункты 4–7; этап 1, П1 общего плана;
-- docs/decisions.md п. О-63): подписка новой организации в транзакции её создания и повтор запуска
-- тарификации в день, когда закрытие начинает работать; срок вида подписки до 36 месяцев (этап 1, П3).
-- После `pnpm db:generate` (новый номер при сборке) вернуть руками: lock_timeout первой командой, функцию
-- app.subscription_new_org с правами и повтор запуска тарификации — Drizzle их не порождает.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
-- «Виды подписок» Админки (блок 6, пункт 5; прототип subKindDlg): срок вида — от 1 до 36 месяцев.
ALTER TABLE "subscription_plans" DROP CONSTRAINT "subscription_plans_values_check";--> statement-breakpoint
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_values_check" CHECK ("subscription_plans"."months" between 1 and 36 and "subscription_plans"."discount_pct" between 0 and 99 and cardinality("subscription_plans"."perks") <= 10);--> statement-breakpoint
-- Подписка новой организации (блок 4, пункт 5; блок 6, пункт 4; прототип subNewOrgSave): только
-- организации контекста, созданной в этой же транзакции (`created_at` — начало транзакции; столбец роль
-- приложения не меняет), без подписки и без оплат — так функция не продлит и не поставит подписку
-- существующей организации. Вид — p_plan (действующий) или первый действующий по порядку, пакет — p_seats
-- или шаг пакета. Бесплатный период (`p_free`) — ещё и строка «Истории оплат» без суммы от того, кто
-- создаёт организацию (без пользователя — «Система»); иначе строки нет, как у «Изменить подписку»
-- прототипа. Историю записи пишет сервер в той же транзакции.
CREATE FUNCTION app.subscription_new_org(
  p_plan text,
  p_seats integer,
  p_extra_gb integer,
  p_until date,
  p_discount integer,
  p_free boolean,
  p_reason text
)
  RETURNS TABLE (plan text, pack integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_org uuid := app.current_org_id();
    v_user uuid := app.current_user_id();
    v_plan text;
    v_seats integer;
  BEGIN
    IF v_org IS NULL OR p_until IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = v_org AND NOT o.is_demo AND o.created_at = pg_catalog.now()
    ) OR EXISTS (SELECT 1 FROM public.org_subscriptions s WHERE s.org_id = v_org)
      OR EXISTS (SELECT 1 FROM public.subscription_payments p WHERE p.org_id = v_org)
    THEN
      RAISE EXCEPTION 'subscription_new_org: только новая организация этой транзакции'
        USING ERRCODE = '42501';
    END IF;
    SELECT k.id INTO v_plan FROM public.subscription_plans k
      WHERE k.active AND (p_plan IS NULL OR k.id = p_plan)
      ORDER BY k.sort_order, k.id
      LIMIT 1;
    IF v_plan IS NULL THEN
      RAISE EXCEPTION 'subscription_new_org: нет такого действующего вида подписки'
        USING ERRCODE = '23503', CONSTRAINT = 'org_subscriptions_plan_id_subscription_plans_id_fk';
    END IF;
    v_seats := coalesce(p_seats,
      (SELECT s.seat_step FROM public.subscription_settings s WHERE s.id = 1), 10);
    INSERT INTO public.org_subscriptions (org_id, plan_id, seats, extra_gb, paid_until,
        extra_discount_pct, free, updated_by)
      VALUES (v_org, v_plan, v_seats, coalesce(p_extra_gb, 0), p_until, coalesce(p_discount, 0),
        p_free, v_user);
    IF p_free THEN
      INSERT INTO public.subscription_payments (id, org_id, kind, plan_id, months, seats, extra_gb,
          status, reason, decided_by, decided_at, paid_until, created_by)
        VALUES (gen_random_uuid(), v_org, 'free', v_plan, 0, v_seats, coalesce(p_extra_gb, 0),
          'confirmed', p_reason, v_user, pg_catalog.now(), p_until, v_user);
    END IF;
    RETURN QUERY SELECT v_plan, v_seats;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.subscription_new_org(text, integer, integer, date, integer, boolean, text)
  FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.subscription_new_org(text, integer, integer, date, integer, boolean, text)
  TO buhuchet_app;--> statement-breakpoint
-- Повтор запуска тарификации (блок 4, пункт 7; миграция 0165): с этой версии доступ закрывается после
-- «Оплачено до», поэтому организации, которые ещё ничего не платили и ничего не получили от
-- администратора, получают 30 дней от сегодняшнего дня, а созданные после 0165 без подписки — пакет и
-- срок. В журнал выпуска — только число.
DO $$
BEGIN
  RAISE NOTICE 'subscriptions_launch: %',
    app.subscriptions_launch((now() AT TIME ZONE 'Asia/Bishkek')::date);
END
$$;
