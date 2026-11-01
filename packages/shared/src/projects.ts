import {
  HISTORY_ACTIONS,
  MONEY_AMOUNT_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_MEMBERS_MAX,
  PROJECT_NAME_MAX,
  PROJECT_NEW_STATUSES,
  PROJECT_STATUSES,
  PROJECT_WORK_NAME_MAX,
  PROJECT_WORKS_MAX,
  TASK_STATUSES,
  TASK_TERMS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { listPageSchema } from './list';
import { RollbackReason, StatusHistoryEntry } from './status';

/*
 * Схемы модуля «Проекты контрагентов» (задача 2.26; ТЗ «Модуль Проекты контрагентов»; прототип
 * modules/projects.js — `projCols`, `projTabs`, `renderProjects`, `openProject`, `projectDlg`;
 * modules/contractor-card.js — вкладка «Проекты»). Деньги — тыйыны; без права видеть деньги проектов
 * (прототип `moneyVis`) суммы не отдаются. Ошибки полей — `err.<код>` словаря.
 */

/** Без нулевого символа: PostgreSQL его в тексте не принимает. */
const noNul = (s: string) => !s.includes('\u0000');
const Text = (max: number) => z.string().trim().max(max).refine(noNul);

export const ProjectStatusCode = z.enum(PROJECT_STATUSES);

/** Вкладка списка (прототип `projTabs`): «Активные», «Все», «Мои». */
export const ProjectTabParam = z.object({
  tab: z.enum(['active', 'all', 'mine']).default('active'),
});

const Named = z.object({ id: Uuid, name: z.string() });

/** Строка списка проектов. */
export const ProjectRow = z.object({
  id: Uuid,
  name: z.string(),
  contractor: Named,
  status: ProjectStatusCode,
  startsOn: IsoDate,
  endsOn: IsoDate,
  lead: Named,
  members: z.array(Named),
  description: z.string(),
  worksDone: z.number().int().nonnegative(),
  worksTotal: z.number().int().nonnegative(),
  /** Есть работы с прошедшим сроком (значок у «Работ»). */
  worksOverdue: z.boolean(),
  files: z.number().int().nonnegative(),
  tasksOpen: z.number().int().nonnegative(),
  /** Деньги — только тому, кто их видит; иначе null. */
  plan: Tyiyn.nullable(),
  paid: Tyiyn.nullable(),
  /** Срок окончания прошёл, а проект ещё «В работе». */
  overdue: z.boolean(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type ProjectRow = z.infer<typeof ProjectRow>;

export const ProjectList = listPageSchema(ProjectRow);
export type ProjectList = z.infer<typeof ProjectList>;

/**
 * Числа вкладок и плашки (прототип `projTabs`, `renderProjects`): активные, мои активные, в работе,
 * планируются, срок прошёл, осталось получить (null — денег не видно); `any` — в организации есть
 * проекты (подсказка первого входа); что сотрудник может (кнопка «Проект», деньги, задачи).
 */
export const ProjectSummary = z.object({
  active: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  left: Tyiyn.nullable(),
  any: z.boolean(),
  can: z.object({
    /** «Вести проекты и разовые услуги»: «Проект», «Изменить», шаги шкалы, «Отменить проект». */
    keep: z.boolean(),
    /** «Откат статусов». */
    rollback: z.boolean(),
    /** «Задача по проекту»: включены «Задачи» и есть право «Ставить задачи». */
    task: z.boolean(),
    /** Деньги проектов (прототип `moneyVis`). */
    money: z.boolean(),
  }),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectIdParam = z.object({ id: Uuid });
export const ProjectWorkParam = z.object({ id: Uuid, workId: Uuid });

const ProjectHistory = z.array(
  z.object({
    id: z.number().int(),
    at: z.iso.datetime(),
    actor: z.string().nullable(),
    action: z.enum(HISTORY_ACTIONS),
    changes: z.array(
      z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
    ),
    reason: z.string().nullable(),
  }),
);

/** Карточка проекта (прототип `openProject`). */
export const ProjectCard = z.object({
  id: Uuid,
  version: RecordVersion,
  name: z.string(),
  contractor: z.object({ id: Uuid, name: z.string(), archived: z.boolean() }),
  status: ProjectStatusCode,
  startsOn: IsoDate,
  endsOn: IsoDate,
  description: z.string(),
  overdue: z.boolean(),
  lead: Named,
  members: z.array(Named),
  /** «Деньги по проекту» — тому, кто видит деньги; иначе null. */
  money: z.object({ plan: Tyiyn.nullable(), paid: Tyiyn }).nullable(),
  works: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      executor: Named,
      due: IsoDate.nullable(),
      done: z.boolean(),
      overdue: z.boolean(),
    }),
  ),
  /** «Задачи · N» — при включённых «Задачах»; иначе null. */
  tasks: z
    .array(
      z.object({
        id: Uuid,
        title: z.string(),
        executorName: z.string(),
        dueDate: IsoDate,
        term: z.enum(TASK_TERMS),
        status: z.enum(TASK_STATUSES),
        overdue: z.boolean(),
      }),
    )
    .nullable(),
  /** Блок «Файлы»: «Файлы в карточках» включены и есть право «Просматривать файлы». */
  files: z.boolean(),
  statusHistory: z.array(StatusHistoryEntry),
  history: ProjectHistory,
  /** Имена сотрудников из истории (исполнитель работы, ответственные «было → стало»). */
  names: z.record(z.string(), z.string()),
  audit: RecordAudit,
  can: z.object({
    keep: z.boolean(),
    /** Отмечать и добавлять работы, прикреплять файлы: «Вести проекты» или ответственный проекта. */
    works: z.boolean(),
    rollback: z.boolean(),
    task: z.boolean(),
  }),
});
export type ProjectCard = z.infer<typeof ProjectCard>;

/** Окно проекта (прототип `projectDlg`): контрагенты области, действующие сотрудники. */
export const ProjectForm = z.object({
  contractors: z.array(z.object({ id: Uuid, name: z.string(), responsible: Uuid.nullable() })),
  employees: z.array(Named),
  /** Сотрудник, который открыл окно (ответственный по умолчанию). */
  me: Uuid.nullable(),
  today: IsoDate,
  /** Поле «Планируемая стоимость» — тому, кто видит деньги проектов. */
  money: z.boolean(),
});
export type ProjectForm = z.infer<typeof ProjectForm>;

export const ProjectFormQuery = z.object({ contractorId: Uuid.optional() });

const Plan = Tyiyn.refine((v) => v >= 0, 'project_plan_invalid').refine(
  (v) => v <= MONEY_AMOUNT_MAX,
  'project_plan_invalid',
);

const WorkBody = z.object({
  name: Text(PROJECT_WORK_NAME_MAX),
  executorId: Uuid,
  due: IsoDate.nullable(),
});

/**
 * Поля окна: название, срок, описание, стоимость (без права видеть деньги — не меняется), ответственные
 * и главный, работы. Правила (название, даты, ответственные) проверяет сервер — отказ у поля.
 */
const ProjectFields = {
  name: Text(PROJECT_NAME_MAX),
  startsOn: IsoDate,
  endsOn: IsoDate,
  description: Text(PROJECT_DESCRIPTION_MAX).default(''),
  plan: Plan.nullable(),
  members: z.array(Uuid).max(PROJECT_MEMBERS_MAX),
  lead: Uuid,
};

/** «Создать проект»: контрагент и статус «Планируется» или «В работе»; файлы прикрепляют в карточке. */
export const ProjectRequest = z.strictObject({
  contractorId: Uuid,
  status: z.enum(PROJECT_NEW_STATUSES).default('planned'),
  ...ProjectFields,
  works: z.array(WorkBody).max(PROJECT_WORKS_MAX).default([]),
});
export type ProjectRequest = z.input<typeof ProjectRequest>;

/** «Сохранить» в окне «Изменить проект»: у прежних работ — номер. */
export const ProjectEditRequest = z.strictObject({
  version: RecordVersion,
  ...ProjectFields,
  works: z
    .array(WorkBody.extend({ id: Uuid.optional() }))
    .max(PROJECT_WORKS_MAX)
    .default([]),
});
export type ProjectEditRequest = z.input<typeof ProjectEditRequest>;

export const ProjectSaved = z.object({ id: Uuid });
export type ProjectSaved = z.infer<typeof ProjectSaved>;

/**
 * Смена статуса: шаг вперёд по шкале («В работу», «Завершить»), «Отменить проект» или откат на шаг
 * (тогда причина обязательна).
 */
export const ProjectStatusRequest = z.strictObject({
  to: ProjectStatusCode,
  version: RecordVersion,
  reason: RollbackReason.optional(),
});
export type ProjectStatusRequest = z.input<typeof ProjectStatusRequest>;

/** «Добавить работу» в карточке: исполнитель — один из ответственных проекта. */
export const ProjectWorkRequest = z.strictObject(WorkBody.shape);
export type ProjectWorkRequest = z.input<typeof ProjectWorkRequest>;

/** Галочка «Сделано» у работы. */
export const ProjectWorkDoneRequest = z.strictObject({ done: z.boolean() });

/** Вкладка «Проекты» карточки контрагента (прототип contractor-card.js). */
export const ContractorProjects = z.object({
  items: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      startsOn: IsoDate,
      endsOn: IsoDate,
      status: ProjectStatusCode,
      leadName: z.string(),
      /** Без права видеть деньги — null. */
      money: z.object({ plan: Tyiyn.nullable(), paid: Tyiyn }).nullable(),
    }),
  ),
  /** «Новый проект»: право «Вести проекты», контрагент не в архиве. */
  canCreate: z.boolean(),
  money: z.boolean(),
});
export type ContractorProjects = z.infer<typeof ContractorProjects>;

/** Поле «Проект» формы задачи: проекты контрагента, кроме отменённых и завершённых. */
export const TaskProjectsQuery = z.object({ contractorId: Uuid, current: Uuid.optional() });
export const TaskProjects = z.object({ items: z.array(Named) });
export type TaskProjects = z.infer<typeof TaskProjects>;
