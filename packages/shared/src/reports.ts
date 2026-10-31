import {
  ASSIGNMENT_DUE_DAYS,
  PAYMENT_STATUSES,
  REPORT_ACTS,
  REPORT_LINE_KINDS,
  REPORT_PERIODS,
  REPORT_STATUSES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordAudit, RecordVersion, Tyiyn, Uuid } from './common';
import { SocfundBrief } from './contractors';
import { listPageSchema } from './list';
import { ReportFunds } from './money';
import { StatusHistoryEntry, StatusRollback } from './status';

/*
 * Модуль «Отчеты для сдачи» (задача 2.06): назначения отчётов контрагентам, разовый отчёт, «Изменить
 * срок», уточнённый отчёт, список и карточка отчёта; сдача, подтверждение, откат и сумма — задача 2.14.
 * Экраны — задачи 2.11, 2.13–2.15.
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
  /** `archived` — контрагент в архиве: «Принять» не показывается (прототип canRecv). */
  contractor: z.object({ id: Uuid, name: z.string(), inn: z.string(), archived: z.boolean() }),
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
  /** «Оплачено в бюджет», в том числе «Оплатил контрагент сам» (`selfPaid`). */
  paid: Tyiyn,
  selfPaid: Tyiyn,
  /** «Получено от контрагента»: его деньги, оплаченные по отчёту и отложенные под него. */
  received: Tyiyn,
  /** Принято под отчёт детализацией поступлений: «Принять» в «Деньгах (сверка)» — пока меньше суммы. */
  receivedFor: Tyiyn,
  paymentStatus: z.enum(PAYMENT_STATUSES),
  /** Просрочена оплата (при «Учёте оплаты налогов»). */
  payOverdue: z.boolean(),
  /** Сверка «Деньги»: только у отчёта, который ждёт денег. */
  funds: ReportFunds.nullable(),
  payDue: IsoDate.nullable(),
  pays: z.string(),
  /**
   * Настройки вида в организации: «Файл при сдаче обязателен», «Квитанция о приёме обязательна»;
   * `hasFiles` — у отчёта есть загруженные файлы (окна массовой сдачи и подтверждения).
   */
  needFile: z.boolean(),
  needReceipt: z.boolean(),
  hasFiles: z.boolean(),
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
  tab: z.enum(['week', 'overdue', 'waiting', 'all', 'calendar']).default('all'),
  quick: z.enum(['all', 'sub', 'pay']).default('all'),
  /** Только отчёты контрагента: вкладка «Отчёты к сдаче» его карточки. */
  contractorId: Uuid.optional(),
  /** Вкладка «Календарь»: день, отчёты которого показать (прототип `S.calSel`). */
  day: ReportDate.optional(),
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
  /** «оплачено …» под «К уплате за <месяц>» (при «Учёте оплаты налогов»). */
  paidMonth: Tyiyn,
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
/** Строка суммы отчёта (по ставке или по платежу): выручка и налог в тыйынах. */
export const ReportLine = z.object({
  kind: z.enum(REPORT_LINE_KINDS),
  key: z.string(),
  label: z.string(),
  pct: z.string(),
  cash: z.boolean().nullable(),
  revenue: Tyiyn.nullable(),
  tax: Tyiyn,
});

/** Строка окна «Сдан» и «Указать сумму»: подпись, ставка, наличная ли выручка, прежняя ли строка. */
export const ReportLineDef = z.object({
  kind: z.enum(REPORT_LINE_KINDS),
  key: z.string(),
  label: z.string(),
  pct: z.string(),
  cash: z.boolean().nullable(),
  old: z.boolean(),
  kbk: z.string().optional(),
});

/** Запись истории отчёта: кто, когда, что изменено (было → стало). */
export const ReportHistoryEntry = z.object({
  at: z.iso.datetime(),
  actor: z.string().nullable(),
  action: z.string(),
  reason: z.string().nullable(),
  changes: z.array(
    z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
  ),
});
export type ReportHistoryEntry = z.infer<typeof ReportHistoryEntry>;

/**
 * Деньги отчёта в карточке (задача 2.19; прототип report-card.js): деньги контрагента на счетах, график
 * оплаты, оплаты для «Истории статусов» оплаты и что можно сделать.
 */
export const ReportCardMoney = z.object({
  /** Деньги контрагента на счетах (окно «Отметить оплаченным»); null — оплачивать нельзя. */
  available: Tyiyn.nullable(),
  schedule: z.array(z.object({ due: IsoDate, amount: Tyiyn, paid: Tyiyn })),
  payments: z.array(
    z.object({
      at: z.iso.datetime(),
      amount: Tyiyn,
      self: z.boolean(),
      date: IsoDate,
      actor: z.string().nullable(),
      file: z.object({ id: Uuid, name: z.string() }).nullable(),
      cancelled: z
        .object({ at: z.iso.datetime(), actor: z.string().nullable(), reason: z.string() })
        .nullable(),
    }),
  ),
  /** «Отметить оплаченным» и «Принять деньги»: право «Учёт денег», область «Финансовые операции». */
  canPay: z.boolean(),
  canReceive: z.boolean(),
  /** Откат шкалы оплаты: ещё и право «Откат статусов». */
  canCancel: z.boolean(),
});
export type ReportCardMoney = z.infer<typeof ReportCardMoney>;

