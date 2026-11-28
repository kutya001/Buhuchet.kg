/**
 * Повторяющиеся задачи (доработки 28.11.2026: повторяющиеся задачи; прототип v168
 * modules/task-series.js: `tsDef`, `tsMonthTxt`, `tsText`, `tsInMonth`, `tsNext`, `tsUpcoming`,
 * `tsRun`, проверки окна «Повтор» в `tsDlg`). Серия — правило, по которому система сама ставит
 * одинаковые задачи; у серии всегда одна ближайшая задача. Здесь — правило без базы: следующая дата,
 * правило словами, проверка окна и что делать ночному запуску с серией.
 */
import { addDays, diffDays, formatDateRu, type IsoDate, weekdayMondayFirst } from '../common/dates';
import { pluralForm } from '../common/list';
import { addMonths, lastDayOf, monthOf, type YearMonth } from '../common/months';
import type { TaskTerm } from './rules';

/** Единица интервала: «день», «неделя», «месяц», «год». */
export const SERIES_UNITS = ['day', 'week', 'month', 'year'] as const;
export type SeriesUnit = (typeof SERIES_UNITS)[number];
/** У задачи «На месяц» — только «месяц» и «год» (блок 2, пункт 2). */
export const SERIES_MONTH_TERM_UNITS: readonly SeriesUnit[] = ['month', 'year'];

/** «N-го числа», «в <какой по счёту> <день недели>», «в последний <день недели>» (прототип `mm`). */
export const SERIES_MONTH_MODES = ['date', 'nth', 'last'] as const;
export type SeriesMonthMode = (typeof SERIES_MONTH_MODES)[number];

/** «Окончание»: «Никогда», «Дата», «После N повторов». */
export const SERIES_END_KINDS = ['never', 'date', 'count'] as const;
export type SeriesEndKind = (typeof SERIES_END_KINDS)[number];

/** Состояние серии: «Действует», «Остановлена», «Завершена» (блок 3, пункт 5). */
export const SERIES_STATES = ['active', 'stopped', 'finished'] as const;
export type SeriesState = (typeof SERIES_STATES)[number];

/**
 * Почему серию остановила система (блок 3, пункт 6): исполнитель заблокирован, контрагента больше
 * нет или он в архиве, проект больше не активен. Остановил человек — `manual`.
 */
export const SERIES_STOP_REASONS = [
  'executor',
  'contractor',
  'archive',
  'project',
  'manual',
] as const;
export type SeriesStopReason = (typeof SERIES_STOP_REASONS)[number];

/** Причина словами — как в прототипе (`tsStopWhy`): строка «Повтор остановлен: …» и `tgSerStop`. */
export const SERIES_STOP_TEXTS: Readonly<Record<Exclude<SeriesStopReason, 'manual'>, string>> = {
  executor: 'Исполнитель заблокирован',
  contractor: 'Контрагента больше нет',
  archive: 'Контрагент в архиве',
  project: 'Проект больше не активен',
};

export const SERIES_EVERY_MAX = 99;
export const SERIES_COUNT_MAX = 999;
/** «После N повторов» — заранее 30 (блок 2, пункт 4). */
export const SERIES_COUNT_DEFAULT = 30;

export interface SeriesRule {
  /** «Повторять с интервалом»: 1–99. */
  every: number;
  unit: SeriesUnit;
  /** Дни недели у «недели»: 0 — понедельник … 6 — воскресенье. */
  weekDays?: readonly number[];
  /** Как у «месяца» выбирается день; у задачи «На месяц» и у других единиц — нет. */
  monthMode?: SeriesMonthMode;
  end: SeriesEnd;
}

export interface SeriesEnd {
  kind: SeriesEndKind;
  /** Последний день, на который ещё ставится задача. */
  date?: IsoDate | null;
  /** «После N повторов»: первая задача считается. */
  count?: number | null;
}

/** Правило серии и то, от чего оно считается: начало (срок первой задачи) и вид срока задачи. */
export interface SeriesPlan {
  rule: SeriesRule;
  start: IsoDate;
  term: TaskTerm;
}

