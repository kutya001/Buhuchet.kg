import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from '../common/dates';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  BELL_KEEP_DAYS,
  BELL_TARGETS,
  bellDayPlans,
  bellDayRows,
  bellDayText,
  bellKeepFrom,
  bellTaskDayText,
  bellTaskText,
  bellText,
} from './bell';
import { DEFAULT_NOTIFY_SETTINGS, withNotifyKind, withNotifyMode } from './notify';
import { remindersFor } from './reminders';
import type { ReminderPerson, ReminderPolicy, ReminderReport, ReminderTask } from './reminders';

const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);

describe('колокольчик: строки (доработки 16.11.2026, блок 3)', () => {
  it('«Сроки на сегодня» — как в прототипе v122: сегодня, оплаты, просрочено, скоро', () => {
    expect(bellDayText({ today: 3, pay: 2, over: 1, soon: 4 }, t)).toBe(
      'Сроки на сегодня: 3 отчёта, 2 оплаты; просрочено 1; скоро 4',
    );
    expect(bellDayText({ today: 1, pay: 0, over: 0, soon: 0 }, t)).toBe(
      'Сроки на сегодня: 1 отчёт',
    );
    expect(bellDayText({ today: 5, pay: 1, over: 0, soon: 0 }, t)).toBe(
      'Сроки на сегодня: 5 отчётов, 1 оплата',
    );
    expect(bellDayText({ today: 0, pay: 0, over: 13, soon: 21 }, t)).toBe(
      'Сроки на сегодня: нет; просрочено 13; скоро 21',
    );
    expect(bellDayText({ today: 0, pay: 0, over: 0, soon: 0 }, t)).toBeNull();
  });

  it('задача: название и причина возврата', () => {
    expect(bellTaskText('task_new', 'Акт сверки', null, t)).toBe('Новая задача: Акт сверки');
    expect(bellTaskText('task_rework', 'Акт сверки', 'нет подписи', t)).toBe(
      'Задача на доработке: Акт сверки. Причина: нет подписи',
    );
  });

  it('фраза одной строкой и не длиннее 1000 знаков', () => {
    expect(bellText('  Вопрос\nиз   Telegram ')).toBe('Вопрос из Telegram');
    const long = bellText('а'.repeat(1200));
    expect(long).toHaveLength(1000);
    expect(long.endsWith('…')).toBe(true);
  });

  it('хранение — 90 дней; виды «что открыть» — как договорено с панелью', () => {
    expect(BELL_KEEP_DAYS).toBe(90);
    expect(bellKeepFrom('2026-11-16')).toBe('2026-08-18');
    expect(BELL_TARGETS).toEqual([
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
      'sub',
      'sub_check',
      'storage_check',
    ]);
  });
});

// Четверг; понедельник — 02.11.2026.
const TODAY: IsoDate = '2026-10-29';

const person = (id: string, patch: Partial<ReminderPerson> = {}): ReminderPerson => ({
  employeeId: id,
  shortName: `Сотрудник ${id}`,
  boss: false,
  isOwner: false,
  linked: false,
  settings: DEFAULT_NOTIFY_SETTINGS,
  viewReports: 'own',
  confirmReports: null,
  confirmTasks: false,
  ...patch,
});

let seq = 0;
const report = (patch: Partial<ReminderReport> = {}): ReminderReport => ({
  id: `r${++seq}`,
  label: `Отчёт ${seq}`,
  typeShort: `Вид ${seq}`,
  contractorName: 'ОсОО «Ромашка»',
  contractorResponsibleId: 'acc',
  act: 'sub',
  dueDate: TODAY,
  payDue: null,
  open: true,
  unpaid: false,
  responsibleId: 'acc',
  remindDays: [7, 3],
  waitingSince: null,
  submittedById: null,
  paused: false,
  ...patch,
});

