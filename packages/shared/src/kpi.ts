import {
  FILL_STATUSES,
  INDICATOR_DESCRIPTION_MAX_LENGTH,
  INDICATOR_NAME_MAX_LENGTH,
  INDICATOR_NOTE_MAX_LENGTH,
  INDICATOR_SCOPES,
  INDICATOR_TOTALS,
  INDICATOR_TYPES,
  INDICATOR_UNIT_MAX_LENGTH,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, RecordVersion, Uuid } from './common';
import { RollbackReason, StatusHistoryEntry } from './status';

/*
 * Показатели контрагентов (задача 2.27; ТЗ «Показатели контрагентов»): показатели организации, «Кому
 * вести», «Ввод за месяц», окно значения, вкладка «Показатели» карточки контрагента и индикатор
 * незаполненных. Значения — целые сотые (1 250 000,50 → 125000050), пусто — null.
 */

/** Месяц `YYYY-MM`. */
export const YearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Статус заполнения месяца: «Не заполнено» → «Заполнено» → «Проверено». */
export const FillStatus = z.enum(FILL_STATUSES);

/** Значение показателя в сотых; null — «не заполнено». */
export const IndicatorValue = z.number().int().refine(Number.isSafeInteger).nullable();

/*
 * Длины полей точно проверяет правило домена (`indicatorProblems`) — ошибка под полем с кодом правила;
 * схема только не пускает заведомо лишнее.
 */
const IndicatorBody = {
  name: z.string().max(INDICATOR_NAME_MAX_LENGTH * 2),
  unit: z.string().max(INDICATOR_UNIT_MAX_LENGTH * 2),
  type: z.enum(INDICATOR_TYPES),
  total: z.enum(INDICATOR_TOTALS),
  description: z.string().max(INDICATOR_DESCRIPTION_MAX_LENGTH * 2),
  required: z.boolean(),
  dueDay: z.number().int(),
  /** «Вести с». */
  start: YearMonth,
  scope: z.enum(INDICATOR_SCOPES),
  /** «Включать новых контрагентов автоматически». */
  autoNew: z.boolean(),
};

/** Показатель в «Настройке показателей». */
export const Indicator = z.object({
  id: Uuid,
  ...IndicatorBody,
  archived: z.boolean(),
  order: z.number().int(),
  version: RecordVersion,
  /** Сколько внесённых значений: тип и единицу при них не меняют. */
  valueCount: z.number().int().nonnegative(),
  /** Есть строки значений (и пустые с комментарием или файлом): не удаляется — только в архив. */
  hasRows: z.boolean(),
  /** У скольких контрагентов из `contractors` ведётся — «всем, кроме 2», «выбранным: 5». */
  on: z.number().int().nonnegative(),
});
export type Indicator = z.infer<typeof Indicator>;

export const Indicators = z.object({
  items: z.array(Indicator),
  /** Неразовых контрагентов в области сотрудника (без архива). */
  contractors: z.number().int().nonnegative(),
});
export type Indicators = z.infer<typeof Indicators>;

/** Строка «Истории показателя»: изменённые поля или «Ведётся» → «Не ведётся» у контрагента. */
export const IndicatorHistoryItem = z.object({
  at: z.iso.datetime(),
  actor: z.string().nullable(),
  action: z.string(),
  contractor: z.string().nullable(),
  changes: z.array(
    z.object({ field: z.string(), from: z.unknown().optional(), to: z.unknown().optional() }),
  ),
});
export type IndicatorHistoryItem = z.infer<typeof IndicatorHistoryItem>;

/** Окно показателя: поля, у кого ведётся (для «Выбранным») и история. */
export const IndicatorCard = Indicator.extend({
  selected: z.array(Uuid),
  history: z.array(IndicatorHistoryItem),
});
export type IndicatorCard = z.infer<typeof IndicatorCard>;

/** «Создать показатель» и «Сохранить»: при «Выбранным» — отмеченные контрагенты. */
export const IndicatorSave = z.strictObject({
  ...IndicatorBody,
  selected: z.array(Uuid).max(20_000),
});
export type IndicatorSave = z.infer<typeof IndicatorSave>;

