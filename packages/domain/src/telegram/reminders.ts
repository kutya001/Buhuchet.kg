import { addDays, diffDays, formatDateRu, type IsoDate } from '../common/dates';
import type { ReportAct } from '../platform-dicts/catalog';
import { notifyOn, type NotifySettings } from './notify';

/*
 * Напоминания за день одному человеку (ТЗ «Уведомления в Telegram»: «Все напоминания одному человеку
 * за день собираются в одно сообщение, которое уходит утром»; задача 2.25, docs/decisions.md, п. Б-5):
 * по отчётам — за N дней, в день срока и при просрочке, то же по срокам оплаты; сдача ждёт
 * подтверждения дольше N дней; по задачам — завтра срок, просрочена, ждёт подтверждения дольше одного
 * рабочего дня; по понедельникам — сводка на неделю. Кто что получает — по ответственному, режиму и
 * переключателям (`notifyOn`); если у ответственного не привязан Telegram, напоминание по его отчёту
 * получают владелец и главный бухгалтер с пометкой.
 */

/** Отчёт для напоминаний (прежние версии и «Не требуется» сюда не попадают). */
export interface ReminderReport {
  id: string;
  /** «НДС за октябрь 2026 — ОсОО «Ромашка»». */
  label: string;
  /** Вид отчёта коротко — в сводке на неделю под контрагентом. */
  typeShort: string;
  contractorName: string;
  /** Ответственный за контрагента — область «Свои» у того, кто подтверждает сдачу. */
  contractorResponsibleId: string | null;
  act: ReportAct;
  dueDate: IsoDate;
  payDue: IsoDate | null;
  /** Не сдан: «К сдаче», «В работе», «Требует исправления». */
  open: boolean;
  /** Налог не оплачен полностью: сумма не указана или оплачено меньше суммы. */
  unpaid: boolean;
  /** Ответственный за отчёт (сотрудник); null — не назначен. */
  responsibleId: string | null;
  /** Дни напоминаний до срока у вида в организации. */
  remindDays: readonly number[];
  /** Сдан и ждёт подтверждения: день сдачи по Бишкеку; null — не ждёт. */
  waitingSince: IsoDate | null;
  /** Кто отметил «Сдан» (сотрудник): свою сдачу он не подтверждает. */
  submittedById: string | null;
  /** Обслуживание контрагента приостановлено — напоминаний нет (ТЗ «Приостановка»). */
  paused: boolean;
}

/** Ручная задача для напоминаний (открытая или ждущая подтверждения). */
export interface ReminderTask {
  id: string;
  title: string;
  executorId: string;
  authorId: string;
  dueDate: IsoDate;
  /** Открыта: «К выполнению», «В работе», «На доработке». */
  open: boolean;
  /** Ждёт подтверждения с этого дня (день «Выполнена» по Бишкеку); null — не ждёт. */
  waitingSince: IsoDate | null;
}

/** Получатель: сотрудник организации. */
export interface ReminderPerson {
  employeeId: string;
  shortName: string;
  /** Владелец или главный бухгалтер — получает и по отчётам других сотрудников (по режиму). */
  boss: boolean;
  isOwner: boolean;
  /** Привязан Telegram. */
  linked: boolean;
  settings: NotifySettings;
  /**
   * Какие чужие отчёты видит: право «Просматривать отчёты» и область группы «Отчеты для сдачи»; null —
   * права нет. Владельцу и главному бухгалтеру чужие отчёты приходят только в этой области (п. Б-13).
   */
  viewReports: 'all' | 'own' | null;
  /** Право «Подтверждать сдачу отчётов» и его область; null — права нет. */
  confirmReports: 'all' | 'own' | null;
  /** Право «Подтверждать задачи». */
  confirmTasks: boolean;
}

export interface ReminderPolicy {
  today: IsoDate;
  /** «Повторять при просрочке каждый день»; выключено — только на следующий день после срока. */
  overdueRepeat: boolean;
  /** «Сдача отчётов требует подтверждения» и через сколько дней ожидания напоминать. */
  reportConfirm: boolean;
  confirmWaitDays: number;
  /** «Учёт оплаты налогов» — напоминания о сроках оплаты. */
  taxpay: boolean;
  /** Модуль «Задачи» включён. */
  tasks: boolean;
  /** Неделя сводки (понедельник); null — сегодня не понедельник. */
  week: { from: IsoDate; to: IsoDate } | null;
  /** Ближайший рабочий день с этой даты (производственный календарь). */
  nextWorkingDay: (date: IsoDate) => IsoDate;
}

