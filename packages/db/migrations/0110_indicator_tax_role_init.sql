-- Отметки «Для расчёта налогов» показателям организаций, созданных до прототипа v80 (миграция v80 в
-- core/data.js прототипа): если у организации ещё нет ни одного показателя с отметкой, первый по порядку
-- действующий показатель с подходящим названием и типом значения получает роль — «Выручка…» (сумма в сом
-- или число с копейками) — выручка, «ФОТ» или «Фонд оплаты труда» — ФОТ, «Количество сотрудников…» или
-- «Численность…» (целое число) — численность. Версия показателя растёт: открытое окно показателя не
-- затрёт отметку. Повтор ничего не меняет — отметки уже есть.
update indicators i
set tax_role = m.role, version = i.version + 1
from (
  select distinct on (x.org_id, r.role) x.id, r.role
  from indicators x
  join (
    values
      ('rev', '^выручка', array['som', 'dec']),
      ('fot', '^(фот|фонд оплаты труда)$', array['som', 'dec']),
      ('emp', '^(количество сотрудников|численность)', array['int'])
  ) as r(role, pattern, types)
    on lower(btrim(x.name)) ~ r.pattern and x.type = any(r.types)
  where not x.archived
    and not exists (
      select 1 from indicators t where t.org_id = x.org_id and t.tax_role is not null
    )
  order by x.org_id, r.role, x.sort_order, x.created_at, x.id
) m
where i.id = m.id;