export const IndicatorUpdate = IndicatorSave.extend({ version: RecordVersion });
export type IndicatorUpdate = z.infer<typeof IndicatorUpdate>;

export const IndicatorIdParam = z.object({ id: Uuid });
export const IndicatorVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });

/** «В архив» и «Вернуть из архива». */
export const IndicatorArchive = z.strictObject({ archived: z.boolean(), version: RecordVersion });

/** Порядок перетаскиванием: все показатели в новом порядке. */
export const IndicatorOrder = z.strictObject({ ids: z.array(Uuid).min(1).max(500) });

/* ───────────── «Кому вести» ───────────── */

/** Показатель у контрагента: ведётся ли, с какого месяца требуется, «Не ведётся с …». */
export const WhoCell = z.object({
  indicatorId: Uuid,
  on: z.boolean(),
  start: YearMonth,
  offSince: YearMonth.nullable(),
});

/** Контрагент «Кому вести» (и списка окна показателя): поля фильтров и показатели по порядку. */
export const WhoContractor = z.object({
  id: Uuid,
  name: z.string(),
  inn: z.string(),
  regimeCode: z.string().nullable(),
  regimeName: z.string().nullable(),
  responsibleEmployeeId: Uuid.nullable(),
  responsibleName: z.string().nullable(),
  paused: z.boolean(),
  gked: z.array(z.string()),
  cells: z.array(WhoCell),
});
export type WhoContractor = z.infer<typeof WhoContractor>;

export const KpiWho = z.object({
  /** Действующие показатели по порядку. */
  indicators: z.array(z.object({ id: Uuid, name: z.string() })),
  contractors: z.array(WhoContractor),
  /** С какого месяца показатель требуется, если его включить сейчас. */
  reenableMonth: YearMonth,
});
export type KpiWho = z.infer<typeof KpiWho>;

/** Галочки «Вести»: одна ячейка, строка, столбец или массово по фильтру. */
export const WhoChanges = z.strictObject({
  changes: z
    .array(z.strictObject({ indicatorId: Uuid, contractorId: Uuid, on: z.boolean() }))
    .min(1)
    .max(20_000),
});
export type WhoChanges = z.infer<typeof WhoChanges>;

export const WhoChanged = z.object({ changed: z.number().int().nonnegative() });

/** «с <месяц>» у контрагента (карточка контрагента, вкладка «Показатели»). */
export const WhoFrom = z.strictObject({ indicatorId: Uuid, contractorId: Uuid, from: YearMonth });

/* ───────────── «Ввод за месяц» ───────────── */

/** Показатель в столбце таблицы. */
export const KpiColumn = z.object({
  id: Uuid,
  name: z.string(),
  unit: z.string(),
  type: z.enum(INDICATOR_TYPES),
  total: z.enum(INDICATOR_TOTALS),
  description: z.string(),
  required: z.boolean(),
  archived: z.boolean(),
});
export type KpiColumn = z.infer<typeof KpiColumn>;

/** Статус месяца контрагента; строки нет — «Не заполнено» без истории. */
export const MonthStatus = z.object({
  id: Uuid,
  code: FillStatus,
  version: RecordVersion,
  /** Последняя смена: когда и кто (подсказка компактной шкалы). */
  at: z.iso.datetime(),
  actor: z.string().nullable(),
});
export type MonthStatus = z.infer<typeof MonthStatus>;

/**
 * Ячейка: `required` — для ввода, `early` — раньше «с <месяц>», необязательна; `off` — не ведётся или
 * не нужна в месяце (серая).
 */
export const KpiCell = z.object({
  indicatorId: Uuid,
  state: z.enum(['required', 'early', 'off']),
  value: IndicatorValue,
  start: YearMonth,
  offSince: YearMonth.nullable(),
});
export type KpiCell = z.infer<typeof KpiCell>;

export const KpiStats = z.object({
  all: z.number().int(),
  filled: z.number().int(),
  empty: z.number().int(),
  overdue: z.number().int(),
  checked: z.number().int(),
});
export type KpiStats = z.infer<typeof KpiStats>;

export const KpiMonthQuery = z.object({ month: YearMonth.optional() });