/** Строка отчёта или задачи в напоминании; `unlinked` — у ответственного не привязан Telegram. */
export interface ReminderItem {
  id: string;
  label: string;
  unlinked?: { shortName: string | null };
}

/** Часть сообщения — один шаблон «Справочников платформы» со списком. */
export type ReminderLine =
  | { key: 'tgToday' | 'tgOver' | 'tgPayToday' | 'tgPayOver'; items: ReminderItem[] }
  | { key: 'tgBefore' | 'tgPay'; days: number; items: ReminderItem[] }
  | { key: 'tgConfWait'; days: number; items: ReminderItem[] }
  | { key: 'tgTaskSoon' | 'tgTaskOver' | 'tgTaskWait'; items: ReminderItem[] }
  | {
      key: 'tgWeek';
      from: IsoDate;
      to: IsoDate;
      sub: number;
      pay: number;
      over: number;
      byContractor: WeekContractor[];
    };

export interface WeekContractor {
  name: string;
  sub: string[];
  pay: string[];
  over: string[];
}

/** Строка сводки недели руководителю: сотрудник (null — отчёты без ответственного) и его числа. */
export interface WeekEmployeeRow {
  employeeId: string | null;
  /** Сдать до конца недели. */
  sub: number;
  /** Просрочено: несданные отчёты и неоплаченные налоги. */
  over: number;
  /** Сдачи ждут подтверждения. */
  wait: number;
}

/**
 * Сводка недели руководителю по сотрудникам (поток Т, задача Т3; прототип v100 `tgWeekRows`): итоги
 * недели и строки сотрудников, у которых есть что сдать, просроченное или ждущее подтверждения.
 */
export interface WeekSummary {
  from: IsoDate;
  to: IsoDate;
  sub: number;
  pay: number;
  over: number;
  rows: WeekEmployeeRow[];
}

export interface ReminderMessage {
  employeeId: string;
  lines: ReminderLine[];
  /** Понедельник: сводка недели владельцу и главному бухгалтеру отдельным сообщением с таблицей. */
  week?: WeekSummary;
}

type When = 'today' | 'over' | number | null;

/** Когда по сроку: сегодня, просрочен (с повтором или только на следующий день), за N дней или нет. */
function whenOf(due: IsoDate, days: readonly number[], p: ReminderPolicy): When {
  if (due === p.today) return 'today';
  if (due < p.today) return p.overdueRepeat || addDays(due, 1) === p.today ? 'over' : null;
  const left = diffDays(due, p.today);
  return days.includes(left) ? left : null;
}

const subOpen = (r: ReminderReport) => r.open && r.act !== 'pay' && !r.paused;
const payOpen = (r: ReminderReport, p: Pick<ReminderPolicy, 'taxpay'>) =>
  p.taxpay && r.act !== 'sub' && r.unpaid && r.payDue !== null && !r.paused;

interface Bucket {
  today: ReminderItem[];
  over: ReminderItem[];
  before: Map<number, ReminderItem[]>;
}

const bucket = (): Bucket => ({ today: [], over: [], before: new Map() });

function put(b: Bucket, when: When, item: ReminderItem) {
  if (when === null) return;
  if (when === 'today') b.today.push(item);
  else if (when === 'over') b.over.push(item);
  else b.before.set(when, [...(b.before.get(when) ?? []), item]);
}

/**
 * Чужой отчёт в области того, кто получает: «Все» — любой, «Свои» — отчёты его контрагентов и те, где он
 * ответственный (как область отчётов, п. А-2).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Б-13 — в прототипе владелец и главный бухгалтер получают по всем отчётам.
function inView(person: ReminderPerson, r: ReminderReport): boolean {
  if (person.viewReports === 'all') return true;
  return (
    person.viewReports === 'own' &&
    (r.contractorResponsibleId === person.employeeId || r.responsibleId === person.employeeId)
  );
}

/**
 * Получит ли человек напоминание по отчёту: свой — всегда; чужой — владелец и главный бухгалтер: в
 * день срока — в режиме «Все», за N дней — с переключателем «за N дней», просрочка — с переключателем
 * «Просрочки»; если у ответственного не привязан Telegram — всегда, с пометкой. Чужой — только в
 * области отчётов получателя (`inView`).
 */