const WEEK_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;
/** День недели после «в»: «в среду», «в пятницу». */
const WEEK_ACC = [
  'понедельник',
  'вторник',
  'среду',
  'четверг',
  'пятницу',
  'субботу',
  'воскресенье',
] as const;
/** Род дня недели: м — понедельник, ж — среда, с — воскресенье (прототип `TS_WD_G`). */
const WEEK_GENDER = ['m', 'm', 'f', 'm', 'f', 'f', 'n'] as const;
const ORDINALS = {
  m: ['первый', 'второй', 'третий', 'четвёртый', 'последний'],
  f: ['первую', 'вторую', 'третью', 'четвёртую', 'последнюю'],
  n: ['первое', 'второе', 'третье', 'четвёртое', 'последнее'],
} as const;
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;
const MONTHS_IN = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
] as const;
const UNIT_FORMS: Readonly<Record<SeriesUnit, readonly [string, string, string]>> = {
  day: ['день', 'дня', 'дней'],
  week: ['неделю', 'недели', 'недель'],
  month: ['месяц', 'месяца', 'месяцев'],
  year: ['год', 'года', 'лет'],
};
const UNIT_ONE: Readonly<Record<SeriesUnit, string>> = {
  day: 'Каждый день',
  week: 'Каждую неделю',
  month: 'Каждый месяц',
  year: 'Каждый год',
};

const plural = (n: number, forms: readonly [string, string, string]) =>
  forms[{ one: 0, few: 1, many: 2 }[pluralForm(n)]]!;
const maxDate = (a: IsoDate, b: IsoDate) => (a > b ? a : b);
const dayOf = (date: IsoDate) => Number(date.slice(8, 10));

/** Правило по умолчанию в окне «Повтор» (прототип `tsDef`): каждую неделю в день срока, «На месяц» — каждый месяц. */
export function defaultSeriesRule(start: IsoDate, term: TaskTerm): SeriesRule {
  return term === 'month'
    ? { every: 1, unit: 'month', end: { kind: 'never' } }
    : { every: 1, unit: 'week', weekDays: [weekdayMondayFirst(start)], end: { kind: 'never' } };
}

/** «5-го числа», «в четвёртую субботу», «в последнюю пятницу» (прототип `tsMonthTxt`). */
export function seriesMonthText(mode: SeriesMonthMode | undefined, start: IsoDate): string {
  const day = dayOf(start);
  if (!mode || mode === 'date') return `${day}-го числа`;
  const wd = weekdayMondayFirst(start);
  const index = mode === 'last' || day > 28 ? 4 : Math.ceil(day / 7) - 1;
  return `в ${ORDINALS[WEEK_GENDER[wd]!][index]} ${WEEK_ACC[wd]}`;
}

/**
 * Какие «Когда» у «месяца» можно выбрать для этого начала (прототип `mmO` в `tsDlg`): «N-го числа»
 * всегда, «в N-й день недели» — до 28-го, «в последний» — в последнюю неделю месяца.
 */
export function seriesMonthModes(start: IsoDate): SeriesMonthMode[] {
  const day = dayOf(start);
  const last = dayOf(lastDayOf(monthOf(start)));
  return [
    'date',
    ...(day <= 28 ? (['nth'] as const) : []),
    ...(day + 7 > last ? (['last'] as const) : []),
  ];
}

/**
 * Правило словами (прототип `tsText`): «Каждую неделю: пн, ср · до 27.02.2027», «Каждые 2 месяца,
 * 5-го числа», «Каждый день · 30 повторов», «Каждый будний день».
 */
