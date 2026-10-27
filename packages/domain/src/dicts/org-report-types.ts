import { isValidRemindDays, REMIND_DAYS_MESSAGE } from '../org/policy';
import type { ReportAct } from '../platform-dicts/catalog';

/*
 * Подключение вида отчёта и настройки организации по виду (ТЗ «Справочники» → «Виды отчётов»):
 * подключают только действующий вид каталога; настройки меняются у подключённого вида; у вида
 * «Уплата» нет настройки «Файл при сдаче обязателен». Отключить вид, назначенный действующим
 * контрагентам, нельзя — это правило появится вместе с назначениями (задача 2.06).
 */

/** Что меняют в строке организации по виду отчёта. */
export interface OrgReportTypeChange {
  enabled?: boolean;
  remindDays?: readonly number[];
  needFile?: boolean;
  needReceipt?: boolean;
}

export const ORG_REPORT_TYPE_PROBLEMS = [
  'report_type_inactive',
  'report_type_not_connected',
  'need_file_pay',
  'remind_days_invalid',
] as const;
export type OrgReportTypeProblem = (typeof ORG_REPORT_TYPE_PROBLEMS)[number];

export const ORG_REPORT_TYPE_MESSAGES: Record<OrgReportTypeProblem, string> = {
  report_type_inactive: 'Вид отчёта отключён в каталоге платформы — подключить его нельзя',
  report_type_not_connected: 'Вид отчёта не подключён: сначала подключите его',
  need_file_pay: 'У вида «Уплата» нет настройки «Файл при сдаче обязателен»',
  remind_days_invalid: REMIND_DAYS_MESSAGE,
};

/**
 * Почему так изменить строку организации по виду нельзя; null — можно. `current` — строка
 * организации (null — вид ещё ни разу не подключали).
 */
export function orgReportTypeProblem(
  type: { active: boolean; act: ReportAct },
  current: { enabled: boolean } | null,
  change: OrgReportTypeChange,
): OrgReportTypeProblem | null {
  const wasEnabled = current?.enabled ?? false;
  if (change.enabled === true && !wasEnabled && !type.active) return 'report_type_inactive';
  const enabled = change.enabled ?? wasEnabled;
  const settings =
    change.remindDays !== undefined ||
    change.needFile !== undefined ||
    change.needReceipt !== undefined;
  if (!current && change.enabled !== true) return 'report_type_not_connected';
  if (settings && !enabled) return 'report_type_not_connected';
  if (change.needFile === true && type.act === 'pay') return 'need_file_pay';
  if (change.remindDays && !isValidRemindDays(change.remindDays)) return 'remind_days_invalid';
  return null;
}