function reportReach(
  person: ReminderPerson,
  r: ReminderReport,
  when: Exclude<When, null>,
  responsible: ReminderPerson | undefined,
): ReminderItem | null {
  const item = { id: r.id, label: r.label };
  if (r.responsibleId === person.employeeId) return item;
  if (!person.boss || !inView(person, r)) return null;
  if (!responsible?.linked) {
    return { ...item, unlinked: { shortName: responsible?.shortName ?? null } };
  }
  const on =
    when === 'today'
      ? person.settings.mode === 'all'
      : notifyOn(person.settings, true, when === 'over' ? 'over' : 'before');
  return on ? item : null;
}

/** Сводка на неделю: сдать и оплатить на неделе и что просрочено, по контрагентам. */
function weekLine(
  person: ReminderPerson,
  reports: readonly ReminderReport[],
  p: ReminderPolicy,
): ReminderLine | null {
  const week = p.week;
  // Владелец и главный бухгалтер получают сводку отдельным сообщением с таблицей по сотрудникам
  // (`weekSummary`), строки в сообщении дня у них нет.
  if (!week || person.boss) return null;
  const mine = (r: ReminderReport) => r.responsibleId === person.employeeId;
  const byName = new Map<string, WeekContractor>();
  const at = (name: string) => {
    let c = byName.get(name);
    if (!c) byName.set(name, (c = { name, sub: [], pay: [], over: [] }));
    return c;
  };
  let sub = 0;
  let pay = 0;
  let over = 0;
  for (const r of reports) {
    if (!mine(r)) continue;
    if (subOpen(r)) {
      if (r.dueDate < p.today) {
        over++;
        at(r.contractorName).over.push(r.typeShort);
      } else if (r.dueDate <= week.to) {
        sub++;
        at(r.contractorName).sub.push(`${r.typeShort} ${formatDateRu(r.dueDate).slice(0, 5)}`);
      }
    }
    if (payOpen(r, p)) {
      if (r.payDue! < p.today) {
        over++;
        at(r.contractorName).over.push(r.typeShort);
      } else if (r.payDue! <= week.to) {
        pay++;
        at(r.contractorName).pay.push(`${r.typeShort} ${formatDateRu(r.payDue!).slice(0, 5)}`);
      }
    }
  }
  if (!sub && !pay && !over) return null;
  const byContractor = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { key: 'tgWeek', from: week.from, to: week.to, sub, pay, over, byContractor };
}

/**
 * Сводка недели руководителю (прототип v100 `tgWeekRows`): владельцу и главному бухгалтеру с включённой
 * «Сводкой за неделю», по понедельникам. Отчёты — свои и чужие в области получателя (`inView`); по
 * сотруднику-ответственному — сколько сдать до конца недели, сколько просрочено (сдача и оплата налога)
 * и сколько сдач ждут подтверждения. Оплата на неделе входит только в итог. null — сводка не положена.
 */
export function weekSummary(
  person: ReminderPerson,
  reports: readonly ReminderReport[],
  p: ReminderPolicy,
): WeekSummary | null {
  const week = p.week;
  if (!week || !person.boss || !notifyOn(person.settings, true, 'week')) return null;
  const byId = new Map<string | null, WeekEmployeeRow>();
  const at = (employeeId: string | null) => {
    let row = byId.get(employeeId);
    if (!row) byId.set(employeeId, (row = { employeeId, sub: 0, over: 0, wait: 0 }));
    return row;
  };
  let sub = 0;
  let pay = 0;
  let over = 0;
  for (const r of reports) {
    if (r.responsibleId !== person.employeeId && !inView(person, r)) continue;
    if (subOpen(r)) {
      if (r.dueDate < p.today) {
        at(r.responsibleId).over++;
        over++;
      } else if (r.dueDate <= week.to) {
        at(r.responsibleId).sub++;
        sub++;
      }
    }
    if (payOpen(r, p)) {
      if (r.payDue! < p.today) {
        at(r.responsibleId).over++;
        over++;
      } else if (r.payDue! <= week.to) pay++;
    }
    if (p.reportConfirm && r.waitingSince && !r.paused) at(r.responsibleId).wait++;
  }
  const rows = [...byId.values()].filter((x) => x.sub || x.over || x.wait);
  return { from: week.from, to: week.to, sub, pay, over, rows };
}

