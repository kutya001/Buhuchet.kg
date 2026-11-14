import type { ReportMonthPlanRow } from '@buhuchet/db';
import { monthPlanGroup, monthPlanItem, monthToPay, type YearMonth } from '@buhuchet/domain';

/**
 * Налоги месяца к оплате из строк «по месяцам»: одно правило домена `monthToPay`. Тот же расчёт — у
 * блока карточки, текста «Скопировать для клиента» и сообщения «К оплате» клиенту в Telegram.
 */
export function monthPayRows(
  reports: readonly ReportMonthPlanRow[],
  month: YearMonth,
  taxpay: boolean,
) {
  // При равном сроке — по краткому названию вида, как строки таблицы месяца (docs/deviations.md п. К-1),
  // дальше — в порядке создания отчётов.
  const created = new Map(reports.map((r, i) => [r.id, i]));
  const pay = monthToPay(
    monthPlanGroup(
      month,
      reports.map((r) => monthPlanItem(r, { taxpay })),
    ),
    {
      taxpay,
      tie: (a, b) =>
        a.typeShort.localeCompare(b.typeShort, 'ru') || created.get(a.id)! - created.get(b.id)!,
    },
  );
  const rows = pay.rows.map((x) => ({
    reportId: x.report.id,
    name: x.report.typeShort,
    left: x.left,
    due: x.due,
  }));
  return { pay, rows };
}
