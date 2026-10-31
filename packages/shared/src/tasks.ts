import {
  REPORT_ACTS,
  REPORT_STATUSES,
  TASK_COMMENT_MAX,
  TASK_CONFIRM_NOTE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_REASON_MAX,
  TASK_STATUSES,
  TASK_TERMS,
  TASK_TITLE_MAX,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';
import { StatusHistoryEntry } from './status';

/*
 * Схемы модуля «Задачи» (задача 2.23): список, карточка, форма и действия ручной задачи. Ошибки полей
 * формы — ключи словаря (`task.form.title_required`), ошибки сервера — `err.<code>`.
 */

/** Без нулевого символа: PostgreSQL его в тексте не принимает. */
const noNul = (s: string) => !s.includes('\u0000');
/** Есть видимый символ (пробелы и U+200B не считаются). */
const visible = (s: string) => /[^\s\p{Cf}]/u.test(s);

const Text = (max: number) => z.string().trim().max(max).refine(noNul);
const Required = (max: number, message: string) =>
  z.string().trim().max(max).refine(visible, message).refine(noNul);

export const TaskStatusCode = z.enum(TASK_STATUSES);
export const TaskTerm = z.enum(TASK_TERMS);

/** Вкладка списка (прототип `taskTabs`). */
export const TaskTabParam = z.object({
  tab: z.enum(['mine', 'byme', 'all', 'overdue']).default('mine'),
});

const Person = z.object({ id: Uuid, shortName: z.string() });

/** Строка списка задач. */
export const TaskRow = z.object({
  id: Uuid,
  title: z.string(),
  category: z.object({ code: z.string(), name: z.string() }),
  /** null — общая задача. */
  contractor: z.object({ id: Uuid, name: z.string() }).nullable(),
  executor: Person,
  author: Person,
  term: TaskTerm,
  dueDate: IsoDate,
  needFile: z.boolean(),
  confirm: z.boolean(),
  status: TaskStatusCode,
  /** Просрочена на сегодня по Бишкеку (открыта, а срок прошёл). */
  overdue: z.boolean(),
  doneAt: z.iso.datetime().nullable(),
  /** Есть ли загруженный файл. */
  hasFile: z.boolean(),
  confirmedBy: Person.nullable(),
  /** Последняя смена статуса: когда и кем (null — система). */
  lastStatus: z.object({ at: z.iso.datetime(), by: z.string().nullable() }).nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type TaskRow = z.infer<typeof TaskRow>;

/**
 * Регулярная задача по отчёту (задача 2.24; ТЗ «Регулярные задачи — по отчётам»; прототип `allTasks`):
 * номер — номер отчёта; статус, отметка «Ждёт подтверждения» и шкала — отчёта; поставил — «Система».
 */
export const RegularTaskRow = z.object({
  kind: z.literal('regular'),
  id: Uuid,
  title: z.string(),
  /** `reg:sub` — «Сдача отчёта», `reg:pay` — «Оплата». */
  category: z.object({ code: z.string(), name: z.string() }),
  contractor: z.object({ id: Uuid, name: z.string() }),
  /** Ответственный за отчёт; null — не назначен. */
  executor: Person.nullable(),
  dueDate: IsoDate,
  needFile: z.boolean(),
  hasFile: z.boolean(),
  /** Открыта: отчёт не сдан или сдача ждёт подтверждения. */
  open: z.boolean(),
  /** Просрочена: отчёт не сдан, а срок прошёл. */
  overdue: z.boolean(),
  report: z.object({
    status: z.enum(REPORT_STATUSES),
    act: z.enum(REPORT_ACTS),
    /** Сумма к уплате и оплачено, тыйыны: «Сдача только после оплаты». */
    amount: z.number().int().nullable(),
    paid: z.number().int(),
    /** Отметка на шаге «Сдан» при включённом подтверждении сдачи. */
    mark: z.enum(['waiting', 'confirmed']).nullable(),
    confirmedBy: z.string().nullable(),
    /** Сколько дней сдача ждёт подтверждения. */
    waitDays: z.number().int().nonnegative(),
  }),
  lastStatus: z.object({ at: z.iso.datetime(), by: z.string().nullable() }).nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type RegularTaskRow = z.infer<typeof RegularTaskRow>;

/** Ручная задача в списке: признак вида и открыта ли. */
export const ManualTaskRow = TaskRow.extend({ kind: z.literal('manual'), open: z.boolean() });
export type ManualTaskRow = z.infer<typeof ManualTaskRow>;

/** Строка списка задач: ручная или регулярная. */
export const TaskListRow = z.discriminatedUnion('kind', [ManualTaskRow, RegularTaskRow]);
export type TaskListRow = z.infer<typeof TaskListRow>;

export const TaskList = listPageSchema(TaskListRow);
export type TaskList = z.infer<typeof TaskList>;

/** «Отчёты за месяц: сдано N из M»: регулярные задачи со сроком в текущем месяце. */
const MonthProgress = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * Счётчики вкладок и плашка «На подтверждении» (прототип `taskTabs`, `renderTasks`): мои открытые (и
 * регулярные),
 * поставленные мной открытые, просроченные; ждущие подтверждения и сколько из них можно подтвердить;
 * `monthStart` — с какого дня список («С <месяц>, вперёд и всё просроченное»); `empty` — задач в
 * организации ещё нет (прототип ui/empty.js).
 */
export const TaskSummary = z.object({
  mine: z.number().int().nonnegative(),
  byme: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  canConfirm: z.number().int().nonnegative(),
  monthStart: IsoDate,
  /** «Отчёты мои / всех за месяц: сдано N из M» (прототип `renderTasks`; не на «Поставленных мной»). */
  progress: z.object({ mine: MonthProgress, all: MonthProgress }),
  /** В организации ещё нет ни одной задачи: пустой список с подсказкой первого входа. */
  empty: z.boolean(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

/** Комментарий задачи. */
export const TaskComment = z.object({
  id: Uuid,
  author: z.string().nullable(),
  text: z.string(),
  at: z.iso.datetime(),
});
export type TaskComment = z.infer<typeof TaskComment>;

/** Запись истории задачи: что изменено, было → стало (сотрудник, контрагент, категория — названием). */
export const TaskHistoryEntry = z.object({
  at: z.iso.datetime(),
  actor: z.string().nullable(),
  action: z.string(),
  changes: z.array(
    z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
  ),
});
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntry>;

/** Карточка задачи (прототип `openTask`). */
export const Task = TaskRow.extend({
  description: z.string(),
  executorFullName: z.string(),
  executorActive: z.boolean(),
  categoryActive: z.boolean(),
  failReason: z.string(),
  reworkReason: z.string(),
  reworkBy: Person.nullable(),
  /** ФИО того, кто подтвердил (в карточке — «Подтвердил: <ФИО> вместо постановщика»). */
  confirmedByFullName: z.string().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  confirmNote: z.string(),
  /**
   * Функция «Файлы в карточках» включена: «Требуется файл» действует. Сами файлы и можно ли их
   * прикреплять — блок «Файлы» (`GET /api/files?kind=task&id=…`) по правам Файлового менеджера.
   */
  filesOn: z.boolean(),
  comments: z.array(TaskComment),
  statusHistory: z.array(StatusHistoryEntry),
  history: z.array(TaskHistoryEntry),
});
export type Task = z.infer<typeof Task>;

/** Поля формы задачи (прототип `taskDlg`). */
export const TaskFieldsBody = z.object({
  title: Required(TASK_TITLE_MAX, 'task.form.title_required'),
  description: Text(TASK_DESCRIPTION_MAX).default(''),
  categoryCode: z.string().trim().min(1).max(60).refine(noNul),
  /** null — «Общая». */
  contractorId: Uuid.nullable(),
  executorEmployeeId: Uuid,
  term: TaskTerm,
  /** «На день» — дата; «На месяц» — любой день месяца, срок станет последним днём. */
  dueDate: IsoDate,
  needFile: z.boolean(),
  confirm: z.boolean(),
});

export const CreateTaskRequest = TaskFieldsBody.strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const UpdateTaskRequest = TaskFieldsBody.extend({ version: RecordVersion }).strict();
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

/** Ответ на создание: номер задачи. */
export const TaskCreated = z.object({ id: Uuid });

/** Причина «Не выполнена» и «На доработку»: обязательна. */
const Reason = Required(TASK_REASON_MAX, 'task.reason_required');

/** «Выполнена»: файл задачи, если постановщик указал «Требуется файл». */
export const TaskDoneRequest = z.strictObject({ fileId: Uuid.nullable().default(null) });
export const TaskFailRequest = z.strictObject({ reason: Reason });
export const TaskReworkRequest = z.strictObject({ reason: Reason });
/** «Подтвердить»: комментарий необязательный. */
export const TaskConfirmRequest = z.strictObject({
  comment: Text(TASK_CONFIRM_NOTE_MAX).default(''),
});

export const TaskCommentRequest = z.strictObject({
  text: Required(TASK_COMMENT_MAX, 'task.comment.required'),
});

/**
 * Значения для формы задачи (прототип `taskDlg`): действующие категории и исполнители, контрагенты в
 * области без архивных (с ответственным — исполнителем по умолчанию), «Требуется подтверждение» по
 * учётной политике и включены ли «Файлы в карточках» (без них «Требуется файл» не предлагается).
 */
export const TaskFormOptions = z.object({
  categories: z.array(z.object({ code: z.string(), name: z.string() })),
  executors: z.array(z.object({ id: Uuid, shortName: z.string() })),
  contractors: z.array(
    z.object({ id: Uuid, name: z.string(), responsibleEmployeeId: Uuid.nullable() }),
  ),
  confirmDefault: z.boolean(),
  filesOn: z.boolean(),
});
export type TaskFormOptions = z.infer<typeof TaskFormOptions>;

/** Вкладка «Задачи» карточки контрагента: «Задач: N · открытых M» и последние 40. */
export const ContractorTasks = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  items: z.array(TaskListRow),
});
export type ContractorTasks = z.infer<typeof ContractorTasks>;