/** Просроченное сотрудника: несданный отчёт или неоплаченный налог (`pay`) и его срок. */
export interface OverdueItem {
  report: ReminderReport;
  due: IsoDate;
  pay: boolean;
}

/**
 * Просроченное сотрудника для «Напомнить» (прототип v100 `tgOverOf`): его несданные отчёты со сроком в
 * прошлом и неоплаченные налоги с прошедшим сроком оплаты, самые давние первыми.
 */
export function overdueOf(
  employeeId: string,
  reports: readonly ReminderReport[],
  p: Pick<ReminderPolicy, 'today' | 'taxpay'>,
): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const r of reports) {
    if (r.responsibleId !== employeeId) continue;
    if (subOpen(r) && r.dueDate < p.today) out.push({ report: r, due: r.dueDate, pay: false });
    if (payOpen(r, p) && r.payDue! < p.today) out.push({ report: r, due: r.payDue!, pay: true });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.report.id.localeCompare(b.report.id));
}

/** Строка сводки общего чата фирмы: сотрудник (null — без ответственного), сдать сегодня, просрочено. */
export interface GroupEmployeeRow {
  employeeId: string | null;
  today: number;
  over: number;
}

/** Сводка дня в общий чат фирмы (поток Т, задача Т8; прототип v105 `tgGrpRows`). */
export interface GroupSummary {
  today: number;
  over: number;
  wait: number;
  rows: GroupEmployeeRow[];
}

/**
 * Сводка дня в общий чат фирмы (прототип v105 `tgGrpRows`): по всей организации — сколько отчётов сдать
 * сегодня, сколько просрочено (сдача и оплата налога) и сколько сдач ждут подтверждения; по сотрудникам —
 * сегодня и просрочено. Только числа: названия контрагентов в группу не идут. Приостановленные — как в
 * напоминаниях, без них. null — сдавать сегодня нечего и просроченного нет: сводка не отправляется.
 */
export function groupSummary(
  reports: readonly ReminderReport[],
  p: Pick<ReminderPolicy, 'today' | 'taxpay' | 'reportConfirm'>,
): GroupSummary | null {
  const byId = new Map<string | null, GroupEmployeeRow>();
  const at = (employeeId: string | null) => {
    let row = byId.get(employeeId);
    if (!row) byId.set(employeeId, (row = { employeeId, today: 0, over: 0 }));
    return row;
  };
  let today = 0;
  let over = 0;
  let wait = 0;
  for (const r of reports) {
    if (subOpen(r)) {
      if (r.dueDate < p.today) {
        at(r.responsibleId).over++;
        over++;
      } else if (r.dueDate === p.today) {
        at(r.responsibleId).today++;
        today++;
      }
    }
    if (payOpen(r, p) && r.payDue! < p.today) {
      at(r.responsibleId).over++;
      over++;
    }
    if (p.reportConfirm && r.waitingSince && !r.paused) wait++;
  }
  if (!today && !over) return null;
  return { today, over, wait, rows: [...byId.values()].filter((x) => x.today || x.over) };
}

/**
 * «Мои» в общем чате фирмы (прототип v105 `tgAct('grpMine')`): отчёты, где сотрудник ответственный, —
 * несданные со сроком сегодня и просроченные, неоплаченные налоги с прошедшим сроком; давние первыми.
 */
export function groupMineOf(
  employeeId: string,
  reports: readonly ReminderReport[],
  p: Pick<ReminderPolicy, 'today' | 'taxpay'>,
): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const r of reports) {
    if (r.responsibleId !== employeeId) continue;
    if (subOpen(r) && r.dueDate <= p.today) out.push({ report: r, due: r.dueDate, pay: false });
    if (payOpen(r, p) && r.payDue! < p.today) out.push({ report: r, due: r.payDue!, pay: true });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.report.id.localeCompare(b.report.id));
}

