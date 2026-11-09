ALTER TABLE "contractors" DROP CONSTRAINT "contractors_socfund_flags_check";--> statement-breakpoint
-- Прототип v82: признак «Зарплата только безналично» → «Выплата зарплаты» (на тариф Соцфонда не влияет): Да — «Только безналично», Нет — «Безналично и наличными»
UPDATE "contractors" SET "socfund_flags" = ("socfund_flags" - 'cashless') || CASE jsonb_typeof("socfund_flags" -> 'cashless') WHEN 'boolean' THEN jsonb_build_object('pay', CASE WHEN ("socfund_flags" ->> 'cashless')::boolean THEN 'card' ELSE 'mixed' END) ELSE '{}'::jsonb END WHERE "socfund_flags" ? 'cashless';--> statement-breakpoint
ALTER TABLE "tax_benefits" ADD COLUMN "cash_hint" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_socfund_flags_check" CHECK (jsonb_typeof("contractors"."socfund_flags") = 'object' and "contractors"."socfund_flags" - array['registry', 'confirmed', 'gov', 'pay'] = '{}'::jsonb and coalesce(jsonb_typeof(socfund_flags -> 'registry'), 'boolean') = 'boolean' and coalesce(jsonb_typeof(socfund_flags -> 'confirmed'), 'boolean') = 'boolean' and coalesce(jsonb_typeof(socfund_flags -> 'gov'), 'boolean') = 'boolean' and coalesce(jsonb_typeof(socfund_flags -> 'pay'), 'string') = 'string' and coalesce(socfund_flags ->> 'pay', 'card') in ('card', 'mixed', 'cash'));--> statement-breakpoint
-- «Подсказка юрлицу при наличной зарплате» правит окно статуса в Админке (прототип v82 `bn-cash`).
UPDATE app.platform_dict_specs SET columns = array_append(columns, 'cash_hint')
  WHERE dict = 'benefits' AND NOT ('cash_hint' = ANY (columns));
