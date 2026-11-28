import {
  SERIES_COUNT_MAX,
  SERIES_END_KINDS,
  SERIES_EVERY_MAX,
  SERIES_MONTH_MODES,
  SERIES_STATES,
  SERIES_STOP_REASONS,
  SERIES_UNITS,
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

/**
 * Правило повтора (доработки 28.11.2026: повторяющиеся задачи, блок 2; прототип `tsDlg`): интервал
 * 1–99 и единица; дни недели (0 — понедельник … 6 — воскресенье) — у «недели»; «Когда» — у «месяца»;
 * окончание — «Никогда», дата или число повторов (1–999). Остальные проверки — `seriesRuleProblems`.
 */
export const SeriesRuleBody = z.strictObject({
  every: z.number().int().min(1).max(SERIES_EVERY_MAX),
  unit: z.enum(SERIES_UNITS),
  weekDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  monthMode: z.enum(SERIES_MONTH_MODES).optional(),
  end: z.strictObject({
    kind: z.enum(SERIES_END_KINDS),
    date: IsoDate.nullable().optional(),
    count: z.number().int().min(1).max(SERIES_COUNT_MAX).nullable().optional(),
  }),
});
export type SeriesRuleBody = z.infer<typeof SeriesRuleBody>;

export const SeriesState = z.enum(SERIES_STATES);
export const SeriesStopReason = z.enum(SERIES_STOP_REASONS);

/** «Только эту задачу» или «Эту и следующие» (прототип `tsAsk`). */
export const SeriesScope = z.enum(['one', 'next']);
export type SeriesScope = z.infer<typeof SeriesScope>;

/**
 * Строка «Повтор» в карточке задачи (блок 4, пункт 2; прототип `tsCardHtml`): правило словами,
 * следующая дата, состояние и причина; «Изменить повтор», «Остановить», «Возобновить» — постановщику и
 * владельцу (`refusal` — подсказка неактивной кнопки постановщику без права; null и `manage: false` —
 * кнопок нет).
 */
export const TaskSeriesInfo = z.object({
  id: Uuid,
  rule: SeriesRuleBody,
  start: IsoDate,
  term: TaskTerm,
  text: z.string(),
  state: SeriesState,
  stopReason: SeriesStopReason.nullable(),
  /** Причина остановки без человека словами; у ручной и у действующей — пусто. */
  stopText: z.string(),
  /** Дата следующей задачи, которую серия ещё поставит; пусто — не поставит. */
  next: IsoDate.nullable(),
  /** Сколько задач серии поставлено («Все задачи серии · N»). */
  count: z.number().int().nonnegative(),
  manage: z.boolean(),
  refusal: z.string().nullable(),
  version: RecordVersion,
});
export type TaskSeriesInfo = z.infer<typeof TaskSeriesInfo>;

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
  /** Проект контрагента (задача 2.26); null — задача не по проекту. */
  project: z.object({ id: Uuid, name: z.string() }).nullable(),
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
  /** Задача серии: правило словами (значок «↻» и подсказка, столбец «Повтор»); разовая — null. */
  repeat: z.string().nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type TaskRow = z.infer<typeof TaskRow>;

/** Ручная задача в списке: признак вида и открыта ли. */
export const ManualTaskRow = TaskRow.extend({ kind: z.literal('manual'), open: z.boolean() });
export type ManualTaskRow = z.infer<typeof ManualTaskRow>;

/** Строка списка задач: только ручные задачи (решение заказчика 17.11.2026 — отчётов в «Задачах» нет). */
export const TaskListRow = ManualTaskRow;
export type TaskListRow = z.infer<typeof TaskListRow>;

export const TaskList = listPageSchema(TaskListRow);
export type TaskList = z.infer<typeof TaskList>;

/**
 * Счётчики вкладок и плашка «На подтверждении» (прототип `taskTabs`, `renderTasks`): мои открытые,
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
  /** В организации ещё нет ни одной задачи: пустой список с подсказкой первого входа. */
  empty: z.boolean(),
  /** Вкладка «Повторы» — действующие серии (только с правом «Ставить задачи», иначе null). */
  series: z.number().int().nonnegative().nullable(),
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
  /** Откуда сделано: `telegram` — кнопкой или ответом в чате бота («через Telegram»); пусто — на сайте. */
  via: z.enum(['telegram']).nullable().optional(),
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
  /** Серия повтора задачи; у разовой — null. */
  series: TaskSeriesInfo.nullable(),
});
export type Task = z.infer<typeof Task>;

/** Поля формы задачи (прототип `taskDlg`). */
export const TaskFieldsBody = z.object({
  title: Required(TASK_TITLE_MAX, 'task.form.title_required'),
  description: Text(TASK_DESCRIPTION_MAX).default(''),
  categoryCode: z.string().trim().min(1).max(60).refine(noNul),
  /** null — «Общая». */
  contractorId: Uuid.nullable(),
  /** «Проект» (галочка формы, задача 2.26): проект выбранного контрагента; null — не по проекту. */
  projectId: Uuid.nullable().default(null),
  executorEmployeeId: Uuid,
  term: TaskTerm,
  /** «На день» — дата; «На месяц» — любой день месяца, срок станет последним днём. */
  dueDate: IsoDate,
  needFile: z.boolean(),
  confirm: z.boolean(),
});