/** Напоминания одного человека за день; пустой список — сегодня ему писать нечего. */
export function remindersFor(
  person: ReminderPerson,
  data: {
    reports: readonly ReminderReport[];
    tasks: readonly ReminderTask[];
    people: ReadonlyMap<string, ReminderPerson>;
  },
  p: ReminderPolicy,
): ReminderLine[] {
  const sub = bucket();
  const pay = bucket();
  const wait: ReminderItem[] = [];
  for (const r of data.reports) {
    const responsible = r.responsibleId ? data.people.get(r.responsibleId) : undefined;
    if (subOpen(r)) {
      const when = whenOf(r.dueDate, r.remindDays, p);
      const item = when === null ? null : reportReach(person, r, when, responsible);
      if (item) put(sub, when, item);
    }
    if (payOpen(r, p)) {
      const when = whenOf(r.payDue!, r.remindDays, p);
      const item = when === null ? null : reportReach(person, r, when, responsible);
      if (item) put(pay, when, item);
    }
    if (
      p.reportConfirm &&
      r.waitingSince &&
      person.confirmReports &&
      notifyOn(person.settings, person.boss, 'regtasks') &&
      (person.confirmReports === 'all' ||
        r.contractorResponsibleId === person.employeeId ||
        r.responsibleId === person.employeeId) &&
      (person.isOwner || r.submittedById !== person.employeeId)
    ) {
      // ОТКЛОНЕНИЕ: docs/deviations.md#Б-12 — повтор, как у просрочки; прототип этого не показывает.
      const days = diffDays(p.today, r.waitingSince);
      if (p.overdueRepeat ? days >= p.confirmWaitDays : days === p.confirmWaitDays) {
        wait.push({ id: r.id, label: r.label });
      }
    }
  }
  const lines: ReminderLine[] = [];
  if (sub.today.length) lines.push({ key: 'tgToday', items: sub.today });
  if (sub.over.length) lines.push({ key: 'tgOver', items: sub.over });
  for (const days of [...sub.before.keys()].sort((a, b) => a - b)) {
    lines.push({ key: 'tgBefore', days, items: sub.before.get(days)! });
  }
  if (pay.today.length) lines.push({ key: 'tgPayToday', items: pay.today });
  if (pay.over.length) lines.push({ key: 'tgPayOver', items: pay.over });
  for (const days of [...pay.before.keys()].sort((a, b) => a - b)) {
    lines.push({ key: 'tgPay', days, items: pay.before.get(days)! });
  }
  if (wait.length) lines.push({ key: 'tgConfWait', days: p.confirmWaitDays, items: wait });
  if (p.tasks && notifyOn(person.settings, person.boss, 'tasks')) {
    const soon: ReminderItem[] = [];
    const over: ReminderItem[] = [];
    const waiting: ReminderItem[] = [];
    for (const task of data.tasks) {
      const item = { id: task.id, label: task.title };
      if (task.open && task.executorId === person.employeeId) {
        if (task.dueDate === addDays(p.today, 1)) soon.push(item);
        else if (
          task.dueDate < p.today &&
          (p.overdueRepeat || addDays(task.dueDate, 1) === p.today)
        ) {
          over.push(item);
        }
      }
      // Ждёт подтверждения дольше одного рабочего дня — сотрудникам с правом «Подтверждать задачи»
      // (постановщику сообщение ушло сразу).
      if (
        task.waitingSince &&
        person.confirmTasks &&
        task.executorId !== person.employeeId &&
        p.today > p.nextWorkingDay(addDays(task.waitingSince, 1))
      ) {
        waiting.push(item);
      }
    }
    if (soon.length) lines.push({ key: 'tgTaskSoon', items: soon });
    if (over.length) lines.push({ key: 'tgTaskOver', items: over });
    if (waiting.length) lines.push({ key: 'tgTaskWait', items: waiting });
  }
  const week = weekLine(person, data.reports, p);
  if (week) lines.push(week);
  return lines;
}