export const ReportCard = ReportRow.extend({
  superseded: z.boolean(),
  /** «Учёт оплаты налогов» и «Сдача отчёта только после оплаты» (учётная политика). */
  taxpay: z.boolean(),
  payFirst: z.boolean(),
  /** Деньги отчёта; null — у вида нет суммы. Без «Учёта оплаты налогов» — только график оплаты. */
  money: ReportCardMoney.nullable(),
  /** Отметка на шаге «Сдан» при подтверждении сдачи: «Ждёт подтверждения» или «Подтверждено». */
  mark: z.enum(['waiting', 'confirmed']).nullable(),
  /** Комментарий подтверждения. */
  confirmNote: z.string(),
  /** Строки суммы и строки окна «Сдан» (по ставкам и по платежам). */
  lines: z.array(ReportLine),
  lineDefs: z.array(ReportLineDef),
  /** «Что уплачивается»: платёж, получатель, код бюджетной классификации. */
  payments: z.array(z.object({ name: z.string(), authority: z.string(), kbk: z.string() })),
  /**
   * Загруженные файлы отчёта (блок «Файлы» — `GET /api/files?kind=report&id=…`); без «Файлов в
   * карточках» — пусто.
   */
  files: z.array(z.object({ id: Uuid, name: z.string() })),
  filesOn: z.boolean(),
  /** Без файла «Сдан» не ставится; без квитанции сдачу не подтвердить (настройки вида в организации). */
  fileRequired: z.boolean(),
  receiptRequired: z.boolean(),
  /** «Повторять эту сумму»: повторяющаяся сумма действующего назначения; null — назначения нет. */
  repeat: z.object({ fixedAmount: Tyiyn.nullable() }).nullable(),
  /** Возврат «На исправление» или «Требует исправления»: кто, когда, причина. */
  fix: z
    .object({ at: z.iso.datetime(), actor: z.string().nullable(), reason: z.string().nullable() })
    .nullable(),
  history: z.array(ReportHistoryEntry),
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
      confirmed: z.boolean(),
      amount: Tyiyn.nullable(),
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

/** «Разовый отчёт» создан: срок после переноса с нерабочего дня — для уведомления «перенесён на …». */
export const ManualReportSaved = ReportSaved.extend({ dueDate: IsoDate });
export type ManualReportSaved = z.infer<typeof ManualReportSaved>;

/* ───────────── Сдача, подтверждение, откат и сумма (задача 2.14) ───────────── */

/** Сумма не меньше нуля, в тыйынах. */
const Amount = Tyiyn.refine((v) => v >= 0, 'Сумма не меньше нуля');

/** Строк суммы в окне — не больше (строки ЕНС, налога с продаж и платежей). */
export const REPORT_LINES_MAX = 60;
/** Файлов, загруженных в окне «Сдан» или «Подтвердить», — не больше. */
export const REPORT_FILES_MAX = 20;
/** Отчётов в одном массовом действии — не больше (выбор на странице списка). */
export const REPORT_BATCH_MAX = 500;

/** Введённое в строке суммы: выручка и налог (пусто — не введено). */
const ReportLineEntry = z.strictObject({
  key: Code,
  revenue: Amount.nullable().default(null),
  tax: Amount.nullable().default(null),
});

const amountFields = {
  /** Сумма к уплате; при строках — итог строк, это поле не учитывается. */
  amount: Amount.nullable().default(null),
  /** Строки суммы; null — в окне строк нет или их не трогали. */
  lines: z.array(ReportLineEntry).max(REPORT_LINES_MAX).nullable().default(null),
};

const FileIds = z.array(Uuid).max(REPORT_FILES_MAX).default([]);

/** «Отметить сданным»: дата сдачи, сумма, «Повторять эту сумму», файлы, загруженные в окне. */
export const ReportSubmitRequest = z.strictObject({
  version: RecordVersion,
  date: ReportDate,
  ...amountFields,
  repeat: z.boolean().default(false),
  fileIds: FileIds,
});
export type ReportSubmitRequest = z.infer<typeof ReportSubmitRequest>;

/** Массово «Отметить сданными»: одна дата, сумма — у каждого отчёта (пусто — не меняется). */
export const ReportBatchSubmitRequest = z.strictObject({
  date: ReportDate,
  items: z
    .array(
      z.strictObject({ id: Uuid, version: RecordVersion, amount: Amount.nullable().default(null) }),
    )
    .min(1)
    .max(REPORT_BATCH_MAX),
});
export type ReportBatchSubmitRequest = z.infer<typeof ReportBatchSubmitRequest>;

/** Итог массового действия: сделано, пропущено без файла (квитанции) и по статусу или правам. */
export const ReportBatchResult = z.object({
  done: Count,
  skippedFile: Count,
  skipped: Count,
});
export type ReportBatchResult = z.infer<typeof ReportBatchResult>;

/** Итог массовой «Сдан»: ещё — без оплаты при «Сдаче только после оплаты» («Нет оплаты»). */
export const ReportBatchSubmitResult = ReportBatchResult.extend({ skippedPay: Count });
export type ReportBatchSubmitResult = z.infer<typeof ReportBatchSubmitResult>;

/**
 * «Сдан» одного отчёта: новая версия и, если «Сдан» ждёт оплаты, — к уплате и оплачено (сумма и файлы
 * сохранены, статус прежний).
 */
export const ReportSubmitted = z.object({
  id: Uuid,
  version: RecordVersion,
  waitsPayment: z.object({ amount: Tyiyn, paid: Tyiyn }).nullable(),
});
export type ReportSubmitted = z.infer<typeof ReportSubmitted>;

/** «Подтвердить»: комментарий (необязательно) и квитанция, загруженная в окне. */
export const ReportConfirmRequest = z.strictObject({
  version: RecordVersion,
  note: Text(REPORT_NOTE_MAX).default(''),
  fileIds: FileIds,
});
export type ReportConfirmRequest = z.infer<typeof ReportConfirmRequest>;

/** Массово «Подтвердить» во вкладке «Ожидают подтверждения». */
export const ReportBatchConfirmRequest = z.strictObject({
  note: Text(REPORT_NOTE_MAX).default(''),
  items: z
    .array(z.strictObject({ id: Uuid, version: RecordVersion }))
    .min(1)
    .max(REPORT_BATCH_MAX),
});
export type ReportBatchConfirmRequest = z.infer<typeof ReportBatchConfirmRequest>;

/** «На исправление»: что исправить (обязательно; пустую причину отклоняет сервер своим кодом). */
export const ReportFixRequest = z.strictObject({
  version: RecordVersion,
  reason: Text(REPORT_NOTE_MAX),
});
export type ReportFixRequest = z.infer<typeof ReportFixRequest>;

/** Шаг без окна: «Взять в работу», «Требует исправления», «Не требуется» — по версии отчёта. */
export const ReportStepRequest = z.strictObject({ version: RecordVersion });

/** Откат на шаг назад: куда, почему, версия отчёта. */
export const ReportRollbackRequest = StatusRollback.extend({ version: RecordVersion });
export type ReportRollbackRequest = z.infer<typeof ReportRollbackRequest>;

/** «Указать сумму»: итог или строки и «Повторять эту сумму». */
export const ReportAmountRequest = z.strictObject({
  version: RecordVersion,
  ...amountFields,
  repeat: z.boolean().default(false),
});
export type ReportAmountRequest = z.infer<typeof ReportAmountRequest>;

/* ──────── «Кто что сдаёт», массовое назначение, «Календарь», ответственный (задача 2.15) ──────── */

/** Поиск над сеткой «Кто что сдаёт»: по названию и ИНН контрагента (прототип `S.search`). */
export const ReportMatrixQuery = z.object({ q: z.string().trim().max(200).optional() });

/** Столбец сетки — вид, подключённый в организации (прототип `ORG.types[t.id].on`). */
export const ReportMatrixType = z.object({
  code: z.string(),
  name: z.string(),
  shortName: z.string(),
  /** false — вид отключён в каталоге платформы: новые назначения недоступны. */
  active: z.boolean(),
  /** Ставка нового назначения из сетки (прототип assignTypes: вторая ставка вида или единственная). */
  defaultRate: z.string().nullable(),
});

/** Клетка сетки: действующее назначение и почему вид не подходит контрагенту (пусто — подходит). */
export const ReportMatrixCell = z.object({
  assignment: z.object({ id: Uuid, version: RecordVersion }).nullable(),
  why: z.string().nullable(),
});

/**
 * Сетка «Кто что сдаёт» (прототип renderMatrix): контрагенты в области «Свои» группы «Отчеты для сдачи»
 * без архивных; клетки — по порядку `types`.
 */
export const ReportMatrix = z.object({
  types: z.array(ReportMatrixType),
  rows: z.array(
    z.object({
      contractor: z.object({
        id: Uuid,
        name: z.string(),
        inn: z.string(),
        /** Основной режим (прототип `c.regime`); пусто — режим не указан. */
        regime: z.string().nullable(),
      }),
      cells: z.array(ReportMatrixCell),
    }),
  ),
});
export type ReportMatrix = z.infer<typeof ReportMatrix>;

/** Окно «Назначить отчёт нескольким контрагентам»: какой вид показать (пусто — НДС или первый). */
export const AssignmentMassQuery = z.object({ type: Code.optional() });

/** Что показывает окно массового назначения (прототип massAssignDlg). */
export const AssignmentMassOptions = z.object({
  /** Подключённые в организации действующие виды: «Название · орган». */
  types: z.array(z.object({ code: z.string(), name: z.string(), organ: z.string() })),
  /** Выбранный вид; null — в организации не подключён ни один действующий вид. */
  type: z
    .object({
      code: z.string(),
      name: z.string(),
      shortName: z.string(),
      /** Срок словами (прототип ruleText). */
      dueText: z.string(),
      /** Ставки вида: при нескольких окно предлагает «Ставку для отмеченных». */
      rates: z.array(z.string()),
      defaultRate: z.string().nullable(),
      /** Единый налог: ставка подставится каждому контрагенту по его ГКЭД. */
      singleTax: z.boolean(),
    })
    .nullable(),
  contractors: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      regime: z.string().nullable(),
      /** Уже сдаёт этот вид. */
      assigned: z.boolean(),
      /** Почему вид не подходит (пусто — подходит). */
      why: z.string().nullable(),
      /** Строки ЕНС, которые встанут при назначении единого налога. */
      singleTaxRate: z.string().nullable(),
      /** Вид подходит по ГКЭД контрагента (метка «Подходит по ГКЭД»). */
      gkedFit: z.boolean(),
    }),
  ),
});
export type AssignmentMassOptions = z.infer<typeof AssignmentMassOptions>;