export const KpiMonth = z.object({
  month: YearMonth,
  /** Идущий месяц: вперёд не листается. */
  current: YearMonth,
  /** Месяцы выбора, новые сверху, и сколько контрагентов их не заполнили. */
  choices: z.array(z.object({ month: YearMonth, missing: z.number().int() })),
  indicators: z.array(KpiColumn),
  rows: z.array(
    z.object({
      contractorId: Uuid,
      name: z.string(),
      responsibleName: z.string().nullable(),
      /** Может ли сотрудник вносить значения этого контрагента. */
      editable: z.boolean(),
      due: IsoDate,
      overdue: z.boolean(),
      status: MonthStatus.nullable(),
      cells: z.array(KpiCell),
    }),
  ),
  stats: KpiStats,
});
export type KpiMonth = z.infer<typeof KpiMonth>;

/** Значения ячеек: одна, блок из Excel или окно значения (с комментарием). */
export const KpiValuesSave = z.strictObject({
  values: z
    .array(
      z.strictObject({
        contractorId: Uuid,
        indicatorId: Uuid,
        month: YearMonth,
        value: IndicatorValue,
        note: z.string().max(INDICATOR_NOTE_MAX_LENGTH).optional(),
        /**
         * Значение и комментарий, которые видел сотрудник: на сервере уже другие — 409 «Запись изменена
         * другим пользователем», ничего не записано. Не заданы — без проверки.
         */
        prev: IndicatorValue.optional(),
        prevNote: z.string().max(INDICATOR_NOTE_MAX_LENGTH).optional(),
      }),
    )
    .min(1)
    .max(5000),
});
export type KpiValuesSave = z.infer<typeof KpiValuesSave>;

export const KpiValuesSaved = z.object({
  changed: z.number().int().nonnegative(),
  /** Новые статусы месяцев, которые изменились. */
  statuses: z.array(z.object({ contractorId: Uuid, month: YearMonth, status: FillStatus })),
});
export type KpiValuesSaved = z.infer<typeof KpiValuesSaved>;

/* ───────────── Окно значения ───────────── */

export const KpiEntryQuery = z.object({ contractorId: Uuid, month: YearMonth });

export const KpiEntry = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  month: YearMonth,
  due: IsoDate,
  editable: z.boolean(),
  /** Функция «Файлы в карточках» включена: блок «Файлы» у значения. */
  files: z.boolean(),
  items: z.array(
    z.object({
      indicator: KpiColumn,
      state: z.enum(['required', 'early', 'off']),
      start: YearMonth,
      value: IndicatorValue,
      note: z.string(),
      /** Строка значения — для блока «Файлы»; null — значения ещё нет. */
      valueId: Uuid.nullable(),
      updatedBy: z.string().nullable(),
      updatedAt: z.iso.datetime().nullable(),
    }),
  ),
  status: MonthStatus.nullable(),
  statusHistory: z.array(StatusHistoryEntry),
  /** «Проверено» можно поставить (право «Проверять показатели», месяц «Заполнено»). */
  canCheck: z.boolean(),
  /** Шаг для отката (право «Откат статусов»); null — нельзя. */
  back: FillStatus.nullable(),
  history: z.array(
    z.object({
      at: z.iso.datetime(),
      indicatorId: Uuid,
      from: IndicatorValue,
      to: IndicatorValue,
      reason: z.string().nullable(),
      actor: z.string().nullable(),
    }),
  ),
});
export type KpiEntry = z.infer<typeof KpiEntry>;

/** «Проверено» и откат статуса месяца. */
export const KpiMonthCheck = z.strictObject({
  contractorId: Uuid,
  month: YearMonth,
  version: RecordVersion,
});
export type KpiMonthCheck = z.infer<typeof KpiMonthCheck>;

/** Откат статуса месяца на шаг назад: куда и почему. */
export const KpiMonthRollback = KpiMonthCheck.extend({ to: FillStatus, reason: RollbackReason });
export type KpiMonthRollback = z.infer<typeof KpiMonthRollback>;

/* ───────────── «За период», «Не заполнено» ───────────── */

export const KpiPeriodParams = z.object({ from: YearMonth, to: YearMonth });

