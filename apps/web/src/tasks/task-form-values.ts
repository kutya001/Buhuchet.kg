import {
  addDays,
  taskConfirmEditable,
  taskPending,
  type IsoDate,
  type TaskTerm,
  type UiTextKey,
} from '@buhuchet/domain';
import type { CreateTaskRequest, Task, TaskFormOptions } from '@buhuchet/shared';

/** Вид задачи — первым полем формы (ТЗ «Ручные задачи»). */
export type TaskFormScope = 'general' | 'contractor';

/** Поля формы задачи (прототип modules/tasks.js, `taskDlg`). */
export interface TaskFormValues {
  scope: TaskFormScope;
  title: string;
  description: string;
  categoryCode: string;
  contractorId: string;
  executorEmployeeId: string;
  term: TaskTerm;
  /** «На день»: дата ГГГГ-ММ-ДД. */
  date: string;
  /** «На месяц»: месяц ГГГГ-ММ. */
  month: string;
  needFile: boolean;
  confirm: boolean;
}

/** Что подставить в новую задачу: из карточки контрагента — «По контрагенту» с ним. */
export interface TaskFormPreset {
  contractorId?: string;
}

/** Вариант списка формы: код и подпись. */
export interface TaskFormOption {
  value: string;
  label: string;
}

/**
 * Исполнитель по умолчанию (прототип `taskExec0`): ответственный выбранного контрагента, если он
 * действующий сотрудник; иначе (и у общей задачи) — тот, кто ставит задачу.
 */
export function defaultExecutor(
  options: Pick<TaskFormOptions, 'contractors' | 'executors'>,
  contractorId: string,
  employeeId: string,
): string {
  const responsible = options.contractors.find((c) => c.id === contractorId)?.responsibleEmployeeId;
  return responsible && options.executors.some((e) => e.id === responsible)
    ? responsible
    : employeeId;
}

/**
 * Значения формы: у новой — «Общая» (из карточки контрагента — «По контрагенту» с ним), первая
 * категория, исполнитель по умолчанию, «На день» на завтра, «Требуется подтверждение» — из учётной
 * политики; у существующей — её поля.
 */
export function initialTaskForm({
  task,
  preset,
  options,
  employeeId,
  today,
}: {
  task: Task | null;
  preset?: TaskFormPreset | undefined;
  options: TaskFormOptions;
  employeeId: string;
  today: IsoDate;
}): TaskFormValues {
  if (task) {
    return {
      scope: task.contractor ? 'contractor' : 'general',
      title: task.title,
      description: task.description,
      categoryCode: task.category.code,
      contractorId: task.contractor?.id ?? '',
      executorEmployeeId: task.executor.id,
      term: task.term,
      date: task.dueDate,
      month: task.dueDate.slice(0, 7),
      needFile: task.needFile,
      confirm: task.confirm,
    };
  }
  const contractorId = preset?.contractorId ?? '';
  return {
    scope: contractorId ? 'contractor' : 'general',
    title: '',
    description: '',
    categoryCode: options.categories[0]?.code ?? '',
    contractorId,
    executorEmployeeId: defaultExecutor(options, contractorId, employeeId),
    term: 'day',
    date: addDays(today, 1),
    month: today.slice(0, 7),
    needFile: false,
    confirm: options.confirmDefault,
  };
}

/**
 * Варианты списков формы: действующие из справочников; у изменяемой задачи — и её нынешние
 * категория, исполнитель и контрагент, даже если они отключены, заблокированы или в архиве (сервер
 * сохраняет неизменённое значение как есть).
 */
export function taskFormLists(
  options: TaskFormOptions,
  task: Task | null,
): { categories: TaskFormOption[]; executors: TaskFormOption[]; contractors: TaskFormOption[] } {
  const withCurrent = (list: TaskFormOption[], current: TaskFormOption | null) =>
    current && !list.some((o) => o.value === current.value) ? [...list, current] : list;
  return {
    categories: withCurrent(
      options.categories.map((c) => ({ value: c.code, label: c.name })),
      task ? { value: task.category.code, label: task.category.name } : null,
    ),
    executors: withCurrent(
      options.executors.map((e) => ({ value: e.id, label: e.shortName })),
      task ? { value: task.executor.id, label: task.executor.shortName } : null,
    ),
    contractors: withCurrent(
      options.contractors.map((c) => ({ value: c.id, label: c.name })),
      task?.contractor ? { value: task.contractor.id, label: task.contractor.name } : null,
    ),
  };
}

export type TaskFormField = 'title' | 'contractorId' | 'executorEmployeeId' | 'date' | 'month';

/** Ошибки полей до отправки (прототип `taskDlg` → «Поставить задачу»): ключи словаря. */
export function taskFormProblems(v: TaskFormValues): Partial<Record<TaskFormField, UiTextKey>> {
  const problems: Partial<Record<TaskFormField, UiTextKey>> = {};
  if (!/[^\s\p{Cf}]/u.test(v.title)) problems.title = 'task.form.title_required';
  if (v.scope === 'contractor' && !v.contractorId) problems.contractorId = 'task.form.cp_required';
  if (!v.executorEmployeeId) problems.executorEmployeeId = 'task.form.exec_required';
  if (v.term === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(v.date))
    problems.date = 'task.form.date_required';
  if (v.term === 'month' && !/^\d{4}-\d{2}$/.test(v.month))
    problems.month = 'task.form.month_required';
  return problems;
}

/**
 * Тело запроса: у «Общая» контрагента нет; «На месяц» — первый день месяца (срок — последний день
 * ставит сервер).
 */
export function taskFormBody(v: TaskFormValues): CreateTaskRequest {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    categoryCode: v.categoryCode,
    contractorId: v.scope === 'contractor' ? v.contractorId : null,
    executorEmployeeId: v.executorEmployeeId,
    term: v.term,
    dueDate: v.term === 'month' ? `${v.month}-01` : v.date,
    needFile: v.needFile,
    confirm: v.confirm,
  };
}

/**
 * Подсказка под «Требуется подтверждение» (прототип `taskDlg`): у закрытой — признак не меняется; у
 * ждущей подтверждения — «Если снять, задача сразу станет «Выполнена»»; иначе — «По умолчанию — из
 * учётной политики».
 */
export function confirmHint(task: Pick<Task, 'status'> | null): {
  key: UiTextKey;
  locked: boolean;
} {
  if (task && !taskConfirmEditable(task.status))
    return { key: 'task.form.confirm_closed', locked: true };
  if (task && taskPending(task.status)) return { key: 'task.form.confirm_pending', locked: false };
  return { key: 'task.form.confirm_default', locked: false };
}
