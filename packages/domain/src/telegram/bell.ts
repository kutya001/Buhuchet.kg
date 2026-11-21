import { addDays, type IsoDate } from '../common/dates';
import { pluralForm } from '../common/list';
import type { Translate } from '../l10n/texts';
import type { PermissionId } from '../roles/permissions';
import {
  remindersFor,
  weekSummary,
  type ReminderPerson,
  type ReminderPolicy,
  type ReminderReport,
  type ReminderTask,
} from './reminders';

/**
 * Колокольчик уведомлений: что в него попадает (доработки 16.11.2026, блок 3; поток Т; прототип v122
 * `modules/bell.js`). Попадает всё, что человек получает в Telegram, по тем же правилам, получателям и
 * настройкам профиля, и опубликованные новости; колокольчик работает и без привязанного Telegram, и при
 * выключенных «Напоминаниях в Telegram» (по умолчанию). Одно событие — одна строка у человека (ключ
 * события), видно только то, что человек видит по правам сейчас, строки хранятся 90 дней. Значок, счётчик
 * и панель — поток И; положить строку — `putBell` модуля telegram (стык «Положить уведомление»).
 */

/** Кнопки-фильтры панели; «Другое» (заявки, вход, рассылки) — только во «Все». */
export const BELL_KINDS = ['reports', 'tasks', 'files', 'money', 'news', 'other'] as const;
export type BellKind = (typeof BELL_KINDS)[number];

/**
 * Что открывает строка (`target_kind`) и что у неё вместо номера (`target_id`): запись, «Отправленные
 * файлы», «Деньги» и «Обслуживание» контрагента — номер контрагента; отчёты на день — дата; вкладка
 * отчётов — `week`, `overdue`, `wait`. Договорено с потоком И (панель открывает по этому списку).
 */
export const BELL_TARGETS = [
  'report',
  'task',
  'cp_sent',
  'cp_money',
  'cp_fee',
  'contractor',
  'reports_day',
  'reports_tab',
  'tasks_tab',
  'employee',
  'news',
  'lead',
  // Подписки (доработки 20.11.2026, блок 4, пункт 3; блок 6, пункт 3): владельцу — экран «Подписка»
  // (номер — организация), администратору платформы — окно «Подписка организации» (номер — организация);
  // сверка хранилища — вкладка «Проверка хранилища» модуля «Файлы» Админки (номер — запуск сверки).
  'sub',
  'sub_check',
  'storage_check',
  // «Витрина данных» (общий план 20.11, этап 2, П4): администратору платформы — окно шаблона Админки
  // (номер — шаблон), когда проверка системой его сломала.
  'dm_template',
  // API-токен «Витрины данных» (этап 3, П5): владельцу — окно токена на вкладке «API Токены» (номер —
  // токен): создан, отозван, до конца срока 7 дней.
  'dm_token',
] as const;
export type BellTarget = (typeof BELL_TARGETS)[number];
export const BELL_REPORT_TABS = ['week', 'overdue', 'wait'] as const;
/** Вкладка задач строки «Задачи на сегодня»: мои задачи (`tasks_tab` / `mine`). */
export const BELL_TASK_TABS = ['mine'] as const;

/** Строки старше 90 дней удаляются (по умолчанию). */
export const BELL_KEEP_DAYS = 90;
/** Строк за раз в панели, дальше — «Показать ещё» (по умолчанию). */
export const BELL_PAGE_SIZE = 30;
/**
 * Новости и заявки попадают в колокольчик с его появления (по умолчанию, прототип `BELL_FROM`): уже
 * выпущенные новости остаются в «Новостях» и не забивают счётчик.
 */
export const BELL_FROM: IsoDate = '2026-11-16';
/** Длина фразы строки — как в таблице (`text` до 1000 знаков). */
export const BELL_TEXT_MAX = 1000;

/** С какого дня строки ещё хранятся. */
export function bellKeepFrom(today: IsoDate): IsoDate {
  return addDays(today, -BELL_KEEP_DAYS);
}

/** Фраза строки: пробелы схлопнуты, не длиннее предела (многоточием). */
export function bellText(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > BELL_TEXT_MAX ? `${s.slice(0, BELL_TEXT_MAX - 1)}…` : s;
}

/** Числа утреннего напоминания одного человека: сдать сегодня, оплатить, просрочено, скоро. */
export interface BellDayCounts {
  today: number;
  pay: number;
  over: number;
  soon: number;
}

/**
 * Строка «Сроки на сегодня» — одна в день, как утреннее сообщение бота (прототип `bellDayText`):
 * «Сроки на сегодня: 3 отчёта, 2 оплаты; просрочено 1; скоро 4». Ничего нет — строки нет (`null`).
 */
