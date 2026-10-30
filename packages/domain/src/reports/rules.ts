import { addDays, weekdayMondayFirst, type IsoDate } from '../common/dates';
import { STATUS_SCALE_DEFS } from '../common/status';

/*
 * Статусы отчёта и правила назначений (ТЗ «Отчеты для сдачи» → «Назначение отчётов контрагентам»,
 * «Сдача отчёта», «Уточнённые отчёты», «Разовый отчёт»; прототип modules/contractors.js: assignTypes,
 * unassignDlg, asgDlg, transferCp, repUnfinished; ui/status-scale.js: createRevision;
 * modules/report-card.js: adhocDlg).
 */

/** Статусы сдачи отчёта (шкала `report`): шаги, «Требует исправления» и «Не требуется». */
export const REPORT_STATUSES = [
  'todo',
  'in_progress',
  'submitted',
  'needs_fix',
  'not_required',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Несданные статусы (прототип OPEN): срок может пройти — отчёт просрочен. */
export const OPEN_REPORT_STATUSES: ReadonlySet<ReportStatus> = new Set([
  'todo',
  'in_progress',
  'needs_fix',
]);

/** Отметки подтверждения на шаге «Сдан» — не статусы отчёта, а его отметки (задача 2.14). */
export const REPORT_MARKS = STATUS_SCALE_DEFS.report.marks ?? [];

/**
 * Снятие назначения или «до какого периода»: несданные отчёты, срок которых ещё не прошёл, получают «Не
 * требуется»; сданные и просроченные остаются (прототип unassignDlg).
 */
export const endsWithAssignment = (r: { status: ReportStatus; dueDate: IsoDate }, today: IsoDate) =>
  OPEN_REPORT_STATUSES.has(r.status) && r.dueDate >= today;

/**
 * Повторное назначение возвращает в «К сдаче» отчёт «Не требуется», который не сдавали, срок которого
 * ещё не прошёл (прототип assignTypes); обслуживание контрагента в этом периоде проверяет вызывающий.
 */
export const restoredByAssignment = (
  r: { status: ReportStatus; dueDate: IsoDate; submitted: boolean },
  today: IsoDate,
) => r.status === 'not_required' && !r.submitted && r.dueDate >= today;

/**
 * Незавершённый отчёт переходит к новому ответственному контрагента вместе с ним (прототип
 * repUnfinished, transferCp): не «Не требуется» и не «Сдан»; неоплаченный сданный добавит задача 2.19.
 */
export const reportUnfinished = (r: { status: ReportStatus; superseded: boolean }) =>
  !r.superseded && r.status !== 'not_required' && r.status !== 'submitted';

/** Срок уточнённого отчёта: не раньше срока прежней версии и не раньше чем через 10 дней. */
export const REVISION_DUE_DAYS = 10;

export function revisionDue(previousDue: IsoDate, today: IsoDate): IsoDate {
  const soon = addDays(today, REVISION_DUE_DAYS);
  return previousDue > soon ? previousDue : soon;
}

/**
 * Строка «Ставок единого налога» в назначении (прототип a.en): код ЕНС и, у ставки с вариантами по месту
 * или виду (общепит «Бишкек и Ош — 5 %, остальная территория — 3 %»), номер варианта; пусто — первый.
 */
export interface AssignmentEnRate {
  code: string;
  variant: number | null;
}

/** «Разовый отчёт» по умолчанию: месяц периода — прошлый, срок — через неделю (прототип adhocDlg). */
export const MANUAL_REPORT_DUE_DAYS = 7;

/**
 * Неделя вкладки «На неделе» (прототип weekRange): с понедельника по воскресенье текущей недели, а в
 * субботу и воскресенье — следующей.
 */
export function reportWeek(today: IsoDate): { from: IsoDate; to: IsoDate } {
  const wd = weekdayMondayFirst(today);
  const monday = addDays(today, -wd + (wd >= 5 ? 7 : 0));
  return { from: monday, to: addDays(monday, 6) };
}

/** Отказы действий с назначениями и отчётами (коды ответа API и тексты прототипа). */
export const REPORT_MESSAGES = {
  // Тот же код и текст, что у «Удалить» в «Контрагентах»: архивный контрагент — только чтение.
  contractor_archived: 'Контрагент в архиве — сначала верните его из архива',
  assignment_exists: 'Этот вид отчёта уже назначен контрагенту: один вид — одно назначение',
  assignment_ended: 'Назначение снято: изменить его нельзя, назначьте вид снова',
  contractor_oneoff:
    'Разовому контрагенту регулярные отчёты не назначаются — создайте разовый отчёт',
  report_exists: 'Такой отчёт уже есть: один контрагент + вид + период = один отчёт',
  report_event_exists:
    'Отчёт по этому событию уже есть: один контрагент + вид + дата события = один отчёт',
  report_not_open: 'Срок меняется только у несданного отчёта',
  report_pay_only: 'У вида «Уплата» срок сдачи не меняется',
  report_not_submitted: 'Уточнённый создаётся только у сданного отчёта',
  report_superseded: 'Это прежняя версия отчёта: действия — в последней версии',
  event_date_required: 'Укажите дату события',
  month_required: 'Укажите месяц',
  due_required: 'Укажите срок',
  reason_invalid: 'Нет такой причины в справочнике «Причины изменения срока отчёта»',
  // Сдача и подтверждение (задача 2.14; тексты прототипа ui/status-scale.js).
  report_not_open_submit: 'Сдать можно только несданный отчёт',
  report_pay_only_submit: 'У вида «Уплата» нет сдачи — только оплата',
  report_step_invalid: 'Этот шаг недоступен в нынешнем статусе отчёта',
  submit_date_invalid: 'Укажите дату не позже сегодняшней',
  report_file_required: 'Прикрепите файл: так настроен этот вид отчёта',
  report_receipt_required: 'Приложите квитанцию о приёме: так настроен этот вид отчёта',
  report_file_not_found: 'Файл не прикреплён к этому отчёту',
  report_not_waiting: 'Отчёт не ждёт подтверждения',
  report_confirm_right: 'Нужно право «Подтверждать сдачу отчётов»',
  report_confirm_own:
    'Свой сданный отчёт подтвердить нельзя: подтверждает другой сотрудник с правом',
  report_fix_reason: 'Укажите, что исправить: без причины вернуть нельзя',
  report_no_amount: 'У этого вида отчёта суммы нет',
  report_amount_not_required: 'У отчёта «Не требуется» сумма не указывается',
  report_amount_required: 'Введите сумму числом, например 1 250,50',
  report_lines_invalid: 'Строки суммы: выручку и налог введите числом не меньше нуля',
  report_rollback_superseded: 'Сначала откатите уточнённую версию отчёта',
  report_rollback_none: 'Откатывать некуда: это первый шаг',
  report_not_required_invalid: 'Сданный и подтверждённый отчёт «Не требуется» не отмечается',
} as const;
export type ReportMessageCode = keyof typeof REPORT_MESSAGES;
