import { ACTIVITY_KINDS, ACTIVITY_MAX_BACK } from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Tyiyn, Uuid } from './common';
import { listPageSchema } from './list';
import { ReportRow } from './reports';
import { TaskListRow } from './tasks';

/*
 * «Главная» (задача 2.34; прототип modules/home.js, modules/analytics.js): «Сводка» — плашки и блоки,
 * «Аналитика» — выручка по контрагентам. Часть, которой сотруднику не видно по правам или выключенной
 * функции, приходит как null.
 */

const Count = z.number().int().nonnegative();

/** «Отчёты со сроком в этом месяце: сдано» — строка сотрудника. */
export const HomeProgressRow = z.object({
  employeeId: Uuid,
  name: z.string(),
  done: Count,
  all: Count,
});

/** «Сводка» (прототип renderHome). */
export const HomeSummary = z.object({
  today: IsoDate,
  /** Неделя «На неделе» (в выходные — следующая) и сегодня выходной. */
  weekFrom: IsoDate,
  weekTo: IsoDate,
  weekend: z.boolean(),
  /** Область «Отчеты для сдачи» — «Все»: «Вы видите всю организацию». */
  seeAll: z.boolean(),
  /** В организации нет контрагентов: строка «Добавьте контрагентов…». */
  noContractors: z.boolean(),
  plates: z.object({
    /** «Просрочено отчётов». */
    ovr: z.object({ count: Count }).nullable(),
    /** «Просрочено оплат»: сколько и не оплачено. */
    ovp: z.object({ count: Count, left: Tyiyn }).nullable(),
    /** «Сдать на этой неделе». */
    wks: z.object({ count: Count }).nullable(),
    /** «Оплатить на этой неделе»: сколько и сумма к оплате. */
    wkp: z.object({ count: Count, left: Tyiyn }).nullable(),
    /** «Ожидают подтверждения» (при «Сдача отчётов требует подтверждения»). */
    wait: z.object({ count: Count }).nullable(),
    /** «Ждут подтверждения»: выполненные задачи сотрудников. */
    tpend: z.object({ count: Count }).nullable(),
    /** «Не заполнены показатели»: контрагентов и есть ли просроченные месяцы. */
    kmiss: z.object({ count: Count, overdue: z.boolean() }).nullable(),
    /** «Мои задачи на сегодня»: сколько и сколько из них просрочено. */
    tsk: z.object({ count: Count, overdue: Count }).nullable(),
  }),
  /** «Ближайшие сроки сдачи» — девять отчётов. */
  upcoming: z.array(ReportRow).nullable(),
  progress: z.array(HomeProgressRow).nullable(),
  /** «Мои задачи на сегодня» — до пяти. */
  tasks: z.array(TaskListRow).nullable(),
  /** «Должники по обслуживанию»: сколько контрагентов и сумма долгов. */
  debtors: z.object({ count: Count, sum: Tyiyn }).nullable(),
});
export type HomeSummary = z.infer<typeof HomeSummary>;

/** Год «Аналитики». */
export const RevenueYearParam = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

const RevenueMonth = z.tuple([Tyiyn, Tyiyn, Tyiyn]);

/** Плашки, график, «Топ-10» и «Концентрация» «Аналитики» (прототип renderAnalytics). */
export const RevenueOverview = z.object({
  year: z.number().int(),
  /** Годы на выбор: текущий и прошлый. */
  years: z.array(z.number().int()),
  /** В организации нет контрагентов: пустой график «Данные появятся после первых начислений». */
  empty: z.boolean(),
  current: z.boolean(),
  lastMonth: z.number().int().min(0).max(11),
  feeCh: Tyiyn,
  fee: Tyiyn,
  proj: Tyiyn,
  svc: Tyiyn,
  total: Tyiyn,
  debt: Tyiyn,
  feePaidPercent: z.number().int(),
  shares: z.object({ fee: z.number(), proj: z.number(), svc: z.number() }).nullable(),
  change: z.number().int().nullable(),
  months: z.array(RevenueMonth).length(12),
  prevMonths: z.array(Tyiyn).length(12),
  top: z.array(
    z.object({ id: Uuid, name: z.string(), fee: Tyiyn, proj: Tyiyn, svc: Tyiyn, total: Tyiyn }),
  ),
  paid: Count,
  top5Percent: z.number().int(),
  average: Tyiyn,
  feeDebt: Tyiyn,
});
export type RevenueOverview = z.infer<typeof RevenueOverview>;

