/*
 * Запросы 18 готовых шаблонов «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 7; общий план
 * 20.11, этап 1, П11). Прототип SQL не выполняет: строки готовых шаблонов считает его код на демо-данных
 * (`modules/vitrina.js`, `DM_RUN`), а текст запроса в `refDB.dmTemplates` — «для вида» и местами написан
 * по столбцам, которых в базе нет. Поэтому запросы здесь свои: они повторяют то, что показывает `DM_RUN`, на
 * настоящих таблицах, а название, описание, параметры и столбцы шаблона берутся из refDB.json
 * (`seedDmTemplates`). Столбцы запроса — те же и в том же порядке, что `cols` шаблона (тест
 * `datamart-templates.test.ts`).
 *
 * Подписи статусов и видов — тексты словаря (`ui_texts`): шаблон показывает то же, что экран, и после
 * правки «Локализации». Деньги — тыйыны (на экране и во внешнем ответе их переводит `dmCell`), значения
 * показателей — числом, как их вводят. Сроки и дни — по Бишкеку: исполнитель задаёт часовой пояс сам.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-26

/** Подпись периода отчёта, как в списках (`report-list.ts`, прототип `plabel`): «10.2026», «III кв. 2026». */
const PERIOD = `CASE
           WHEN r.event_date IS NOT NULL THEN to_char(r.event_date, 'MM.YYYY') || ' · ' || to_char(r.event_date, 'DD.MM')
           WHEN r.period = 'M' THEN to_char(r.period_start, 'MM.YYYY')
           WHEN r.period = 'Q' THEN (ARRAY['I', 'II', 'III', 'IV'])[extract(quarter FROM r.period_start)::int] || ' кв. ' || extract(year FROM r.period_start)::int
           WHEN r.period = 'H' THEN (ARRAY['I', 'II'])[CASE WHEN extract(month FROM r.period_start) <= 6 THEN 1 ELSE 2 END] || ' пол. ' || extract(year FROM r.period_start)::int
           ELSE extract(year FROM r.period_start)::int::text
         END`;

/** Вид отчёта коротко (прототип `dmRepN`: короткое название, иначе код). */
const REPORT_NAME = `coalesce(nullif(t.short_name, ''), r.report_type_code)`;

/** Отчёт не сдан (прототип `dmOpen`: не «Сдан» и не «Не требуется»). */
const OPEN = `r.status NOT IN ('submitted', 'not_required')`;

/**
 * Начисления платы за обслуживание по месяцам — правила домена `feeMonths` и `feeCharge`
 * (`packages/domain/src/fees/charges.ts`, прототип `core/org.js`): месяцы обслуживания с месяца начала, но
 * не раньше месяца, когда контрагента завели в программе, по текущий; ставка — последняя, действующая с
 * этого месяца или раньше; годовая — только в месяце «действует с»; первый неполный месяц — полный,
 * пропорционально оставшимся дням (до сома) или ничего. Разовых контрагентов здесь нет.
 */
const FEE_CHARGES = `cp AS (
  SELECT c.id, c.start_date, c.fee_day, c.first_month_mode, c.created_at::date AS created_on
  FROM contractors c
  WHERE c.kind <> 'oneoff'
), months AS (
  SELECT cp.id AS contractor_id, m.m::date AS month
  FROM cp
  CROSS JOIN LATERAL generate_series(
    date_trunc('month', greatest(cp.start_date, cp.created_on))::date,
    date_trunc('month', current_date)::date,
    interval '1 month') AS m (m)
  WHERE EXISTS (
    SELECT 1 FROM contractor_service_periods p
    WHERE p.contractor_id = cp.id AND p.from_month <= m.m::date
      AND (p.to_month IS NULL OR m.m::date <= p.to_month))
), charges AS (
  SELECT mo.contractor_id, mo.month,
         CASE
           WHEN t.amount IS NULL THEN 0
           WHEN t.period = 'Y' THEN
             CASE WHEN extract(month FROM t.valid_from) = extract(month FROM mo.month) THEN t.amount ELSE 0 END
           WHEN mo.month = date_trunc('month', cp.start_date)::date AND extract(day FROM cp.start_date) <> 1 THEN
             CASE cp.first_month_mode
               WHEN 'next' THEN 0
               WHEN 'prorate' THEN
                 round(t.amount * (dim.days - extract(day FROM cp.start_date) + 1) / (dim.days * 100)) * 100
               ELSE t.amount
             END
           ELSE t.amount
         END AS charge
  FROM months mo
  JOIN cp ON cp.id = mo.contractor_id
  CROSS JOIN LATERAL (
    SELECT extract(day FROM mo.month + interval '1 month' - interval '1 day') AS days
  ) dim
  LEFT JOIN LATERAL (
    SELECT x.amount, x.period, x.valid_from
    FROM contractor_tariffs x
    WHERE x.contractor_id = mo.contractor_id AND date_trunc('month', x.valid_from)::date <= mo.month
    ORDER BY x.valid_from DESC, x.created_at DESC
    LIMIT 1
  ) t ON true
)`;

