import {
  ASSIGNMENT_DUE_DAYS,
  REPORT_ACTS,
  REPORT_PERIODS,
  REPORT_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { SocfundBrief } from './contractors';
import { listPageSchema } from './list';
import { StatusHistoryEntry } from './status';

/*
 * Модуль «Отчеты для сдачи» (задача 2.06): назначения отчётов контрагентам, разовый отчёт, «Изменить
 * срок», уточнённый отчёт, список и карточка отчёта. Экраны — задачи 2.11, 2.13–2.15.
 */

/** Без нулевого символа: PostgreSQL его в тексте не принимает. */
const noNul = (s: string) => !s.includes('\u0000');
const Code = z.string().trim().min(1).max(60).refine(noNul);
const Text = (max: number) => z.string().trim().max(max).refine(noNul);

/**
 * Дата ввода отчётов и назначений — с 2000 по 2100 год: без этого «с какого периода» в далёком прошлом
 * создало бы тысячи прошлых отчётов одним сохранением.
 */
const ReportDate = IsoDate.refine(
  (d) => d >= '2000-01-01' && d <= '2100-12-31',
  'Дата — с 2000 по 2100 год',
);

/** Первое число месяца: «с какого периода», «до какого», месяц разового отчёта. */
const Month = ReportDate.refine((d) => d.endsWith('-01'), 'Первое число месяца');

/** Примечание назначения и комментарий к изменению срока. */
export const REPORT_NOTE_MAX = 500;

/** Строка «Ставок единого налога» в назначении: код ЕНС и номер варианта ставки (пусто — первый). */
export const AssignmentEnRate = z.strictObject({
  code: Code,
  variant: z.number().int().min(0).max(20).nullable(),
});

/** Поля назначения, которые меняет «Изменить» (все — необязательные). */
const assignmentFields = {
  untilMonth: Month.nullable(),
  /** Пусто — ответственный контрагента. */
  responsibleEmployeeId: Uuid.nullable(),
  rate: Text(60).min(1).nullable(),
  enRates: z.array(AssignmentEnRate).max(20),
  rateAdditions: z.array(Code).max(20),
  /** «Вариант срока»: до 10, 15, 20, 25-го числа, 31 — до последнего дня; пусто — как в каталоге. */
  dueDay: z
    .number()
    .int()
    .refine(
      (d) => (ASSIGNMENT_DUE_DAYS as readonly number[]).includes(d),
      'Нет такого варианта срока',
    )
    .nullable(),
  ownPeriod: z.enum(REPORT_PERIODS).nullable(),
  ownDay: z.number().int().min(1).max(31).nullable(),
  ownMonth: z.number().int().min(0).max(12).nullable(),
  /** Повторяющаяся сумма, тыйыны. */
  fixedAmount: Tyiyn.min(0).nullable(),
  note: Text(REPORT_NOTE_MAX),
};

/**
 * Новое назначение (прототип assignDlg, asgDlg): `fromMonth` пусто — первый период, за который сегодня
 * должен быть отчёт; `markPast` — «Сразу отметить прошлые периоды сданными» (прошлые периоды создаются
 * в любом случае).
 */
export const AssignmentCreate = z.strictObject({
  contractorId: Uuid,
  reportTypeCode: Code,
  fromMonth: Month.nullable().default(null),
  untilMonth: assignmentFields.untilMonth.default(null),
  responsibleEmployeeId: assignmentFields.responsibleEmployeeId.default(null),
  rate: assignmentFields.rate.default(null),
  enRates: assignmentFields.enRates.default([]),
  rateAdditions: assignmentFields.rateAdditions.default([]),
  dueDay: assignmentFields.dueDay.default(null),
  ownPeriod: assignmentFields.ownPeriod.default(null),
  ownDay: assignmentFields.ownDay.default(null),
  ownMonth: assignmentFields.ownMonth.default(null),
  fixedAmount: assignmentFields.fixedAmount.default(null),
  note: assignmentFields.note.default(''),
  markPast: z.boolean().default(true),
});
export type AssignmentCreate = z.infer<typeof AssignmentCreate>;

/** «Изменить» назначение: только изменённые поля и версия. */
export const AssignmentUpdate = z.strictObject({
  fromMonth: Month.optional(),
  ...(Object.fromEntries(Object.entries(assignmentFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof assignmentFields]: z.ZodOptional<(typeof assignmentFields)[K]>;
  }),
  markPast: z.boolean().default(true),
  version: RecordVersion,
});
export type AssignmentUpdate = z.infer<typeof AssignmentUpdate>;

/** «Снять назначение»: с сегодняшнего дня. */
export const AssignmentEnd = z.strictObject({ version: RecordVersion });

/** Что увидит пользователь до сохранения: «с какого периода» по умолчанию и прошлые периоды без отчётов. */
export const AssignmentPreviewRequest = z.strictObject({
  contractorId: Uuid,
  reportTypeCode: Code,
  fromMonth: Month.nullable().default(null),
  untilMonth: assignmentFields.untilMonth.default(null),
  dueDay: assignmentFields.dueDay.default(null),
  ownPeriod: assignmentFields.ownPeriod.default(null),
  ownDay: assignmentFields.ownDay.default(null),
  ownMonth: assignmentFields.ownMonth.default(null),
});

export const AssignmentPreview = z.object({
  defaultFrom: IsoDate,
  fromMonth: IsoDate,
  /** Закончившиеся периоды без отчётов: их создаст сохранение. */
  missing: z.array(z.object({ periodStart: IsoDate, label: z.string() })),
});
export type AssignmentPreview = z.infer<typeof AssignmentPreview>;

/** Назначение в карточке контрагента. */
export const Assignment = z.object({
  id: Uuid,
  contractorId: Uuid,
  reportTypeCode: z.string(),
  reportTypeName: z.string(),
  reportTypeShort: z.string(),
  fromMonth: IsoDate,
  untilMonth: IsoDate.nullable(),
  endedOn: IsoDate.nullable(),
  responsibleEmployeeId: Uuid.nullable(),
  responsible: z.object({ id: Uuid, shortName: z.string() }).nullable(),
  rate: z.string().nullable(),
  enRates: z.array(z.object({ code: z.string(), variant: z.number().int().nullable() })),
  rateAdditions: z.array(z.string()),
  rateText: z.string(),
  /** Орган, куда сдаётся вид. */
  authority: z.string(),
  /** Срок сдачи словами по действующему правилу: вид, статус контрагента, «Вариант срока». */
  dueText: z.string(),
  /** Статус контрагента, который задаёт срок (метка «по статусу»). */
  dueStatus: z.object({ code: z.string(), name: z.string() }).nullable(),
  /** Периодичность отчётов назначения; у вида с периодичностью в назначении — своя. */
  period: z.enum(REPORT_PERIODS),
  periodInAssignment: z.boolean(),
  oneOff: z.boolean(),
  act: z.enum(REPORT_ACTS),
  /** false — вид отключён в каталоге платформы (метка «Вид отключён»). */
  typeActive: z.boolean(),
  dueDay: z.number().int().nullable(),
  ownPeriod: z.enum(REPORT_PERIODS).nullable(),
  ownDay: z.number().int().nullable(),
  ownMonth: z.number().int().nullable(),
  fixedAmount: Tyiyn.nullable(),
  note: z.string(),
  version: RecordVersion,
});
export type Assignment = z.infer<typeof Assignment>;

export const AssignmentList = z.object({ items: z.array(Assignment) });

/** Что сделало сохранение назначения с отчётами. */
export const AssignmentSaved = z.object({
  id: Uuid,
  version: RecordVersion,
  created: z.number().int().nonnegative(),
  past: z.number().int().nonnegative(),
  restored: z.number().int().nonnegative(),
  notRequired: z.number().int().nonnegative(),
  redue: z.number().int().nonnegative(),
});
export type AssignmentSaved = z.infer<typeof AssignmentSaved>;

export const AssignmentEnded = z.object({
  id: Uuid,
  version: RecordVersion,
  notRequired: z.number().int().nonnegative(),
});

export const AssignmentIdParam = z.object({ id: Uuid });
export const ReportIdParam = z.object({ id: Uuid });

const Person = z.object({ id: Uuid, shortName: z.string() });

/** Строка списка отчётов (прототип repCols): тексты, как в столбцах экрана. */
export const ReportRow = z.object({
  id: Uuid,
  contractor: z.object({ id: Uuid, name: z.string(), inn: z.string() }),
  taxOffice: z.string().nullable(),
  type: z.object({ code: z.string(), name: z.string(), shortName: z.string() }),
  act: z.enum(REPORT_ACTS),
  rate: z.string().nullable(),
  organ: z.string(),
  period: z.enum(REPORT_PERIODS),
  periodStart: IsoDate,
  eventDate: IsoDate.nullable(),
  periodLabel: z.string(),
  periodFull: z.string(),
  revision: z.number().int().nonnegative(),
  dueDate: IsoDate,
  dueBase: IsoDate,
  dueManual: z.boolean(),
  /** Срок перенесён с нерабочего дня: название праздника, у выходного — пусто; без переноса — null. */
  dueHoliday: z.string().nullable(),
  days: z.number().int().nullable(),
  overdue: z.boolean(),
  status: z.enum(REPORT_STATUSES),
  submittedOn: IsoDate.nullable(),
  /** Когда и кто отметил «Сдан» (у отмеченных при назначении — пусто). */
  submittedAt: z.iso.datetime().nullable(),
  submittedBy: Person.nullable(),
  /** Сколько дней сдача ждёт подтверждения (подтверждённый и несданный — пусто). */
  waitDays: z.number().int().nullable(),
  /** Подтверждение сдачи: когда и кто (отметка на шаге «Сдан»). */
  confirmedAt: z.iso.datetime().nullable(),
  confirmedBy: Person.nullable(),
  /** Последняя смена статуса: когда и кем (под шкалой в строке). */
  lastStatus: z.object({ at: z.iso.datetime(), by: z.string().nullable() }).nullable(),
  amount: Tyiyn.nullable(),
  amountAuto: z.boolean(),
  payDue: IsoDate.nullable(),
  pays: z.string(),
  responsible: Person.nullable(),
  formCode: z.string(),
  ownershipForm: z.string(),
  regime: z.string().nullable(),
  audit: RecordAudit,
  version: RecordVersion,
});
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportList = listPageSchema(ReportRow);
export type ReportList = z.infer<typeof ReportList>;

/**
 * Вкладка списка (прототип repTabs) и быстрый фильтр над ним «Все / Сдать / Уплатить» (ТЗ «Метка «Что
 * нужно сделать»»).
 */
export const ReportTabParam = z.object({
  tab: z.enum(['week', 'overdue', 'waiting', 'all']).default('all'),
  quick: z.enum(['all', 'sub', 'pay']).default('all'),
});
export type ReportTab = z.infer<typeof ReportTabParam>['tab'];
export type ReportQuick = z.infer<typeof ReportTabParam>['quick'];

const Count = z.number().int().nonnegative();
const QuickCounts = z.object({ all: Count, sub: Count, pay: Count });

/**
 * Счётчики вкладок, плашки и числа быстрого фильтра в области сотрудника (прототип counts,
 * renderReports): `month` — первое число текущего месяца, `weekFrom` и `weekTo` — «На этой неделе»,
 * `waitDays` — через сколько дней ожидания старшим бухгалтерам уходит напоминание (учётная политика),
 * `empty` — в организации ещё нет отчётов.
 */
export const ReportTabCounts = z.object({
  overdue: Count,
  week: Count,
  waiting: Count,
  submittedMonth: Count,
  toPayMonth: Tyiyn,
  quick: z.object({
    week: QuickCounts,
    overdue: QuickCounts,
    waiting: QuickCounts,
    all: QuickCounts,
  }),
  month: IsoDate,
  weekFrom: IsoDate,
  weekTo: IsoDate,
  waitDays: z.number().int().nonnegative(),
  empty: z.boolean(),
});
export type ReportTabCounts = z.infer<typeof ReportTabCounts>;

/** Карточка отчёта: поля строки, назначение, журнал изменений срока, «История статусов», версии. */
export const ReportCard = ReportRow.extend({
  superseded: z.boolean(),
  assignment: z
    .object({
      id: Uuid,
      rateText: z.string(),
      fixedAmount: Tyiyn.nullable(),
      note: z.string(),
      endedOn: IsoDate.nullable(),
    })
    .nullable(),
  dueChanges: z.array(
    z.object({
      at: z.iso.datetime(),
      fromDue: IsoDate.nullable(),
      toDue: IsoDate,
      reason: z.string(),
      comment: z.string(),
      actor: z.string().nullable(),
    }),
  ),
  statusHistory: z.array(StatusHistoryEntry),
  /**
   * Тариф Соцфонда у вида со взносами (STI-161; ТЗ «Связь с отчётами»): выбранный у контрагента и тариф
   * по условиям; null — у вида взносов нет или тариф контрагенту не нужен.
   */
  socfund: z
    .object({
      tariff: SocfundBrief.nullable(),
      auto: SocfundBrief.nullable(),
      /** «Взносы не начисляются на часть зарплаты выше предельной базы (…)»; '' — нет базы или тарифа. */
      capHint: z.string(),
    })
    .nullable(),
  /** Подсказка о пене у просроченного (ТЗ «Пеня (информационно)»); '' — подсказки нет. */
  penalty: z.string(),
  versions: z.array(
    z.object({
      id: Uuid,
      revision: z.number().int().nonnegative(),
      status: z.enum(REPORT_STATUSES),
      dueDate: IsoDate,
      superseded: z.boolean(),
    }),
  ),
});
export type ReportCard = z.infer<typeof ReportCard>;

/** «Изменить срок»: новый срок, причина из справочника платформы, комментарий. */
export const ReportDueChange = z.strictObject({
  due: ReportDate,
  reasonCode: Code,
  comment: Text(REPORT_NOTE_MAX).default(''),
  version: RecordVersion,
});

/**
 * «Разовый отчёт» (прототип adhocDlg): месяц периода — у обычного вида, дата события — у разового;
 * срок обязателен у обычного вида, у разового пусто — по правилу вида от даты события.
 */
export const ManualReportCreate = z.strictObject({
  contractorId: Uuid,
  reportTypeCode: Code,
  month: Month.nullable().default(null),
  eventDate: ReportDate.nullable().default(null),
  due: ReportDate.nullable().default(null),
  reasonCode: Code,
});

/** Списки окна «Разовый отчёт»: контрагенты в области (кроме архивных) и подключённые действующие виды. */
export const ManualReportOptions = z.object({
  contractors: z.array(z.object({ id: Uuid, name: z.string() })),
  types: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      shortName: z.string(),
      act: z.enum(REPORT_ACTS),
      oneOff: z.boolean(),
      /** Подпись даты события разового вида («Дата ввоза»); пусто — «Дата события». */
      eventLabel: z.string(),
      /** Срок словами (прототип ruleText): «в течение 15 дней после события». */
      dueText: z.string(),
    }),
  ),
});
export type ManualReportOptions = z.infer<typeof ManualReportOptions>;

/** Срок разового вида по дате события — до сохранения (прототип adhocDlg, `evDue`). */
export const ManualReportDueQuery = z.object({
  contractorId: Uuid,
  reportTypeCode: Code,
  eventDate: ReportDate,
});
export const ManualReportDue = z.object({ due: IsoDate.nullable() });

/** «Создать уточнённый»: версия сданного отчёта. */
export const ReportRevisionCreate = z.strictObject({ version: RecordVersion });

/** Созданный или изменённый отчёт: номер и версия записи (карточку интерфейс перечитывает). */
export const ReportSaved = z.object({ id: Uuid, version: RecordVersion });
export type ReportSaved = z.infer<typeof ReportSaved>;