/** Строка списка «Аналитики»: контрагент, выручка за год, доля, прошлый год и изменение. */
export const RevenueRow = z.object({
  id: Uuid,
  name: z.string(),
  responsible: z.string().nullable(),
  oneOff: z.boolean(),
  archived: z.boolean(),
  feeCh: Tyiyn,
  fee: Tyiyn,
  proj: Tyiyn,
  svc: Tyiyn,
  total: Tyiyn,
  debt: Tyiyn,
  /** Доля в выручке, % с одним знаком. */
  share: z.number(),
  prev: Tyiyn,
  change: z.number().int().nullable(),
});
export type RevenueRow = z.infer<typeof RevenueRow>;

export const RevenueList = listPageSchema(RevenueRow);

/*
 * «Главная» → «Активность» (прототип v84, modules/activity.js): сотрудники организации за день, неделю,
 * месяц или год. Только с правом «Смотреть аналитику по сотрудникам».
 */

/** Период: вид (день, неделя, месяц, год) и сдвиг назад от текущего. */
export const ActivityPeriodParam = z.object({
  k: z.enum(ACTIVITY_KINDS),
  off: z.coerce.number().int().min(-ACTIVITY_MAX_BACK).max(0),
});

/** «ГГГГ-ММ-ДД ЧЧ:ММ» по Бишкеку. */
const ActivityMoment = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const DayTime = z.string().regex(/^\d{2}:\d{2}$/);

/** Строка списка: сотрудник и его числа за период. */
export const ActivityRow = z.object({
  id: Uuid,
  name: z.string(),
  role: z.string(),
  /** false — «заблокирован». */
  active: z.boolean(),
  /** Последняя активность в периоде; null — «не было». */
  last: ActivityMoment.nullable(),
  in: Count,
  out: Count,
  /** Дней с активностью. */
  days: Count,
  /** Действий. */
  n: Count,
  sub: Count,
  late: Count,
  due: Count,
  over: Count,
  cps: Count,
  tasks: Count,
});
export type ActivityRow = z.infer<typeof ActivityRow>;

export const ActivityList = listPageSchema(ActivityRow);

/** Плашки и столбики «Активности» (прототип renderHomeAct). */
export const ActivityOverview = z.object({
  k: z.enum(ACTIVITY_KINDS),
  off: z.number().int(),
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
  /** Сотрудников в списке и из них с активностью. */
  staff: Count,
  active: Count,
  in: Count,
  out: Count,
  n: Count,
  sub: Count,
  late: Count,
  /** Задач выполнено; null — «Задачи» выключены. */
  tasks: Count.nullable(),
  /** Действия по дням (за год — по месяцам `ГГГГ-ММ`); за день — пусто. */
  buckets: z.array(z.object({ key: z.string(), value: Count })),
});
export type ActivityOverview = z.infer<typeof ActivityOverview>;

/** Окно сотрудника «Активность по дням» (прототип actEmpDlg). */
export const ActivityEmployee = z.object({
  id: Uuid,
  name: z.string(),
  active: z.boolean(),
  k: z.enum(ACTIVITY_KINDS),
  off: z.number().int(),
  from: IsoDate,
  to: IsoDate,
  last: ActivityMoment.nullable(),
  in: Count,
  out: Count,
  n: Count,
  sub: Count,
  due: Count,
  over: Count,
  cps: Count,
  /** «По дням» — от последнего дня к первому. */
  days: z.array(
    z.object({
      day: IsoDate,
      first: DayTime.nullable(),
      last: DayTime,
      in: Count,
      out: Count,
      n: Count,
      sub: Count,
    }),
  ),
  /**
   * «По контрагентам» — контрагенты в ответственности сотрудника, по названию: только те, кого тот,
   * кто смотрит, вправе видеть («Просматривать контрагентов» и его область).
   */
  contractors: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      sub: Count,
      due: Count,
      open: Count,
      over: Count,
      act: Count,
    }),
  ),
  /** Остальные контрагенты сотрудника одной строкой — число и суммы без названий; null — таких нет. */
  others: z
    .object({ count: Count, sub: Count, due: Count, open: Count, over: Count, act: Count })
    .nullable(),
});
export type ActivityEmployee = z.infer<typeof ActivityEmployee>;