/** «Новая задача»: `repeat` — правило повтора, null — «Не повторять». Срок — «Начало» повтора. */
export const CreateTaskRequest = TaskFieldsBody.extend({
  repeat: SeriesRuleBody.nullable().default(null),
}).strict();
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

/**
 * «Изменить задачу»: у разовой открытой задачи `repeat` добавляет повтор (срок — начало); у задачи серии
 * `scope` — «Только эту задачу» или «Эту и следующие», правило (`repeat`) меняется только во втором.
 * Нет `repeat` — правило не меняется.
 */
export const UpdateTaskRequest = TaskFieldsBody.extend({
  version: RecordVersion,
  repeat: SeriesRuleBody.nullable().optional(),
  scope: SeriesScope.default('one'),
}).strict();
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequest>;

/** «Отменить задачу» серии: «Только эту задачу» или «Эту и следующие» (повтор остановлен). */
export const TaskCancelQuery = z.object({ scope: SeriesScope.default('one') });

/** «Изменить повтор» (карточка задачи и вкладка «Повторы»): правило и начало, версия серии. */
export const SeriesRuleUpdate = z.strictObject({
  rule: SeriesRuleBody,
  start: IsoDate,
  version: RecordVersion,
});
export type SeriesRuleUpdate = z.infer<typeof SeriesRuleUpdate>;

/** Ответ «Изменить повтор», «Остановить», «Возобновить»: серия и поставлена ли задача на ближайшую дату. */
export const SeriesActionResult = z.object({
  series: TaskSeriesInfo,
  made: z.boolean(),
});
export type SeriesActionResult = z.infer<typeof SeriesActionResult>;

/** «Остановить повтор», «Возобновить»: версия серии. */
export const SeriesVersionBody = z.strictObject({ version: RecordVersion });

/**
 * «Все задачи серии» (прототип `tsListDlg`): срок, исполнитель, статус — новые сверху; `series` — серия
 * целиком (правило, версия, права): по ней действует меню строки вкладки «Повторы».
 */
export const SeriesTasks = z.object({
  title: z.string(),
  text: z.string(),
  series: TaskSeriesInfo,
  items: z.array(
    z.object({
      id: Uuid,
      dueDate: IsoDate,
      term: TaskTerm,
      executor: z.string().nullable(),
      status: TaskStatusCode,
    }),
  ),
});
export type SeriesTasks = z.infer<typeof SeriesTasks>;

/**
 * Строка вкладки «Повторы» (блок 4, пункт 3; прототип `tsRender`): одна строка на серию; `task` —
 * ближайшая задача серии (клик по строке открывает её).
 */
export const SeriesListRow = z.object({
  id: Uuid,
  title: z.string(),
  text: z.string(),
  executor: z.object({ id: Uuid, shortName: z.string() }),
  contractor: z.object({ id: Uuid, name: z.string() }).nullable(),
  next: IsoDate.nullable(),
  end: z.string(),
  state: SeriesState,
  stopText: z.string(),
  author: z.object({ id: Uuid, shortName: z.string() }),
  createdAt: z.iso.datetime(),
  made: z.number().int().nonnegative(),
  task: Uuid.nullable(),
  manage: z.boolean(),
  refusal: z.string().nullable(),
  version: RecordVersion,
});
export type SeriesListRow = z.infer<typeof SeriesListRow>;
export const SeriesList = listPageSchema(SeriesListRow);
export type SeriesList = z.infer<typeof SeriesList>;

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
    z.object({
      id: Uuid,
      name: z.string(),
      /** ИНН — для поиска в списке (прототип v93). */
      inn: z.string(),
      responsibleEmployeeId: Uuid.nullable(),
    }),
  ),
  confirmDefault: z.boolean(),
  filesOn: z.boolean(),
  /** Включены «Проекты контрагентов»: в форме есть галочка «Проект». */
  projectsOn: z.boolean(),
});
export type TaskFormOptions = z.infer<typeof TaskFormOptions>;

/**
 * Доска задач (прототип `taskKanban`, `show.exec`): действующие сотрудники — столбцы доски «Столбцы:
 * Исполнитель», которые видны и без задач. Без права «Видеть задачи всех» список пуст.
 */
export const TaskBoardOptions = z.object({
  executors: z.array(z.object({ id: Uuid, shortName: z.string() })),
});
export type TaskBoardOptions = z.infer<typeof TaskBoardOptions>;

/** Вкладка «Задачи» карточки контрагента: «Задач: N · открытых M» и последние 40. */
export const ContractorTasks = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  items: z.array(TaskListRow),
});
export type ContractorTasks = z.infer<typeof ContractorTasks>;