/** Контрагентов в одном массовом назначении — не больше. */
export const ASSIGNMENT_BULK_MAX = 500;

/**
 * «Назначить» в окне массового назначения: вид, отмеченные контрагенты и ставка для отмеченных (у вида
 * с одной ставкой — она, у единого налога — по ГКЭД каждого, у вида без ставок — пусто).
 */
export const AssignmentBulkCreate = z.strictObject({
  reportTypeCode: Code,
  contractorIds: z.array(Uuid).min(1).max(ASSIGNMENT_BULK_MAX),
  rate: assignmentFields.rate.default(null),
});
export type AssignmentBulkCreate = z.infer<typeof AssignmentBulkCreate>;

/**
 * Итог массового назначения: скольким назначено, сколько отчётов создано и скольких пропустили — вид
 * уже назначен, не подходит или контрагент тем временем ушёл в архив.
 */
export const AssignmentBulkResult = z.object({ done: Count, created: Count, skipped: Count });
export type AssignmentBulkResult = z.infer<typeof AssignmentBulkResult>;

/** Сколько будущих несданных отчётов получат «Не требуется», если снять назначение сегодня. */
export const AssignmentEndPreview = z.object({ notRequired: Count });

/** Действующие сотрудники для «сменить» ответственного (прототип: `EMP.filter(e => e.active)`). */
export const ResponsibleOptions = z.object({
  employees: z.array(z.object({ id: Uuid, shortName: z.string() })),
});
export type ResponsibleOptions = z.infer<typeof ResponsibleOptions>;