export function bellDayText(c: BellDayCounts, tr: Translate): string | null {
  if (!c.today && !c.pay && !c.over && !c.soon) return null;
  const today = [
    c.today ? tr(`bell.line.day.reports.${pluralForm(c.today)}`, { n: c.today }) : '',
    c.pay ? tr(`bell.line.day.pay.${pluralForm(c.pay)}`, { n: c.pay }) : '',
  ].filter(Boolean);
  return (
    tr('bell.line.day', { list: today.join(', ') || tr('bell.line.day.none') }) +
    (c.over ? tr('bell.line.day.over', { n: c.over }) : '') +
    (c.soon ? tr('bell.line.day.soon', { n: c.soon }) : '')
  );
}

/** События задач — как сообщения Telegram о задачах (`queueTelegramEvents`). */
export const BELL_TASK_EVENTS = {
  task_new: 'bell.line.task.new',
  task_on_confirm: 'bell.line.task.on_confirm',
  task_confirmed: 'bell.line.task.confirmed',
  task_rework: 'bell.line.task.rework',
  task_cancelled: 'bell.line.task.cancelled',
  task_started: 'bell.line.task.started',
  task_done: 'bell.line.task.done',
} as const;
export type BellTaskEvent = keyof typeof BELL_TASK_EVENTS;

/** «Новая задача: …», «Задача на доработке: …. Причина: …» (прототип `bellTask`). */
export function bellTaskText(
  event: BellTaskEvent,
  title: string,
  reason: string | null,
  tr: Translate,
): string {
  const head = tr(BELL_TASK_EVENTS[event], { task: title });
  return bellText(reason ? head + tr('bell.line.reason', { reason }) : head);
}

/** Числа строки «Задачи на сегодня»: завтра срок, просрочено, ждут подтверждения. */
export interface BellTaskDayCounts {
  soon: number;
  over: number;
  wait: number;
}

/** Что положить человеку в колокольчик в час напоминаний: числа строк дня. */
export interface BellDayPlan {
  employeeId: string;
  /**
   * «Сроки на сегодня» — те же числа, что в утреннем сообщении Telegram (доработки 16.11.2026, приёмка
   * «Колокольчик против Telegram»): у владельца и главного бухгалтера — и отчёты других сотрудников по
   * объёму и переключателям профиля.
   */
  dues: BellDayCounts;
  /** Среди отчётов строки есть чужие: строка откроет «На неделе» без отбора «Ответственный — я». */
  others: boolean;
  /** «Ждут подтверждения сдачи» — как строка `tgConfWait` сообщения дня. */
  confWait: number;
  tasks: BellTaskDayCounts;
  /** «Сводка недели»: руководителю — `weekSummary`, сотруднику — строка `tgWeek`; null — не сегодня. */
  week: { sub: number; over: number; boss: boolean } | null;
}

const countOf = (lines: ReturnType<typeof remindersFor>, keys: readonly string[]) =>
  lines
    .filter((l) => keys.includes(l.key))
    .reduce((n, l) => n + ('items' in l ? l.items.length : 0), 0);

/**
 * Строки дня колокольчика (доработки 16.11.2026, блок 3; прототип v122 `bellStaffDay`): те же правила,
 * получатели и переключатели профиля, что у утреннего сообщения Telegram (`remindersFor`, `weekSummary`),
 * но каждому сотруднику — и без привязанного Telegram. «Сроки на сегодня» — с теми же числами, что
 * сообщение (этап 2, «Колокольчик против Telegram»): у сотрудника — свои отчёты, по нажатию — «На неделе»
 * с отбором «Ответственный — я»; у владельца и главного бухгалтера — и чужие по объёму из профиля, тогда
 * по нажатию — «На неделе» без отбора. Человек без единой строки — не в списке.
 */
