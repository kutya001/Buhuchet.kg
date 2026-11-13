import { isValidRemindDays, normalizeRemindDays, REMIND_DAYS_MESSAGE } from '../org/policy';
import type { ReportAct } from '../platform-dicts/catalog';

/*
 * Подключение вида отчёта и настройки организации по виду (ТЗ «Справочники» → «Виды отчётов»):
 * подключают только действующий вид каталога; настройки меняются у подключённого вида; у вида
 * «Уплата» нет настройки «Файл при сдаче обязателен». Отключить вид, назначенный действующим
 * контрагентам, нельзя (прототип modules/dicts.js: «Отключить нельзя»).
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
  'report_type_assigned',
] as const;
export type OrgReportTypeProblem = (typeof ORG_REPORT_TYPE_PROBLEMS)[number];

export const ORG_REPORT_TYPE_MESSAGES: Record<OrgReportTypeProblem, string> = {
  report_type_inactive: 'Вид отчёта отключён в каталоге платформы — подключить его нельзя',
  report_type_not_connected: 'Вид отчёта не подключён: сначала подключите его',
  need_file_pay: 'У вида «Уплата» нет настройки «Файл при сдаче обязателен»',
  remind_days_invalid: REMIND_DAYS_MESSAGE,
  report_type_assigned:
    'Отключить нельзя: вид назначен действующим контрагентам. Сначала снимите назначения на вкладке «Кто что сдаёт»',
};

/**
 * Почему так изменить строку организации по виду нельзя; null — можно. `current` — строка
 * организации (null — вид ещё ни разу не подключали); `assigned` — у скольких действующих
 * контрагентов вид назначен.
 */
export function orgReportTypeProblem(
  type: { active: boolean; act: ReportAct },
  current: { enabled: boolean } | null,
  change: OrgReportTypeChange,
  assigned = 0,
): OrgReportTypeProblem | null {
  const wasEnabled = current?.enabled ?? false;
  if (change.enabled === false && wasEnabled && assigned > 0) return 'report_type_assigned';
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

/*
 * Массовые изменения видов отчётов (прототип v84 modules/dicts.js: typesBulkOn, typesBulkDlg): галочки
 * в списке и действия «Подключить», «Настроить», «Отключить». Правило решает по каждому выбранному виду,
 * что с ним сделать; вид, которому действие не подходит, пропускается — остальные меняются.
 */

/** Действие над отмеченными видами. */
export const ORG_REPORT_TYPE_BULK_ACTIONS = ['connect', 'disconnect', 'setup'] as const;
export type OrgReportTypeBulkAction = (typeof ORG_REPORT_TYPE_BULK_ACTIONS)[number];

/** Сколько видов можно изменить одним действием: с запасом больше каталога платформы. */
export const ORG_REPORT_TYPE_BULK_MAX = 200;

/** Окно «Настроить виды отчётов»: `undefined` — «Не менять». */
export interface OrgReportTypeBulkSetup {
  needFile?: boolean;
  needReceipt?: boolean;
  /** «Задать заново»: набор дней (пустой — только в день срока). */
  remindDays?: readonly number[];
  /** «Подключить неподключённые виды»; без неё настройки получают только подключённые. */
  connect: boolean;
}

/** Строка организации по виду, как её видит правило. */
export interface OrgReportTypeState {
  enabled: boolean;
  remindDays: readonly number[];
  needFile: boolean;
  needReceipt: boolean;
}

/** Что сделать с видом: `create` — строка появляется впервые, `patch` — меняются только эти поля. */
export type OrgReportTypeBulkStep =
  | { kind: 'create'; values: OrgReportTypeState }
  | { kind: 'patch'; patch: Partial<OrgReportTypeState> }
  /** Вид назначен действующим контрагентам — остаётся подключённым. */
  | { kind: 'busy' }
  | null;

const sameDays = (a: readonly number[], b: readonly number[]) =>
  normalizeRemindDays(a).join() === normalizeRemindDays(b).join();

/** «Подключить»: уже подключённый и отключённый в каталоге — пропуск; прежние настройки сохраняются. */
export function bulkConnectStep(
  type: { active: boolean },
  current: OrgReportTypeState | null,
  policyDays: readonly number[],
): OrgReportTypeBulkStep {
  if (current?.enabled || !type.active) return null;
  if (current) return { kind: 'patch', patch: { enabled: true } };
  return {
    kind: 'create',
    values: {
      enabled: true,
      remindDays: normalizeRemindDays(policyDays),
      needFile: false,
      needReceipt: false,
    },
  };
}

/** «Отключить»: неподключённый — пропуск, назначенный действующим контрагентам — `busy`. */
export function bulkDisconnectStep(
  current: OrgReportTypeState | null,
  assigned: number,
): OrgReportTypeBulkStep {
  if (!current?.enabled) return null;
  if (assigned > 0) return { kind: 'busy' };
  return { kind: 'patch', patch: { enabled: false } };
}

/**
 * «Настроить»: неподключённый вид меняется только с галочкой «Подключить неподключённые» (новая строка
 * — с днями учётной политики, если дни не заданы заново); «Файл при сдаче» у вида «только оплата» не
 * ставится; вид, у которого всё уже так, пропускается.
 */
export function bulkSetupStep(
  type: { active: boolean; act: ReportAct },
  current: OrgReportTypeState | null,
  setup: OrgReportTypeBulkSetup,
  policyDays: readonly number[],
): OrgReportTypeBulkStep {
  const connect = bulkConnectStep(type, current, policyDays);
  const wasEnabled = current?.enabled ?? false;
  if (!wasEnabled && (!setup.connect || !connect)) return null;
  const base: OrgReportTypeState =
    connect?.kind === 'create' ? connect.values : { ...current!, enabled: true };
  const patch: Partial<OrgReportTypeState> = wasEnabled ? {} : { enabled: true };
  if (setup.needFile !== undefined && type.act !== 'pay' && base.needFile !== setup.needFile) {
    patch.needFile = setup.needFile;
  }
  if (setup.needReceipt !== undefined && base.needReceipt !== setup.needReceipt) {
    patch.needReceipt = setup.needReceipt;
  }
  if (setup.remindDays && !sameDays(setup.remindDays, base.remindDays)) {
    patch.remindDays = normalizeRemindDays(setup.remindDays);
  }
  if (connect?.kind === 'create') return { kind: 'create', values: { ...base, ...patch } };
  return Object.keys(patch).length ? { kind: 'patch', patch } : null;
}

/** В окне «Настроить» ничего не выбрано: всё «Не менять» и подключать нечего. */
export function bulkSetupEmpty(setup: OrgReportTypeBulkSetup): boolean {
  return (
    setup.needFile === undefined &&
    setup.needReceipt === undefined &&
    setup.remindDays === undefined &&
    !setup.connect
  );
}