const task = (patch: Partial<ReminderTask> = {}): ReminderTask => ({
  id: `t${++seq}`,
  title: `Задача ${seq}`,
  executorId: 'acc',
  authorId: 'chief',
  dueDate: addDays(TODAY, 1),
  open: true,
  waitingSince: null,
  ...patch,
});

const policy = (patch: Partial<ReminderPolicy> = {}): ReminderPolicy => ({
  today: TODAY,
  overdueRepeat: true,
  reportConfirm: true,
  confirmWaitDays: 3,
  taxpay: true,
  tasks: true,
  week: null,
  nextWorkingDay: (d) => d,
  ...patch,
});

describe('колокольчик: строки дня — как утреннее сообщение Telegram, и без привязанного Telegram', () => {
  const acc = person('acc');
  const chief = person('chief', { boss: true, linked: true, viewReports: 'all' });
  const reports = [
    report(),
    report(),
    report({ dueDate: addDays(TODAY, -2) }),
    report({ dueDate: addDays(TODAY, 3) }),
    report({ act: 'pay', payDue: TODAY, unpaid: true }),
    report({ act: 'pay', payDue: addDays(TODAY, 7), unpaid: true }),
    // Не в день напоминания (за 5 дней) — в сообщении дня его нет, и в строке тоже.
    report({ dueDate: addDays(TODAY, 5) }),
    // Чужой отчёт: у руководителя он в сообщении Telegram (ответственный без Telegram) — и в его строке.
    report({ responsibleId: 'other', contractorResponsibleId: 'other' }),
  ];

  it('«Сроки на сегодня» — свои отчёты, у сотрудника без Telegram тоже', () => {
    const plans = bellDayPlans([acc, chief], { reports, tasks: [] }, policy());
    expect(plans[0]).toEqual({
      employeeId: 'acc',
      dues: { today: 2, pay: 2, over: 1, soon: 1 },
      others: false,
      confWait: 0,
      tasks: { soon: 0, over: 0, wait: 0 },
      week: null,
    });
    expect(bellDayRows(plans[0]!, TODAY, 0, t)).toEqual([
      {
        employeeId: 'acc',
        kind: 'reports',
        event: 'day_dues',
        target: { kind: 'reports_day', id: TODAY },
        need: 'repView',
        text: 'Сроки на сегодня: 2 отчёта, 2 оплаты; просрочено 1; скоро 1',
        eventKey: `day_dues:${TODAY}`,
      },
    ]);
  });

  // Доработки 16.11.2026, приёмка «Колокольчик против Telegram»: у владельца и главного бухгалтера числа
  // строки — как в утреннем сообщении, вместе с отчётами других сотрудников по объёму из профиля.
  it('владелец и главный бухгалтер: числа строки — как в сообщении Telegram, по объёму из профиля', () => {
    const linked = person('other', { linked: true });
    const others = [
      report({ responsibleId: 'other', contractorResponsibleId: 'other' }),
      report({
        responsibleId: 'other',
        contractorResponsibleId: 'other',
        dueDate: addDays(TODAY, -1),
      }),
      report({
        responsibleId: 'other',
        contractorResponsibleId: 'other',
        dueDate: addDays(TODAY, 3),
      }),
    ];
    const boss = (mode: 'all' | 'digest' | 'manual', off?: 'before') =>
      person('chief', {
        boss: true,
        viewReports: 'all',
        settings: off ? withNotifyKind(withNotifyMode(mode), off, false) : withNotifyMode(mode),
      });
    // Сколько отчётов в утреннем сообщении — по тем же строкам `remindersFor`.
    const inTelegram = (p: ReminderPerson) =>
      remindersFor(
        p,
        { reports: others, tasks: [], people: new Map([['other', linked]]) },
        policy(),
      ).reduce((n, l) => n + ('items' in l ? l.items.length : 0), 0);
    const plan = (p: ReminderPerson) =>
      bellDayPlans([p, linked], { reports: others, tasks: [] }, policy()).find(
        (x) => x.employeeId === 'chief',
      );
    // «Все» — день срока, просрочка и «за N дней» по отчётам других.
    expect(plan(boss('all'))).toMatchObject({
      dues: { today: 1, over: 1, soon: 1 },
      others: true,
    });
    expect(inTelegram(boss('all'))).toBe(3);
    const [row] = bellDayRows(plan(boss('all'))!, TODAY, 0, t);
    expect(row).toMatchObject({
      event: 'day_dues',
      target: { kind: 'reports_tab', id: 'week' },
      text: 'Сроки на сегодня: 1 отчёт; просрочено 1; скоро 1',
    });
    // «Только просрочки и сводка» — только просрочка.
    expect(plan(boss('digest'))).toMatchObject({ dues: { today: 0, over: 1, soon: 0 } });
    expect(inTelegram(boss('digest'))).toBe(1);
    // Выключил «за N дней» — нет ни в сообщении, ни в строке.
    expect(plan(boss('all', 'before'))).toMatchObject({ dues: { today: 1, over: 1, soon: 0 } });
    expect(inTelegram(boss('all', 'before'))).toBe(2);
    // «Только ручные задачи» — строки сроков нет, как и сообщения.
    expect(plan(boss('manual'))).toBeUndefined();
    expect(inTelegram(boss('manual'))).toBe(0);
  });

  // Правило Telegram продукта (ТЗ «Уведомления в Telegram», п. Б-13): отчёты сотрудника без привязанного
  // Telegram приходят руководителю при любом объёме — и в строке тоже (docs/deviations.md п. Т-21).
  it('сотрудник без Telegram: его отчёты — у руководителя и в «Только ручные задачи», как в сообщении', () => {
    const unlinked = person('other');
    const mine = [
      report({ responsibleId: 'other', contractorResponsibleId: 'other' }),
      report({
        responsibleId: 'other',
        contractorResponsibleId: 'other',
        dueDate: addDays(TODAY, -1),
      }),
    ];
    for (const mode of ['manual', 'digest'] as const) {
      const boss = person('chief', {
        boss: true,
        viewReports: 'all',
        settings: withNotifyMode(mode),
      });
      const inTelegram = remindersFor(
        boss,
        { reports: mine, tasks: [], people: new Map([['other', unlinked]]) },
        policy(),
      ).reduce((n, l) => n + ('items' in l ? l.items.length : 0), 0);
      expect(inTelegram).toBe(2);
      const plan = bellDayPlans([boss, unlinked], { reports: mine, tasks: [] }, policy()).find(
        (x) => x.employeeId === 'chief',
      );
      expect(plan).toMatchObject({ dues: { today: 1, over: 1 }, others: true });
    }
  });

  it('главный бухгалтер с областью отчётов «Свои» или без права на отчёты — чужих отчётов в строке нет', () => {
    const linked = person('other', { linked: true });
    const theirs = [report({ responsibleId: 'other', contractorResponsibleId: 'other' })];
    for (const viewReports of ['own', null] as const) {
      const boss = person('chief', { boss: true, viewReports });
      const plan = bellDayPlans([boss, linked], { reports: theirs, tasks: [] }, policy()).find(
        (x) => x.employeeId === 'chief',
      );
      expect(plan).toBeUndefined();
    }
  });

  it('«Ждут подтверждения сдачи» и задачи — по правилам сообщения дня', () => {
    const boss = person('chief', {
      boss: true,
      confirmReports: 'all',
      confirmTasks: true,
      viewReports: 'all',
    });
    const waiting = report({ open: false, waitingSince: addDays(TODAY, -3), submittedById: 'acc' });
    const tasks = [
      task(),
      task({ dueDate: addDays(TODAY, -1) }),
      task({ executorId: 'acc', open: false, waitingSince: addDays(TODAY, -5) }),
    ];
    const [accPlan, bossPlan] = bellDayPlans([acc, boss], { reports: [waiting], tasks }, policy());
    expect(accPlan).toMatchObject({ employeeId: 'acc', tasks: { soon: 1, over: 1, wait: 0 } });
    expect(bossPlan).toMatchObject({ employeeId: 'chief', confWait: 1, tasks: { wait: 1 } });
    expect(bellDayRows(accPlan!, TODAY, 0, t).map((r) => [r.event, r.text, r.target])).toEqual([
      ['task_day', 'Задачи: завтра срок 1, просрочено 1', { kind: 'tasks_tab', id: 'mine' }],
    ]);
    expect(bellDayRows(bossPlan!, TODAY, 0, t).map((r) => [r.event, r.text, r.need])).toEqual([
      ['conf_wait', 'Ждут подтверждения сдачи: 1', 'repConfirm'],
      ['task_day', 'Задачи: ждут подтверждения 1', null],
    ]);
  });

  it('выключены «Ручные задачи» в профиле — строки о задачах нет, как и в Telegram', () => {
    const off = person('acc', {
      settings: withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'tasks', false),
    });
    expect(bellDayPlans([off], { reports: [], tasks: [task()] }, policy())).toEqual([]);
  });

  it('«Сводка недели» в день сводки: руководителю — с должниками, сотруднику — его неделя', () => {
    const week = { from: '2026-11-02' as IsoDate, to: '2026-11-08' as IsoDate };
    const p = policy({ today: '2026-11-02', week });
    const rs = [
      report({ dueDate: '2026-11-05' }),
      report({ dueDate: '2026-10-30' }),
      report({ dueDate: '2026-11-06', responsibleId: 'other', contractorResponsibleId: 'other' }),
    ];
    const plans = bellDayPlans([acc, chief], { reports: rs, tasks: [] }, p);
    expect(plans.map((x) => [x.employeeId, x.week])).toEqual([
      ['acc', { sub: 1, over: 1, boss: false }],
      ['chief', { sub: 2, over: 1, boss: true }],
    ]);
    const chiefRows = bellDayRows(plans[1]!, '2026-11-02', 4, t);
    // У сотрудника нет Telegram — его отчёты в сообщении руководителя, значит, и в его строке дня.
    expect(chiefRows[0]).toMatchObject({
      event: 'day_dues',
      target: { kind: 'reports_tab', id: 'week' },
      text: 'Сроки на сегодня: нет; просрочено 1; скоро 1',
    });
    expect(chiefRows.slice(1)).toEqual([
      {
        employeeId: 'chief',
        kind: 'reports',
        event: 'week',
        target: { kind: 'reports_tab', id: 'week' },
        need: 'repView',
        text: 'Сводка недели: сдать 2, просрочено 1, должников за обслуживание 4',
        eventKey: 'week:2026-11-02',
      },
    ]);
    // Должники — только в сводке руководителя.
    expect(bellDayRows(plans[0]!, '2026-11-02', 4, t).find((r) => r.event === 'week')?.text).toBe(
      'Сводка недели: сдать 1, просрочено 1',
    );
  });

  it('руководителю без отчётов на неделе — сводка только с должниками, без них — ничего', () => {
    const week = { from: '2026-11-02' as IsoDate, to: '2026-11-08' as IsoDate };
    const [plan] = bellDayPlans([chief], { reports: [], tasks: [] }, policy({ week }));
    expect(bellDayRows(plan!, '2026-11-02', 2, t).map((r) => r.text)).toEqual([
      'Сводка недели: сдать 0, просрочено 0, должников за обслуживание 2',
    ]);
    expect(bellDayRows(plan!, '2026-11-02', 0, t)).toEqual([]);
  });

  it('строка задач: пусто — нет строки', () => {
    expect(bellTaskDayText({ soon: 0, over: 0, wait: 0 }, t)).toBeNull();
    expect(bellTaskDayText({ soon: 0, over: 3, wait: 2 }, t)).toBe(
      'Задачи: просрочено 3, ждут подтверждения 2',
    );
  });
});