export function seriesRuleText(plan: SeriesPlan | null): string {
  if (!plan) return 'Не повторять';
  const { rule, start, term } = plan;
  const n = rule.every || 1;
  const one = n % 10 === 1 && n % 100 !== 11;
  let s =
    n === 1
      ? UNIT_ONE[rule.unit]
      : `${one ? (rule.unit === 'week' ? 'Каждую ' : 'Каждый ') : 'Каждые '}${n} ${plural(n, UNIT_FORMS[rule.unit])}`;
  if (rule.unit === 'week') {
    const days = [...(rule.weekDays ?? [])].sort((a, b) => a - b);
    const weekdays = days.join() === '0,1,2,3,4';
    if (n === 1 && (weekdays || days.length === 7))
      s = weekdays ? 'Каждый будний день' : 'Каждый день';
    else
      s += `: ${weekdays ? 'по будням' : days.length === 7 ? 'все дни' : days.map((d) => WEEK_SHORT[d]).join(', ')}`;
  }
  if (rule.unit === 'month' && term !== 'month') s += `, ${seriesMonthText(rule.monthMode, start)}`;
  if (rule.unit === 'year') {
    const m = Number(start.slice(5, 7));
    s += term === 'month' ? `, в ${MONTHS_IN[m - 1]}` : `, ${dayOf(start)} ${MONTHS_GEN[m - 1]}`;
  }
  const end = rule.end;
  if (end.kind === 'date' && end.date) s += ` · до ${formatDateRu(end.date)}`;
  if (end.kind === 'count' && end.count)
    s += ` · ${end.count} ${plural(end.count, ['повтор', 'повтора', 'повторов'])}`;
  return s;
}

/**
 * Дата по правилу в месяце (прототип `tsInMonth`): числа нет в месяце — последний день; у «года» —
 * тот же день (29 февраля в невисокосный — 28-е); у задачи «На месяц» — последний день месяца.
 */
export function seriesDateInMonth(plan: SeriesPlan, month: YearMonth): IsoDate {
  const { rule, start, term } = plan;
  if (term === 'month') return lastDayOf(month);
  const last = dayOf(lastDayOf(month));
  const day = dayOf(start);
  const at = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
  if (rule.unit === 'year' || (rule.monthMode !== 'nth' && rule.monthMode !== 'last'))
    return at(Math.min(day, last));
  let x = 1 + ((weekdayMondayFirst(start) - weekdayMondayFirst(`${month}-01`) + 7) % 7);
  if (rule.monthMode === 'last' || day > 28) {
    while (x + 7 <= last) x += 7;
    return at(x);
  }
  x += 7 * (Math.ceil(day / 7) - 1);
  return at(x > last ? x - 7 : x);
}

/** Первая дата по правилу не раньше `from` и не раньше начала; после даты окончания — null (прототип `tsNext`). */
export function seriesNextDate(plan: SeriesPlan, from?: IsoDate | null): IsoDate | null {
  const { rule, start } = plan;
  const n = Math.max(1, rule.every || 1);
  const since = !from || from < start ? start : from;
  let d: IsoDate | null = null;
  if (rule.unit === 'day') d = addDays(start, Math.ceil(diffDays(since, start) / n) * n);
  else if (rule.unit === 'week') {
    const monday = addDays(start, -weekdayMondayFirst(start));
    const days = rule.weekDays?.length ? rule.weekDays : [weekdayMondayFirst(start)];
    for (let i = 0; i < 7 * n + 7 && !d; i++) {
      const x = addDays(since, i);
      if (Math.floor(diffDays(x, monday) / 7) % n === 0 && days.includes(weekdayMondayFirst(x)))
        d = x;
    }
  } else {
    const step = rule.unit === 'year' ? 12 * n : n;
    let m = monthOf(start);
    for (let i = 0; i < 3000 && !d; i++) {
      const x = seriesDateInMonth(plan, m);
      if (x >= since) d = x;
      else m = addMonths(m, step);
    }
  }
  const end = rule.end;
  return d && !(end.kind === 'date' && end.date && d > end.date) ? d : null;
}

/** Что известно о серии на сегодня: поставленные задачи — дата последней и сколько всего. */
export interface SeriesFacts extends SeriesPlan {
  state: SeriesState;
  /** Дата последней поставленной задачи серии (по правилу). */
  lastDate: IsoDate | null;
  /** Сколько задач серия уже поставила. */
  made: number;
}

/** С какой даты искать следующую: после последней поставленной, не раньше сегодня. */
const nextFrom = (facts: SeriesFacts, today: IsoDate) =>
  facts.lastDate ? maxDate(addDays(facts.lastDate, 1), today) : maxDate(facts.start, today);

/** Дата следующей задачи, которую серия ещё поставит (прототип `tsUpcoming`). */
export function seriesUpcoming(facts: SeriesFacts, today: IsoDate): IsoDate | null {
  if (facts.state !== 'active') return null;
  const end = facts.rule.end;
  if (end.kind === 'count' && end.count && facts.made >= end.count) return null;
  return seriesNextDate(facts, nextFrom(facts, today));
}

