/*
 * «Заготовки» консоли запросов «Витрины данных» (доработки 27.11.2026: консоль запросов, блок 4, пункт 1;
 * этап 2, П8; прототип v167 `DMC_PRE`): частые запросы и образцы конструкций — WITH, FILTER, оконная
 * функция, тыйыны в сомы. Сразу исключают удалённые, заменённые и отменённые записи, чтобы суммы
 * совпадали с программой. Названия и описания — тексты словаря `dm.con.pre.<код>` и
 * `dm.con.pre.<код>.d`. Каждая проходит разборщик консоли и выполняется на демо-данных (тест API).
 */

export interface DmConsolePreset {
  id: string;
  sql: string;
}

export const DM_CONSOLE_PRESETS = [
  {
    id: 'rep_resp',
    sql: 'SELECT c.id AS contractor_id, c.name AS cp, t.short_name AS rep, r.period_start, r.due_date, r.status,\n       e.short_name AS resp\nFROM reports r\nJOIN contractors c ON c.id = r.contractor_id\nJOIN report_types t ON t.code = r.report_type_code\nLEFT JOIN employees e ON e.id = r.responsible_employee_id\nWHERE NOT r.superseded\nORDER BY r.due_date, c.name',
  },
  {
    id: 'by_month',
    sql: "SELECT to_char(r.due_date, 'YYYY-MM') AS month, count(*) AS reports,\n       round(sum(coalesce(r.amount, 0)) / 100.0, 2) AS amount_som\nFROM reports r\nWHERE NOT r.superseded\nGROUP BY to_char(r.due_date, 'YYYY-MM')\nORDER BY month",
  },
  {
    id: 'tax_debt',
    sql: 'SELECT c.id AS contractor_id, c.name AS cp, sum(r.amount) AS amount, sum(coalesce(r.paid, 0)) AS paid,\n       sum(r.amount - coalesce(r.paid, 0)) AS debt\nFROM reports r\nJOIN contractors c ON c.id = r.contractor_id\nWHERE NOT r.superseded AND r.amount > coalesce(r.paid, 0)\nGROUP BY c.id, c.name\nORDER BY debt DESC',
  },
  {
    id: 'with',
    sql: 'WITH rep AS (\n  SELECT r.contractor_id, count(*) AS reports, sum(coalesce(r.amount, 0)) AS tax\n  FROM reports r\n  WHERE NOT r.superseded\n  GROUP BY r.contractor_id\n), pay AS (\n  SELECT f.contractor_id, sum(f.amount) AS fee_paid\n  FROM fee_payments f\n  WHERE f.deleted_at IS NULL\n  GROUP BY f.contractor_id\n)\nSELECT c.id AS contractor_id, c.name AS cp, coalesce(rep.reports, 0) AS reports, coalesce(rep.tax, 0) AS tax,\n       coalesce(pay.fee_paid, 0) AS fee_paid\nFROM contractors c\nLEFT JOIN rep ON rep.contractor_id = c.id\nLEFT JOIN pay ON pay.contractor_id = c.id\nORDER BY c.name',
  },
  {
    id: 'som',
    sql: 'SELECT r.id, r.amount AS amount_tyiyn, round(r.amount / 100.0, 2) AS amount_som\nFROM reports r\nWHERE NOT r.superseded AND r.amount IS NOT NULL\nORDER BY r.due_date DESC\nLIMIT 100',
  },
  {
    id: 'overdue',
    sql: "SELECT c.id AS contractor_id, c.name AS cp, t.short_name AS rep, r.due_date,\n       current_date - r.due_date AS days\nFROM reports r\nJOIN contractors c ON c.id = r.contractor_id\nJOIN report_types t ON t.code = r.report_type_code\nWHERE NOT r.superseded AND r.status IN ('todo', 'in_progress', 'needs_fix') AND r.due_date < current_date\nORDER BY days DESC",
  },
  {
    id: 'fee_period',
    sql: 'SELECT c.id AS contractor_id, c.name AS cp, count(*) AS payments, sum(f.amount) AS paid\nFROM fee_payments f\nJOIN contractors c ON c.id = f.contractor_id\nWHERE f.deleted_at IS NULL AND f.paid_on BETWEEN :date_from AND :date_to\nGROUP BY c.id, c.name\nORDER BY paid DESC',
  },
  {
    id: 'ops_month',
    sql: "SELECT c.id AS contractor_id, c.name AS cp, m.op_date, m.kind, m.amount\nFROM money_operations m\nLEFT JOIN contractors c ON c.id = m.contractor_id\nWHERE m.cancelled_at IS NULL AND to_char(m.op_date, 'YYYY-MM') = :month\nORDER BY m.op_date, c.name",
  },
  {
    id: 'filter',
    sql: "SELECT e.short_name AS employee, count(*) AS tasks,\n       count(*) FILTER (WHERE t.status IN ('todo', 'in_progress', 'rework')) AS open,\n       count(*) FILTER (WHERE t.status = 'done') AS done\nFROM tasks t\nJOIN employees e ON e.id = t.executor_employee_id\nGROUP BY e.short_name\nORDER BY open DESC",
  },
  {
    id: 'window',
    sql: 'SELECT c.id AS contractor_id, c.name AS cp, r.due_date, r.amount,\n       sum(coalesce(r.amount, 0)) OVER (PARTITION BY r.contractor_id ORDER BY r.due_date) AS running\nFROM reports r\nJOIN contractors c ON c.id = r.contractor_id\nWHERE NOT r.superseded\nORDER BY c.name, r.due_date',
  },
  {
    id: 'no_resp',
    sql: "SELECT c.id AS contractor_id, c.name AS cp, c.inn, c.start_date\nFROM contractors c\nWHERE c.responsible_employee_id IS NULL AND c.service_status = 'active'\nORDER BY c.name",
  },
] as const satisfies readonly DmConsolePreset[];

export type DmConsolePresetId = (typeof DM_CONSOLE_PRESETS)[number]['id'];