export const KpiPeriodRow = z.object({
  id: z.string(),
  contractorId: Uuid,
  contractorName: z.string(),
  indicatorId: Uuid,
  indicatorName: z.string(),
  unit: z.string(),
  type: z.enum(INDICATOR_TYPES),
  indicatorArchived: z.boolean(),
  responsibleName: z.string().nullable(),
  values: z.array(IndicatorValue),
  needed: z.array(z.boolean()),
  empty: z.array(z.boolean()),
  need: z.number().int(),
  count: z.number().int(),
  totals: z.object({
    sum: z.number().nullable(),
    avg: z.number().nullable(),
    max: z.number().nullable(),
    min: z.number().nullable(),
  }),
  offSince: YearMonth.nullable(),
  lastBy: z.string().nullable(),
  lastAt: z.iso.datetime().nullable(),
});
export type KpiPeriodRow = z.infer<typeof KpiPeriodRow>;

export const KpiMissingRow = z.object({
  id: z.string(),
  contractorId: Uuid,
  contractorName: z.string(),
  month: YearMonth,
  missing: z.array(z.object({ id: Uuid, name: z.string() })),
  responsibleName: z.string().nullable(),
  due: IsoDate,
  overdueDays: z.number().int(),
  status: FillStatus,
  statusAt: z.iso.datetime().nullable(),
});
export type KpiMissingRow = z.infer<typeof KpiMissingRow>;

/**
 * Индикатор незаполненных: контрагентов с незаполненными месяцами (число счётчика), есть ли
 * просроченные (красный, иначе жёлтый) и по контрагентам — месяцы для значка в списке.
 */
export const KpiMissingSummary = z.object({
  count: z.number().int().nonnegative(),
  overdue: z.boolean(),
  contractors: z.array(
    z.object({ contractorId: Uuid, months: z.array(YearMonth), overdue: z.boolean() }),
  ),
});
export type KpiMissingSummary = z.infer<typeof KpiMissingSummary>;

/* ───────────── Карточка контрагента ───────────── */

export const KpiCardParams = z.object({ id: Uuid });
export const KpiCardQuery = z.object({ from: YearMonth.optional(), to: YearMonth.optional() });

export const KpiCard = z.object({
  contractor: z.object({
    id: Uuid,
    name: z.string(),
    oneOff: z.boolean(),
    paused: z.boolean(),
    archived: z.boolean(),
  }),
  from: YearMonth,
  to: YearMonth,
  current: YearMonth,
  months: z.array(YearMonth),
  /** Вносит значения (право и область). */
  editable: z.boolean(),
  /** Меняет «Вести» и «с <месяц>» (право «Настраивать показатели»). */
  canSetup: z.boolean(),
  rows: z.array(
    z.object({
      indicator: KpiColumn,
      values: z.array(IndicatorValue),
      /** Требовался ли в месяце: пустая ячейка — «пусто», иначе «—». */
      applies: z.array(z.boolean()),
      /** Месяц раньше «с <месяц>»: значение можно внести, но оно необязательно. */
      early: z.array(z.boolean()),
      need: z.number().int(),
      count: z.number().int(),
      totals: z.object({
        sum: z.number().nullable(),
        avg: z.number().nullable(),
        max: z.number().nullable(),
        min: z.number().nullable(),
        last: z.number().nullable(),
      }),
      start: YearMonth,
      offSince: YearMonth.nullable(),
    }),
  ),
  /** «Какие показатели вести»: действующие показатели по порядку. */
  who: z.array(
    z.object({
      indicator: KpiColumn,
      on: z.boolean(),
      start: YearMonth,
      offSince: YearMonth.nullable(),
    }),
  ),
  /** Незаполненные месяцы контрагента; null — всё внесено. */
  missing: z.object({ months: z.array(YearMonth), overdue: z.boolean() }).nullable(),
  /** «Внести за прошлые месяцы»: незаполненные месяцы со всеми ячейками. */
  past: z.array(
    z.object({
      month: YearMonth,
      due: IsoDate,
      overdue: z.boolean(),
      status: MonthStatus.nullable(),
      cells: z.array(KpiCell),
    }),
  ),
});
export type KpiCard = z.infer<typeof KpiCard>;