/** Что мешает ставить задачи серии сейчас (без остановки): контрагент приостановлен, «Задачи» выключены. */
export interface SeriesRunContext {
  /** Причина остановки без человека (прототип `tsStopWhy`); пусто — можно ставить. */
  stop: Exclude<SeriesStopReason, 'manual'> | null;
  /** Контрагент приостановлен или функция «Задачи» выключена: ничего не делать, серия остаётся. */
  paused: boolean;
}

export type SeriesRunStep =
  | { kind: 'none' }
  | { kind: 'stop'; reason: Exclude<SeriesStopReason, 'manual'> }
  | { kind: 'finish' }
  | { kind: 'make'; date: IsoDate; finish: boolean };

/**
 * Что сделать ночному запуску с серией (прототип `tsRun`): остановить без человека, ничего (уже есть
 * задача с сегодняшнего дня или пауза), завершить (поставлено N, дат по правилу больше нет) или
 * поставить задачу на ближайшую дату (пропущенные даты задним числом не ставятся); `finish` — это
 * была последняя задача серии.
 */
export function seriesRunStep(
  facts: SeriesFacts,
  ctx: SeriesRunContext,
  today: IsoDate,
): SeriesRunStep {
  if (facts.state !== 'active') return { kind: 'none' };
  if (ctx.stop) return { kind: 'stop', reason: ctx.stop };
  if (ctx.paused) return { kind: 'none' };
  if (facts.lastDate && facts.lastDate >= today) return { kind: 'none' };
  const end = facts.rule.end;
  if (end.kind === 'count' && end.count && facts.made >= end.count) return { kind: 'finish' };
  const date = seriesNextDate(facts, nextFrom(facts, today));
  if (!date) return { kind: 'finish' };
  const after: SeriesFacts = { ...facts, lastDate: date, made: facts.made + 1 };
  return { kind: 'make', date, finish: !seriesUpcoming(after, today) };
}

export type SeriesRuleProblem =
  | 'series_every'
  | 'series_unit'
  | 'series_week_days'
  | 'series_month_mode'
  | 'series_end_date'
  | 'series_end_before_start'
  | 'series_end_count';

/** Тексты проверок окна «Повтор» — как в прототипе (`tsDlg`). */
export const SERIES_RULE_MESSAGES: Readonly<Record<SeriesRuleProblem, string>> = {
  series_every: 'Интервал — целое число от 1 до 99',
  series_unit: 'У задачи «На месяц» повтор — по месяцам или годам',
  series_week_days: 'Отметьте хотя бы один день недели',
  series_month_mode: 'Выберите, когда повторять в месяце',
  series_end_date: 'Укажите дату окончания',
  series_end_before_start: 'Окончание раньше начала',
  series_end_count: 'Число повторов — от 1 до 999',
};

/** Проверка окна «Повтор» и сервера: что не так с правилом (по полю), пусто — можно сохранить. */
export function seriesRuleProblems(
  plan: SeriesPlan,
): Partial<Record<'every' | 'unit' | 'weekDays' | 'monthMode' | 'end', SeriesRuleProblem>> {
  const { rule, start, term } = plan;
  const out: Partial<
    Record<'every' | 'unit' | 'weekDays' | 'monthMode' | 'end', SeriesRuleProblem>
  > = {};
  if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > SERIES_EVERY_MAX)
    out.every = 'series_every';
  if (
    !SERIES_UNITS.includes(rule.unit) ||
    (term === 'month' && !SERIES_MONTH_TERM_UNITS.includes(rule.unit))
  )
    out.unit = 'series_unit';
  if (rule.unit === 'week') {
    const days = rule.weekDays ?? [];
    if (
      days.length === 0 ||
      new Set(days).size !== days.length ||
      days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
    )
      out.weekDays = 'series_week_days';
  } else if (rule.weekDays?.length) out.weekDays = 'series_week_days';
  const monthly = rule.unit === 'month' && term !== 'month';
  if (
    monthly
      ? !seriesMonthModes(start).includes(rule.monthMode ?? 'date')
      : rule.monthMode && rule.monthMode !== 'date'
  )
    out.monthMode = 'series_month_mode';
  const end = rule.end;
  if (end.kind === 'date') {
    if (!end.date) out.end = 'series_end_date';
    else if (end.date < start) out.end = 'series_end_before_start';
  } else if (end.kind === 'count') {
    if (!Number.isInteger(end.count) || end.count! < 1 || end.count! > SERIES_COUNT_MAX)
      out.end = 'series_end_count';
  } else if (end.kind !== 'never') out.end = 'series_end_date';
  return out;
}

