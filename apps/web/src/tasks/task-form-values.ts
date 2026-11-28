import {
  addDays,
  lastDayOf,
  seriesRuleEqual,
  taskConfirmEditable,
  taskPending,
  type IsoDate,
  type TaskTerm,
  type UiTextKey,
} from '@buhuchet/domain';
import type {
  CreateTaskRequest,
  SeriesRuleBody,
  SeriesScope,
  Task,
  TaskFormOptions,
  UpdateTaskRequest,
} from '@buhuchet/shared';

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
  /** Проект контрагента (при включённых «Проектах контрагентов»; задача 2.26); пусто — «Без проекта». */
  projectId: string;
  /** Повтор (доработки 28.11.2026): у новой — «Не повторять»; у задачи серии — правило серии. */
  repeat: SeriesRuleBody | null;
}

/**
 * Что подставить в новую задачу: из карточки контрагента — «По контрагенту» с ним; «Задача по
 * проекту» — ещё проект и исполнитель (главный ответственный проекта).
 */
export interface TaskFormPreset {
  contractorId?: string;
  projectId?: string;
  executorEmployeeId?: string;
}

/** Вариант списка формы: код и подпись. */
export interface TaskFormOption {
  value: string;
  label: string;
}

/** Контрагент в списке формы: с ИНН для поиска (у архивного контрагента изменяемой задачи его нет). */
export interface TaskFormContractor extends TaskFormOption {
  inn: string;
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
      // Без поля «Проект» (функция выключена или нет права «Просматривать проекты») проект задачи не
      // отправляется — сервер оставляет его, пока не сменили контрагента.
      projectId: options.projectsOn ? (task.project?.id ?? '') : '',
      repeat: task.series?.rule ?? null,
    };
  }
  const contractorId = preset?.contractorId ?? '';
  const executor = preset?.executorEmployeeId;
  return {
    scope: contractorId ? 'contractor' : 'general',
    title: '',
    description: '',
    categoryCode: options.categories[0]?.code ?? '',
    contractorId,
    executorEmployeeId:
      executor && options.executors.some((e) => e.id === executor)
        ? executor
        : defaultExecutor(options, contractorId, employeeId),
    term: 'day',
    date: addDays(today, 1),
    month: today.slice(0, 7),
    needFile: false,
    confirm: options.confirmDefault,
    projectId: options.projectsOn && contractorId ? (preset?.projectId ?? '') : '',
    repeat: null,
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
): {
  categories: TaskFormOption[];
  executors: TaskFormOption[];
  contractors: TaskFormContractor[];
} {
  const withCurrent = <T extends TaskFormOption>(list: T[], current: T | null) =>
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
    // ОТКЛОНЕНИЕ: docs/deviations.md#И-3 — у архивного контрагента задачи (его нет в списке) ИНН не показан.
    contractors: withCurrent(
      options.contractors.map((c) => ({ value: c.id, label: c.name, inn: c.inn })),
      task?.contractor ? { value: task.contractor.id, label: task.contractor.name, inn: '' } : null,
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
 * Тело запроса: у «Общая» контрагента и проекта нет; проект необязателен («Без проекта»); «На месяц» —
 * первый день месяца (срок — последний день ставит сервер).
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
    projectId: v.scope === 'contractor' && v.projectId ? v.projectId : null,
    repeat: v.repeat,
  };
}

/** «Начало» повтора — срок в форме (прототип `repStart`): у «На месяц» — последний день месяца. */
export function repeatStart(v: Pick<TaskFormValues, 'term' | 'date' | 'month'>, today: IsoDate): IsoDate {
  if (v.term === 'month') return lastDayOf(/^\d{4}-\d{2}$/.test(v.month) ? v.month : today.slice(0, 7));
  return /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : addDays(today, 1);
}

/**
 * Смена вида срока на «На месяц» (прототип `tk-kind`): повтор по дням или неделям становится
 * «каждый месяц».
 */
export function repeatForTerm(rule: SeriesRuleBody | null, term: TaskTerm): SeriesRuleBody | null {
  if (!rule || term !== 'month' || (rule.unit !== 'day' && rule.unit !== 'week')) return rule;
  const { weekDays: _days, monthMode: _mode, ...rest } = rule;
  return { ...rest, unit: 'month' };
}

/** Правило повтора задачи серии изменили в форме (прототип `ruleCh`). */
export function repeatChanged(v: Pick<TaskFormValues, 'repeat'>, task: Task | null): boolean {
  const series = task?.series;
  return !!series && !!v.repeat && !seriesRuleEqual(v.repeat, series.rule);
}

/**
 * Тело «Изменить задачу»: у задачи серии — «Только эту» или «Эту и следующие» (правило — только во
 * втором и только изменённое); у разовой открытой — повтор, если его добавили.
 */
export function taskEditBody(
  v: TaskFormValues,
  task: Task,
  scope: SeriesScope,
): Omit<UpdateTaskRequest, 'version'> {
  const { repeat, ...fields } = taskFormBody(v);
  if (task.series) {
    return {
      ...fields,
      scope,
      ...(scope === 'next' && repeatChanged(v, task) ? { repeat } : {}),
    };
  }
  return { ...fields, scope: 'one', ...(repeat ? { repeat } : {}) };
}

/**
 * Подсказка под «нужно подтверждение» (прототип `taskDlg`, v136): у закрытой — признак не меняется; у
 * ждущей подтверждения — «Если снять, задача сразу станет «Выполнена»»; иначе подсказки нет.
 */
export function confirmHint(task: Pick<Task, 'status'> | null): {
  key: UiTextKey | null;
  locked: boolean;
} {
  if (task && !taskConfirmEditable(task.status))
    return { key: 'task.form.confirm_closed', locked: true };
  if (task && taskPending(task.status)) return { key: 'task.form.confirm_pending', locked: false };
  return { key: null, locked: false };
}

/**
 * «Дополнительно» раскрыто сразу (прототип `taskDlg`, `st.more`, v136): у изменяемой задачи с описанием,
 * проектом, сроком «На месяц» или «нужен файл» — иначе заполненное редкое поле было бы не видно.
 */
export function taskFormMoreOpen(task: Task | null): boolean {
  return !!task && (!!task.description || !!task.project || task.term === 'month' || task.needFile);
}

/**
 * «· заполнено N» у «Дополнительно» (прототип `taskDlg`, `nMore`): описание, проект, срок «На месяц»,
 * «нужен файл», категория не первая из справочника, у новой задачи — «нужно подтверждение» не как в
 * учётной политике.
 */
export function taskFormMoreFilled(
  v: TaskFormValues,
  options: Pick<TaskFormOptions, 'categories' | 'confirmDefault'>,
  isNew: boolean,
): number {
  return [
    v.description.trim() !== '',
    v.scope === 'contractor' && v.projectId !== '',
    v.term === 'month',
    v.needFile,
    v.categoryCode !== (options.categories[0]?.code ?? ''),
    isNew && v.confirm !== options.confirmDefault,
  ].filter(Boolean).length;
}