/** «сменить» ответственного в карточке отчёта. */
export const ReportResponsibleChange = z.strictObject({
  responsibleEmployeeId: Uuid,
  version: RecordVersion,
});
export type ReportResponsibleChange = z.infer<typeof ReportResponsibleChange>;

/** Срок окна «Разовый отчёт» после переноса с нерабочего дня — до сохранения (прототип `offTxt`). */
export const ReportDueShiftQuery = z.object({ reportTypeCode: Code, date: ReportDate });
export const ReportDueShift = z.object({ date: IsoDate });

/** Месяц календаря: `YYYY-MM`, с 2000 по 2100 год. */
const CalendarMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Месяц в виде ГГГГ-ММ')
  .refine((m) => m >= '2000-01' && m <= '2100-12', 'Месяц — с 2000 по 2100 год');

export const ReportCalendarQuery = z.object({ month: CalendarMonth });

/**
 * Вкладка «Календарь» (прототип renderCalendar): 42 дня с понедельника недели первого числа; у дня —
 * рабочий ли он, праздник и сколько отчётов к сдаче, сдано и ждут оплаты со сроком в этот день.
 */
export const ReportCalendar = z.object({
  month: CalendarMonth,
  days: z.array(
    z.object({
      date: IsoDate,
      working: z.boolean(),
      /** Название праздника или переноса; пусто — нет. */
      holiday: z.string(),
      todo: Count,
      done: Count,
      pay: Count,
    }),
  ),
});
export type ReportCalendar = z.infer<typeof ReportCalendar>;