/**
 * Начало серии: срок первой задачи (блок 2, пункт 3). У «недели» день начала, не отмеченный среди
 * дней, сдвигается на ближайший отмеченный; начало раньше сегодня — первая задача на ближайшую дату
 * по правилу, не раньше сегодня. Дат нет (окончание раньше) — null.
 */
export function seriesFirstDate(plan: SeriesPlan, today: IsoDate): IsoDate | null {
  return seriesNextDate(plan, maxDate(plan.start, today));
}

/** Кто действует с серией: тот же, что с задачей (`TaskActor` — сотрудник, владелец, «Ставить задачи»). */
export interface SeriesActor {
  employeeId: string;
  isOwner: boolean;
  canCreate: boolean;
}

/** Почему действие с серией недоступно: ключ текста `SERIES_MESSAGES`. */
export type SeriesRefusal =
  | 'series_author_only'
  | 'series_create_right'
  | 'series_not_active'
  | 'series_not_stopped'
  | 'series_resume_blocked'
  | 'series_finished'
  | 'series_no_dates'
  | 'series_rule_one'
  | 'series_task_closed';

/** Тексты отказов — как подсказки и сообщения прототипа (`taskBossWhy`, `tsEditRule`, `tsResume`). */
export const SERIES_MESSAGES: Readonly<Record<SeriesRefusal, string>> = {
  series_author_only: 'Менять повтор может тот, кто его настроил, или владелец',
  series_create_right: 'Менять и отменять свои задачи можно только с правом «Ставить задачи»',
  series_not_active: 'Повтор уже остановлен или закончился',
  series_not_stopped: 'Повтор не остановлен',
  series_resume_blocked:
    '{why}: смените это в «Изменить» задачи → «Эту и следующие», затем возобновите',
  series_finished: 'Повтор закончился: продлить — «Изменить повтор» в карточке задачи',
  series_no_dates: 'По правилу повтора нет ни одной даты: проверьте «Окончание»',
  series_rule_one: 'Правило повтора меняется только для этой и следующих задач',
  series_task_closed: 'Повтор добавляется только незакрытой задаче',
};

/**
 * Менять, отменять, останавливать и возобновлять серию (блок 3, пункт 4; прототип `taskBoss`):
 * постановщик с правом «Ставить задачи» или владелец. null — можно.
 */
export function seriesBossRefusal(
  authorId: string,
  actor: SeriesActor,
): 'series_author_only' | 'series_create_right' | null {
  if (actor.isOwner) return null;
  if (authorId !== actor.employeeId) return 'series_author_only';
  return actor.canCreate ? null : 'series_create_right';
}

/** Одно и то же ли правило: «Только эту задачу» правило не меняет (прототип `ruleCh`). */
export function seriesRuleEqual(a: SeriesRule, b: SeriesRule): boolean {
  const days = (r: SeriesRule) =>
    r.unit === 'week' ? [...(r.weekDays ?? [])].sort((x, y) => x - y).join() : '';
  const mode = (r: SeriesRule) => (r.unit === 'month' ? (r.monthMode ?? 'date') : '');
  const end = (r: SeriesRule) =>
    r.end.kind === 'date'
      ? `date:${r.end.date ?? ''}`
      : r.end.kind === 'count'
        ? `count:${r.end.count ?? ''}`
        : 'never';
  return (
    a.every === b.every &&
    a.unit === b.unit &&
    days(a) === days(b) &&
    mode(a) === mode(b) &&
    end(a) === end(b)
  );
}

/** Причина остановки словами для строки истории и сообщения: у ручной — пусто. */
export function seriesStopText(reason: SeriesStopReason | null): string {
  return reason && reason !== 'manual' ? SERIES_STOP_TEXTS[reason] : '';
}
