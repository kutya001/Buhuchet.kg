-- Показатель «ФОТ» организациям, созданным до 06.11.2026 (решение заказчика: показатели по умолчанию —
-- «Выручка», «Количество сотрудников» и «ФОТ»; прототип v74, миграция v74 в core/data.js): добавляется,
-- если у организации нет показателя «ФОТ» или «Фонд оплаты труда» (без учёта регистра, в том числе в
-- архиве). Последним по порядку, «Вести с» — текущий месяц по Бишкеку, без значений; поля — как у
-- DEFAULT_INDICATORS (packages/domain/src/kpi/indicators.ts). Повтор ничего не добавляет.
insert into indicators (
  org_id, name, unit, type, total, description, required, due_day, start_month, scope, auto_new, sort_order
)
select
  o.id,
  'ФОТ',
  'сом',
  'som',
  'sum',
  'Фонд оплаты труда: начисленная зарплата всех сотрудников за месяц до удержаний.',
  true,
  10,
  to_char(now() at time zone 'Asia/Bishkek', 'YYYY-MM'),
  'all',
  true,
  coalesce((select max(i.sort_order) from indicators i where i.org_id = o.id), 0) + 1
from organizations o
where not exists (
  select 1
  from indicators i
  where i.org_id = o.id and lower(btrim(i.name)) in ('фот', 'фонд оплаты труда')
)
on conflict do nothing;