export function bellDayPlans(
  people: readonly ReminderPerson[],
  data: { reports: readonly ReminderReport[]; tasks: readonly ReminderTask[] },
  p: ReminderPolicy,
): BellDayPlan[] {
  const byId = new Map(people.map((x) => [x.employeeId, x]));
  const out: BellDayPlan[] = [];
  for (const person of people) {
    const lines = remindersFor(person, { ...data, people: byId }, p);
    const own = new Set(
      data.reports.filter((r) => r.responsibleId === person.employeeId).map((r) => r.id),
    );
    // ОТКЛОНЕНИЕ: docs/deviations.md#Т-21 — у руководителя и чужие отчёты, как в его сообщении Telegram.
    const dueKeys = ['tgToday', 'tgPayToday', 'tgPay', 'tgPayOver', 'tgOver', 'tgBefore'];
    const dues: BellDayCounts = {
      today: countOf(lines, ['tgToday']),
      pay: countOf(lines, ['tgPayToday', 'tgPay', 'tgPayOver']),
      over: countOf(lines, ['tgOver']),
      soon: countOf(lines, ['tgBefore']),
    };
    const others = lines.some(
      (l) => dueKeys.includes(l.key) && 'items' in l && l.items.some((i) => !own.has(i.id)),
    );
    const tasks: BellTaskDayCounts = {
      soon: countOf(lines, ['tgTaskSoon']),
      over: countOf(lines, ['tgTaskOver']),
      wait: countOf(lines, ['tgTaskWait']),
    };
    const confWait = countOf(lines, ['tgConfWait']);
    const boss = weekSummary(person, data.reports, p);
    const line = lines.find((l) => l.key === 'tgWeek');
    const week = boss
      ? { sub: boss.sub, over: boss.over, boss: true }
      : line?.key === 'tgWeek'
        ? { sub: line.sub, over: line.over, boss: false }
        : null;
    const counts = [...Object.values(dues), ...Object.values(tasks), confWait];
    if (counts.some(Boolean) || (week && (week.sub || week.over || week.boss))) {
      out.push({ employeeId: person.employeeId, dues, others, confWait, tasks, week });
    }
  }
  return out;
}

/** Строка колокольчика по расписанию: что положить, кому и с каким ключом. */
export interface BellDayRow {
  employeeId: string;
  kind: BellKind;
  event: 'day_dues' | 'conf_wait' | 'task_day' | 'week';
  target: { kind: BellTarget; id: string };
  need: PermissionId | null;
  text: string;
  eventKey: string;
}

/** «Задачи: завтра срок 2, просрочено 1, ждут подтверждения 1». Ничего — `null`. */
export function bellTaskDayText(c: BellTaskDayCounts, tr: Translate): string | null {
  const parts = [
    c.soon ? tr('bell.line.task_day.soon', { n: c.soon }) : '',
    c.over ? tr('bell.line.task_day.over', { n: c.over }) : '',
    c.wait ? tr('bell.line.task_day.wait', { n: c.wait }) : '',
  ].filter(Boolean);
  return parts.length ? tr('bell.line.task_day', { list: parts.join(', ') }) : null;
}

/**
 * Строки дня одного человека (прототип v122 `bellStaffDay`): «Сроки на сегодня» (откроет «На неделе»: свои
 * отчёты, а с чужими — все), «Ждут подтверждения сдачи» (вкладка «ждут подтверждения»), «Задачи» (мои задачи) и в «День
 * сводки» — «Сводка недели» (вкладка недели; руководителю — с числом должников за обслуживание
 * `debtors`). Ключ — вид и день: перезапуск расписания второй строки не кладёт.
 */
export function bellDayRows(
  plan: BellDayPlan,
  today: IsoDate,
  debtors: number,
  tr: Translate,
): BellDayRow[] {
  const rows: BellDayRow[] = [];
  const add = (row: Omit<BellDayRow, 'employeeId' | 'eventKey'>) =>
    rows.push({ employeeId: plan.employeeId, ...row, eventKey: `${row.event}:${today}` });
  const dues = bellDayText(plan.dues, tr);
  if (dues) {
    add({
      kind: 'reports',
      event: 'day_dues',
      target: plan.others
        ? { kind: 'reports_tab', id: 'week' }
        : { kind: 'reports_day', id: today },
      need: 'repView',
      text: dues,
    });
  }
  if (plan.confWait) {
    add({
      kind: 'reports',
      event: 'conf_wait',
      target: { kind: 'reports_tab', id: 'wait' },
      need: 'repConfirm',
      text: tr('bell.line.conf_wait', { n: plan.confWait }),
    });
  }
  const tasks = bellTaskDayText(plan.tasks, tr);
  if (tasks) {
    add({
      kind: 'tasks',
      event: 'task_day',
      target: { kind: 'tasks_tab', id: 'mine' },
      need: null,
      text: tasks,
    });
  }
  const w = plan.week;
  const debt = w?.boss ? debtors : 0;
  if (w && (w.sub || w.over || debt)) {
    add({
      kind: 'reports',
      event: 'week',
      target: { kind: 'reports_tab', id: 'week' },
      need: 'repView',
      text:
        tr('bell.line.week', { sub: w.sub, over: w.over }) +
        (debt ? tr('bell.line.week.debt', { n: debt }) : ''),
    });
  }
  return rows;
}