/** Напоминания за день всем, у кого привязан Telegram и есть что сказать. */
export function dailyReminders(
  people: readonly ReminderPerson[],
  data: { reports: readonly ReminderReport[]; tasks: readonly ReminderTask[] },
  p: ReminderPolicy,
): ReminderMessage[] {
  const byId = new Map(people.map((x) => [x.employeeId, x]));
  const out: ReminderMessage[] = [];
  for (const person of people) {
    if (!person.linked) continue;
    const lines = remindersFor(person, { ...data, people: byId }, p);
    const week = weekSummary(person, data.reports, p);
    if (lines.length || week) {
      out.push({ employeeId: person.employeeId, lines, ...(week ? { week } : {}) });
    }
  }
  return out;
}

/** Сколько строк списка показывать в одной части сообщения; остальные — «и ещё N». */
export const REMINDER_LIST_MAX = 15;
/** Предел текста сообщения Telegram — 4096 знаков; оставляем запас на организацию и ссылку. */
export const REMINDER_TEXT_MAX = 3800;

export interface ReminderTexts {
  /** Шаблон «Справочников платформы» по ключу (или текст по умолчанию). */
  template: (key: ReminderLine['key']) => string;
  /** «и ещё {n}». */
  more: string;
  /** «{report} ({name}: не привязан Telegram)» и без ответственного — «{report} (ответственный не назначен)». */
  unlinked: string;
  unassigned: string;
  /** Сводка: строка контрагента «{contractor}: {what}» и части «сдать {list}», «оплатить …», «просрочено …». */
  weekContractor: string;
  weekSub: string;
  weekPay: string;
  weekOver: string;
  /** «Открыть в Buhuchet.kg: {link}». */
  open: string;
}

const fill = (template: string, values: Readonly<Record<string, string | number>>) =>
  template.replace(/\{([^{}]+)\}/g, (whole, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole,
  );

function listText(items: readonly ReminderItem[], t: ReminderTexts): string {
  const shown = items
    .slice(0, REMINDER_LIST_MAX)
    .map((x) =>
      x.unlinked
        ? x.unlinked.shortName
          ? fill(t.unlinked, { report: x.label, name: x.unlinked.shortName })
          : fill(t.unassigned, { report: x.label })
        : x.label,
    );
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join('; ')}; ${fill(t.more, { n: rest })}` : shown.join('; ');
}

function lineText(line: ReminderLine, t: ReminderTexts): string {
  const template = t.template(line.key);
  if (line.key === 'tgWeek') {
    const head = fill(template, {
      даты: `${formatDateRu(line.from).slice(0, 5)}–${formatDateRu(line.to).slice(0, 5)}`,
      n1: line.sub,
      n2: line.pay,
      n3: line.over,
    });
    const shown = line.byContractor.slice(0, REMINDER_LIST_MAX).map((c) => {
      const parts = [
        c.sub.length ? fill(t.weekSub, { list: c.sub.join(', ') }) : '',
        c.pay.length ? fill(t.weekPay, { list: c.pay.join(', ') }) : '',
        c.over.length ? fill(t.weekOver, { list: c.over.join(', ') }) : '',
      ].filter(Boolean);
      return fill(t.weekContractor, { contractor: c.name, what: parts.join('; ') });
    });
    const rest = line.byContractor.length - shown.length;
    return [head, ...shown, ...(rest > 0 ? [fill(t.more, { n: rest })] : [])].join('\n');
  }
  return fill(template, {
    список: listText(line.items, t),
    ...('days' in line ? { дней: line.days } : {}),
  });
}

/**
 * Текст сообщения: части по порядку, затем ссылка на список; длинный текст обрезается. Без `link`
 * ссылки нет: под сообщением с таблицами её заменяет кнопка «Открыть отчёты на сайте».
 */
export function reminderText(
  message: Pick<ReminderMessage, 'lines'>,
  t: ReminderTexts,
  link: string | null,
): string {
  const body = message.lines.map((l) => lineText(l, t)).join('\n\n');
  const tail = link === null ? '' : `\n\n${fill(t.open, { link })}`;
  const max = REMINDER_TEXT_MAX - tail.length;
  return (body.length > max ? `${body.slice(0, max - 1)}…` : body) + tail;
}