/** Код шаблона → запрос продукта. Шаблон refDB.json без строки здесь наполнение не заводит (ошибка). */
export const DM_BUILTIN_SQL: Readonly<Record<string, string>> = {
  // Прототип: `DM_RUN.contractors` — все, кроме архивных; форма и режим — названиями, обслуживание — статусом.
  contractors: `SELECT c.id AS contractor_id, c.name AS cp, c.inn,
       f.short_name AS form, g.name AS regime, e.short_name AS resp,
       coalesce(s.text, c.service_status) AS svc, c.start_date AS start
FROM contractors c
LEFT JOIN ownership_forms f ON f.code = c.form_code
LEFT JOIN tax_regimes g ON g.code = c.regime_code
LEFT JOIN employees e ON e.id = c.responsible_employee_id
LEFT JOIN ui_texts s ON s.lang = 'ru' AND s.key = 'status.service.' || c.service_status
WHERE c.service_status <> 'archived'
ORDER BY c.name, c.id`,

  // Прототип: `DM_RUN['reports-due']` — срок в периоде, статус по выбору; сумма и оплачено — пусто как 0.
  'reports-due': `SELECT c.id AS contractor_id, c.name AS cp, ${REPORT_NAME} AS rep,
       ${PERIOD} AS period,
       r.due_date AS due, coalesce(s.text, r.status) AS status,
       coalesce(r.amount, 0) AS sum, coalesce(r.paid, 0) AS paid, e.short_name AS resp
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
JOIN report_types t ON t.code = r.report_type_code
LEFT JOIN employees e ON e.id = r.responsible_employee_id
LEFT JOIN ui_texts s ON s.lang = 'ru' AND s.key = 'status.report.' || r.status
WHERE NOT r.superseded
  AND r.due_date BETWEEN :date_from AND :date_to
  AND (:status IS NULL OR r.status = :status)
ORDER BY r.due_date, c.name, r.id`,

  // Прототип: `DM_RUN['reports-overdue']` — не сданные со сроком раньше даты.
  'reports-overdue': `SELECT c.id AS contractor_id, c.name AS cp, ${REPORT_NAME} AS rep,
       ${PERIOD} AS period,
       r.due_date AS due, :date - r.due_date AS days,
       coalesce(s.text, r.status) AS status, e.short_name AS resp
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
JOIN report_types t ON t.code = r.report_type_code
LEFT JOIN employees e ON e.id = r.responsible_employee_id
LEFT JOIN ui_texts s ON s.lang = 'ru' AND s.key = 'status.report.' || r.status
WHERE NOT r.superseded
  AND ${OPEN}
  AND r.due_date < :date
ORDER BY r.due_date, c.name, r.id`,

  // Прототип: `DM_RUN['reports-by-staff']` — «просрочено» и «осталось» считаются от сегодняшнего дня.
  'reports-by-staff': `SELECT coalesce(e.short_name, 'Без ответственного') AS emp,
       count(*) AS total,
       count(*) FILTER (WHERE NOT (${OPEN})) AS done,
       count(*) FILTER (WHERE ${OPEN} AND r.due_date < current_date) AS overdue,
       count(*) FILTER (WHERE ${OPEN} AND r.due_date >= current_date) AS remaining
FROM reports r
LEFT JOIN employees e ON e.id = r.responsible_employee_id
WHERE NOT r.superseded
  AND to_char(r.due_date, 'YYYY-MM') = :month
GROUP BY 1
ORDER BY 1`,

  // Прототип: `DM_RUN['tax-due']` — по месяцу срока оплаты (нет его — срока сдачи); остаток не меньше 0.
  'tax-due': `SELECT c.id AS contractor_id, c.name AS cp,
       sum(r.amount) AS sum, sum(coalesce(r.paid, 0)) AS paid,
       sum(greatest(r.amount - coalesce(r.paid, 0), 0)) AS rest
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
WHERE NOT r.superseded
  AND r.amount > 0
  AND to_char(coalesce(r.pay_due, r.due_date), 'YYYY-MM') = :month
GROUP BY c.id, c.name
ORDER BY rest DESC, c.name`,

  // Прототип: `DM_RUN['service-fee']` (`revenueData`) — начислено за месяцы года по сегодняшний, оплачено —
  // оплаты с датой в этом году; как «Аналитика» на «Главной».
  'service-fee': `WITH ${FEE_CHARGES}, ch AS (
  SELECT contractor_id, sum(charge) AS amount
  FROM charges
  WHERE extract(year FROM month) = :year
  GROUP BY contractor_id
), pd AS (
  SELECT contractor_id, sum(amount) AS amount
  FROM fee_payments
  WHERE deleted_at IS NULL AND extract(year FROM paid_on) = :year
  GROUP BY contractor_id
)
SELECT c.id AS contractor_id, c.name AS cp,
       coalesce(ch.amount, 0) AS charged, coalesce(pd.amount, 0) AS paid,
       greatest(coalesce(ch.amount, 0) - coalesce(pd.amount, 0), 0) AS debt
FROM contractors c
LEFT JOIN ch ON ch.contractor_id = c.id
LEFT JOIN pd ON pd.contractor_id = c.id
WHERE c.kind <> 'oneoff'
  AND (coalesce(ch.amount, 0) <> 0 OR coalesce(pd.amount, 0) <> 0)
ORDER BY debt DESC, c.name`,

  // Прототип: `DM_RUN.debtors` — месяцы по сегодняшний, срок оплаты которых не позже даты; получено —
  // оплаты по месяцам и аванс, засчитанный от старых месяцев к новым (`feeAdvSplit`), как долг на вкладке
  // «Обслуживание» (`contractorFees`).
  debtors: `WITH ${FEE_CHARGES}, paid AS (
  SELECT fp.contractor_id, date_trunc('month', fa.month)::date AS month, sum(fa.amount) AS amount
  FROM fee_payments fp
  JOIN fee_allocations fa ON fa.payment_id = fp.id
  WHERE fp.deleted_at IS NULL
  GROUP BY 1, 2
), advance AS (
  SELECT fp.contractor_id, sum(greatest(fp.amount - coalesce(a.amount, 0), 0)) AS amount
  FROM fee_payments fp
  LEFT JOIN (
    SELECT payment_id, sum(amount) AS amount FROM fee_allocations GROUP BY payment_id
  ) a ON a.payment_id = fp.id
  WHERE fp.deleted_at IS NULL
  GROUP BY fp.contractor_id
), ledger AS (
  SELECT ch.contractor_id, ch.month, ch.charge, coalesce(pd.amount, 0) AS paid,
         greatest(ch.charge - coalesce(pd.amount, 0), 0) AS need, coalesce(adv.amount, 0) AS adv
  FROM charges ch
  LEFT JOIN paid pd ON pd.contractor_id = ch.contractor_id AND pd.month = ch.month
  LEFT JOIN advance adv ON adv.contractor_id = ch.contractor_id
), months_due AS (
  SELECT l.contractor_id,
         l.charge - l.paid - greatest(0, least(l.need, l.adv - coalesce(sum(l.need) OVER (
           PARTITION BY l.contractor_id ORDER BY l.month
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))) AS rest,
         CASE WHEN d.due < cp.start_date OR d.due <= cp.created_on
              THEN (d.due + interval '1 month')::date ELSE d.due END AS due
  FROM ledger l
  JOIN cp ON cp.id = l.contractor_id
  CROSS JOIN LATERAL (
    SELECT make_date(extract(year FROM l.month)::int, extract(month FROM l.month)::int, cp.fee_day) AS due
  ) d
)
SELECT c.id AS contractor_id, c.name AS cp, sum(m.rest) AS debt, count(*) AS months, e.short_name AS resp
FROM months_due m
JOIN contractors c ON c.id = m.contractor_id
LEFT JOIN employees e ON e.id = c.responsible_employee_id
WHERE m.due <= :date AND m.rest > 0
GROUP BY c.id, c.name, e.short_name
ORDER BY debt DESC, c.name`,

  // Прототип: `DM_RUN['money-operations']` — действующие операции с датой в периоде; сумма без части за
  // обслуживание (она — в «Плате за обслуживание»).
  'money-operations': `SELECT o.contractor_id, o.op_date AS date, c.name AS cp,
       coalesce(k.text, o.kind) AS kind, o.amount, o.note
FROM money_operations o
LEFT JOIN contractors c ON c.id = o.contractor_id
LEFT JOIN ui_texts k ON k.lang = 'ru' AND k.key = 'money.op.' || o.kind
WHERE o.cancelled_at IS NULL
  AND o.op_date BETWEEN :date_from AND :date_to
ORDER BY o.op_date, o.created_at, o.id`,

  // Прототип: `DM_RUN.revenue` (`revenueData`) — оплаты с датой в году: обслуживание, проекты, разовые услуги.
  revenue: `WITH f AS (
  SELECT contractor_id, sum(amount) AS amount
  FROM fee_payments
  WHERE deleted_at IS NULL AND extract(year FROM paid_on) = :year
  GROUP BY contractor_id
), p AS (
  SELECT pr.contractor_id, sum(pp.amount) AS amount
  FROM project_payments pp
  JOIN projects pr ON pr.id = pp.project_id
  WHERE pp.deleted_at IS NULL AND extract(year FROM pp.paid_on) = :year
  GROUP BY pr.contractor_id
), s AS (
  SELECT sv.contractor_id, sum(sp.amount) AS amount
  FROM one_off_service_payments sp
  JOIN one_off_services sv ON sv.id = sp.service_id
  WHERE sp.deleted_at IS NULL AND sv.deleted_at IS NULL AND extract(year FROM sp.paid_on) = :year
  GROUP BY sv.contractor_id
)
SELECT c.id AS contractor_id, c.name AS cp,
       coalesce(f.amount, 0) AS fee, coalesce(p.amount, 0) AS proj, coalesce(s.amount, 0) AS svc,
       coalesce(f.amount, 0) + coalesce(p.amount, 0) + coalesce(s.amount, 0) AS total
FROM contractors c
LEFT JOIN f ON f.contractor_id = c.id
LEFT JOIN p ON p.contractor_id = c.id
LEFT JOIN s ON s.contractor_id = c.id
WHERE coalesce(f.amount, 0) + coalesce(p.amount, 0) + coalesce(s.amount, 0) > 0
ORDER BY total DESC, c.name`,

  // Прототип: `DM_RUN['projects-services']` — проекты, начатые в периоде, и разовые услуги с датой в нём.
  'projects-services': `SELECT pr.contractor_id, 'Проект' AS kind, pr.name, c.name AS cp, pr.starts_on AS date,
       coalesce(pr.plan, 0) AS cost, coalesce(pp.amount, 0) AS paid,
       greatest(coalesce(pr.plan, 0) - coalesce(pp.amount, 0), 0) AS debt
FROM projects pr
LEFT JOIN contractors c ON c.id = pr.contractor_id
LEFT JOIN (
  SELECT project_id, sum(amount) AS amount FROM project_payments WHERE deleted_at IS NULL GROUP BY project_id
) pp ON pp.project_id = pr.id
WHERE pr.starts_on BETWEEN :date_from AND :date_to
UNION ALL
SELECT sv.contractor_id, 'Разовая услуга', sv.name, c.name, sv.service_date,
       sv.amount, coalesce(sp.amount, 0), greatest(sv.amount - coalesce(sp.amount, 0), 0)
FROM one_off_services sv
LEFT JOIN contractors c ON c.id = sv.contractor_id
LEFT JOIN (
  SELECT service_id, sum(amount) AS amount FROM one_off_service_payments WHERE deleted_at IS NULL GROUP BY service_id
) sp ON sp.service_id = sv.id
WHERE sv.deleted_at IS NULL
  AND sv.service_date BETWEEN :date_from AND :date_to
ORDER BY date, kind, name`,

  // Прототип: `DM_RUN['indicators-by-month']` — внесённые значения; в базе они хранятся сотыми.
  'indicators-by-month': `SELECT v.contractor_id, c.name AS cp, i.name AS ind, v.month,
       round(v.value / 100.0, 2) AS value, i.unit
FROM indicator_values v
JOIN indicators i ON i.id = v.indicator_id
JOIN contractors c ON c.id = v.contractor_id
WHERE v.value IS NOT NULL
  AND v.month BETWEEN :month_from AND :month_to
ORDER BY c.name, i.sort_order, v.month`,

  // Прототип: `DM_RUN.tasks` — задачи со сроком в периоде.
  tasks: `SELECT t.contractor_id, t.title, c.name AS cp, e.short_name AS exec, t.due_date AS due,
       coalesce(s.text, t.status) AS status
FROM tasks t
LEFT JOIN contractors c ON c.id = t.contractor_id
LEFT JOIN employees e ON e.id = t.executor_employee_id
LEFT JOIN ui_texts s ON s.lang = 'ru' AND s.key = 'status.task.' || t.status
WHERE t.due_date BETWEEN :date_from AND :date_to
ORDER BY t.due_date, t.created_at, t.id`,

  // Прототип: `DM_RUN.orgs` — все организации платформы; память — как «Занято» подписки (`app.org_usage`):
  // файлы и ещё не принятые присланные файлы, без документов заявки.
  orgs: `SELECT o.name AS org,
       CASE o.status WHEN 'blocked' THEN 'Заблокирована' ELSE 'Активна' END AS status,
       (SELECT count(*) FROM employees e WHERE e.org_id = o.id AND e.active) AS staff,
       (SELECT count(*) FROM contractors c WHERE c.org_id = o.id AND c.service_status <> 'archived') AS cps,
       round(((SELECT coalesce(sum(f.size_bytes), 0) FROM files f
                WHERE f.org_id = o.id AND f.state = 'ready' AND f.source_kind <> 'lead')
            + (SELECT coalesce(sum(s.size_bytes), 0) FROM contractor_sent_files s
                WHERE s.org_id = o.id AND s.state = 'ready' AND s.status <> 'accepted')) / 1048576.0, 1) AS mb
FROM organizations o
ORDER BY o.name`,

  // Прототип: `DM_RUN['org-activity']` — входы по дням; сеансы закрыты ролям Витрины, входы — журнал сеансов.
  'org-activity': `SELECT l.started_at::date AS day, o.name AS org,
       count(*) AS logins, count(DISTINCT l.user_id) AS users
FROM session_log l
JOIN organizations o ON o.id = l.org_id
WHERE l.started_at::date BETWEEN :date_from AND :date_to
GROUP BY 1, 2
ORDER BY day DESC, org`,

  // Прототип: `DM_RUN.subscriptions` (`SUB_WHAT`, `SUB_PAY_ST`) — оплаты подписок с датой записи в периоде.
  subscriptions: `SELECT p.created_at::date AS at, o.name AS org,
       CASE p.kind
         WHEN 'renew' THEN 'Продление'
         WHEN 'grow' THEN 'Расширение пакета'
         WHEN 'mem' THEN 'Память сверх'
         WHEN 'free' THEN 'Бесплатный период'
         ELSE 'Изменено администратором'
       END AS what,
       coalesce(p.seats, 0) AS pack, coalesce(p.amount, 0) AS sum,
       CASE p.status
         WHEN 'pending' THEN 'Ждёт подтверждения'
         WHEN 'confirmed' THEN 'Подтверждена'
         ELSE 'Отклонена'
       END AS status,
       p.paid_until AS paid_to
FROM subscription_payments p
JOIN organizations o ON o.id = p.org_id
WHERE p.created_at::date BETWEEN :date_from AND :date_to
ORDER BY p.created_at DESC, p.id`,

  // Прототип: `DM_RUN.leads` — без телефонов, Telegram и реквизитов.
  leads: `SELECT l.created_at::date AS at, l.firm, l.size, coalesce(s.text, l.status) AS status
FROM platform_leads l
LEFT JOIN ui_texts s ON s.lang = 'ru' AND s.key = 'status.lead.' || l.status
WHERE l.created_at::date BETWEEN :date_from AND :date_to
ORDER BY l.created_at DESC, l.id`,

  // Прототип: `DM_RUN['bot-messages']` — журнал отправок бота по дням.
  'bot-messages': `SELECT m.created_at::date AS day,
       count(*) FILTER (WHERE m.status = 'sent') AS sent,
       count(*) FILTER (WHERE m.status = 'error') AS errors
FROM telegram_outbox m
WHERE m.created_at::date BETWEEN :date_from AND :date_to
GROUP BY 1
ORDER BY day DESC`,

  // Прототип: `DM_RUN['scheduler-runs']` — по названию задачи (словарь «Запусков»), запуск — слот расписания.
  'scheduler-runs': `SELECT coalesce(t.text, r.job) AS job, count(*) AS runs,
       count(*) FILTER (WHERE r.ok) AS ok,
       count(*) FILTER (WHERE NOT r.ok) AS errors,
       max(r.started_at) AS last
FROM scheduler_runs r
LEFT JOIN ui_texts t ON t.lang = 'ru' AND t.key = 'alert.job.' || translate(r.job, '.-', '__')
WHERE r.started_at::date BETWEEN :date_from AND :date_to
GROUP BY 1
ORDER BY errors DESC, job`,
};
