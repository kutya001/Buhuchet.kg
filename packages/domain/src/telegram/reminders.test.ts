import { describe, expect, it } from 'vitest';
import { addDays, type IsoDate } from '../common/dates';
import { TELEGRAM_TEMPLATE_DEFAULTS } from './messages';
import { DEFAULT_NOTIFY_SETTINGS, withNotifyKind, withNotifyMode } from './notify';
import {
  dailyReminders,
  REMINDER_LIST_MAX,
  REMINDER_TEXT_MAX,
  reminderText,
  remindersFor,
  type ReminderPerson,
  type ReminderPolicy,
  type ReminderReport,
  type ReminderTask,
  type ReminderTexts,
} from './reminders';

// Четверг; понедельник — 02.11.2026.
const TODAY: IsoDate = '2026-10-29';

const person = (id: string, patch: Partial<ReminderPerson> = {}): ReminderPerson => ({
  employeeId: id,
  shortName: `Сотрудник ${id}`,
  boss: false,
  isOwner: false,
  linked: true,
  settings: DEFAULT_NOTIFY_SETTINGS,
  viewReports: 'own',
  confirmReports: null,
  confirmTasks: false,
  ...patch,
});

let seq = 0;
const report = (patch: Partial<ReminderReport> = {}): ReminderReport => {
  seq++;
  return {
    id: `r${seq}`,
    label: `Отчёт ${seq}`,
    typeShort: `Вид ${seq}`,
    contractorName: 'ОсОО «Ромашка»',
    contractorResponsibleId: 'acc',
    act: 'sub',
    dueDate: addDays(TODAY, 3),
    payDue: null,
    open: true,
    unpaid: false,
    responsibleId: 'acc',
    remindDays: [7, 3],
    waitingSince: null,
    submittedById: null,
    paused: false,
    ...patch,
  };
};

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

const acc = person('acc');
const chief = person('chief', {
  boss: true,
  viewReports: 'all',
  confirmReports: 'all',
  confirmTasks: true,
});
const people = new Map([acc, chief].map((p) => [p.employeeId, p]));
const keys = (lines: { key: string }[]) => lines.map((l) => l.key);
const linesOf = (
  who: ReminderPerson,
  data: {
    reports?: ReminderReport[];
    tasks?: ReminderTask[];
    people?: Map<string, ReminderPerson>;
  },
  p: Partial<ReminderPolicy> = {},
) =>
  remindersFor(
    who,
    { reports: data.reports ?? [], tasks: data.tasks ?? [], people: data.people ?? people },
    policy(p),
  );

const texts: ReminderTexts = {
  template: (key) => TELEGRAM_TEMPLATE_DEFAULTS[key],
  more: 'и ещё {n}',
  unlinked: '{report} ({name}: не привязан Telegram)',
  unassigned: '{report} (ответственный не назначен)',
  weekContractor: '• {contractor}: {what}',
  weekSub: 'сдать {list}',
  weekPay: 'оплатить {list}',
  weekOver: 'просрочено {list}',
  open: 'Открыть в Buhuchet.kg: {link}',
};

describe('напоминания за день (ТЗ «Уведомления в Telegram»)', () => {
  it('п. 8: ответственный получает одно сообщение за 3 дня до срока со всеми своими отчётами', () => {
    const reports = [report(), report(), report({ responsibleId: 'other' })];
    const messages = dailyReminders([acc], { reports, tasks: [] }, policy());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.lines).toEqual([
      {
        key: 'tgBefore',
        days: 3,
        items: [reports[0], reports[1]].map((r) => ({ id: r!.id, label: r!.label })),
      },
    ]);
    const text = reminderText(messages[0]!, texts, 'https://test.buhuchet.kg/app/reports/week');
    expect(text).toBe(
      `⏰ Через 3 дн. срок сдачи: ${reports[0]!.label}; ${reports[1]!.label}\n\nОткрыть в Buhuchet.kg: https://test.buhuchet.kg/app/reports/week`,
    );
  });

  it('дни напоминаний — из вида отчёта; в день срока — всегда; не в эти дни — ничего', () => {
    expect(keys(linesOf(acc, { reports: [report({ dueDate: addDays(TODAY, 5) })] }))).toEqual([]);
    expect(keys(linesOf(acc, { reports: [report({ dueDate: addDays(TODAY, 7) })] }))).toEqual([
      'tgBefore',
    ]);
    expect(keys(linesOf(acc, { reports: [report({ dueDate: TODAY, remindDays: [] })] }))).toEqual([
      'tgToday',
    ]);
  });

  it('просрочка: «Повторять каждый день» — каждый день, иначе только на следующий день после срока', () => {
    const late = report({ dueDate: addDays(TODAY, -4) });
    const yesterday = report({ dueDate: addDays(TODAY, -1) });
    expect(linesOf(acc, { reports: [late, yesterday] })[0]).toMatchObject({
      key: 'tgOver',
      items: [{ id: late.id }, { id: yesterday.id }],
    });
    expect(linesOf(acc, { reports: [late, yesterday] }, { overdueRepeat: false })[0]).toMatchObject(
      {
        key: 'tgOver',
        items: [{ id: yesterday.id }],
      },
    );
  });

  it('сданный, «Уплата» без сдачи и приостановленный контрагент — без напоминаний о сдаче', () => {
    const reports = [
      report({ open: false }),
      report({ act: 'pay', payDue: null }),
      report({ paused: true }),
    ];
    expect(linesOf(acc, { reports })).toEqual([]);
  });

  it('оплата — только при «Учёте оплаты налогов», пока налог не оплачен полностью', () => {
    const pay = report({ act: 'pay', payDue: TODAY, unpaid: true });
    const paid = report({ act: 'both', payDue: TODAY, unpaid: false, open: false });
    expect(keys(linesOf(acc, { reports: [pay, paid] }))).toEqual(['tgPayToday']);
    expect(linesOf(acc, { reports: [pay] }, { taxpay: false })).toEqual([]);
    const both = report({ act: 'both', dueDate: TODAY, payDue: addDays(TODAY, 3), unpaid: true });
    expect(keys(linesOf(acc, { reports: [both] }))).toEqual(['tgToday', 'tgPay']);
  });

  it('владелец и главный бухгалтер получают по отчётам других — по режиму и переключателям', () => {
    const before = report();
    const today = report({ dueDate: TODAY });
    const over = report({ dueDate: addDays(TODAY, -2) });
    const reports = [before, today, over];
    expect(keys(linesOf(chief, { reports }))).toEqual(['tgToday', 'tgOver', 'tgBefore']);
    const digest = { ...chief, settings: withNotifyMode('digest') };
    expect(keys(linesOf(digest, { reports }))).toEqual(['tgOver']);
    const noOver = { ...chief, settings: withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'over', false) };
    expect(keys(linesOf(noOver, { reports }))).toEqual(['tgToday', 'tgBefore']);
    // Сотрудник чужих отчётов не получает.
    expect(linesOf(person('x'), { reports })).toEqual([]);
  });

  it('главный бухгалтер с областью «Свои» или без «Просматривать отчёты» получает чужие отчёты только в своей области (п. Б-13)', () => {
    const mine = report({ contractorResponsibleId: 'chief', responsibleId: 'acc' });
    const foreign = report({ contractorName: 'ОсОО «Чужая»' });
    const unlinked = person('acc', { linked: false });
    const map = new Map([unlinked, chief].map((p) => [p.employeeId, p]));
    const week = { week: { from: '2026-10-26', to: '2026-11-01' } };
    const own = { ...chief, viewReports: 'own' as const };
    const lines = linesOf(own, { reports: [mine, foreign], people: map }, week);
    expect(lines.flatMap((l) => ('items' in l ? l.items.map((i) => i.id) : []))).toEqual([mine.id]);
    expect(lines.find((l) => l.key === 'tgWeek')).toMatchObject({ sub: 1 });
    const blind = { ...chief, viewReports: null };
    expect(linesOf(blind, { reports: [mine, foreign], people: map }, week)).toEqual([]);
    // Свои отчёты (где он ответственный) приходят всегда.
    expect(
      keys(linesOf(blind, { reports: [report({ responsibleId: 'chief' })], people: map })),
    ).toEqual(['tgBefore']);
  });

  it('у ответственного не привязан Telegram — главный бухгалтер получает с пометкой при любом режиме', () => {
    const unlinked = person('acc', { linked: false, shortName: 'Алишер Т.' });
    const map = new Map([unlinked, chief].map((p) => [p.employeeId, p]));
    const r = report();
    const manual = { ...chief, settings: withNotifyMode('manual') };
    const lines = linesOf(manual, { reports: [r], people: map });
    expect(lines).toEqual([
      {
        key: 'tgBefore',
        days: 3,
        items: [{ id: r.id, label: r.label, unlinked: { shortName: 'Алишер Т.' } }],
      },
    ]);
    expect(reminderText({ lines }, texts, 'https://x')).toContain(
      `${r.label} (Алишер Т.: не привязан Telegram)`,
    );
    // Без ответственного — «ответственный не назначен».
    const none = linesOf(manual, { reports: [report({ responsibleId: null })], people: map });
    expect(reminderText({ lines: none }, texts, 'https://x')).toContain(
      '(ответственный не назначен)',
    );
    // Сам непривязанный сообщения не получает.
    expect(dailyReminders([unlinked], { reports: [r], tasks: [] }, policy())).toEqual([]);
  });

  it('сдача ждёт подтверждения дольше N дней — тем, кто подтверждает (не свою сдачу, в своей области)', () => {
    const waiting = report({
      open: false,
      waitingSince: addDays(TODAY, -3),
      submittedById: 'acc',
    });
    const own = report({ open: false, waitingSince: addDays(TODAY, -3), submittedById: 'chief' });
    expect(linesOf(chief, { reports: [waiting, own] })).toEqual([
      { key: 'tgConfWait', days: 3, items: [{ id: waiting.id, label: waiting.label }] },
    ]);
    // Владелец подтверждает и свою сдачу.
    const owner = { ...chief, isOwner: true };
    expect(linesOf(owner, { reports: [own] })[0]).toMatchObject({ key: 'tgConfWait' });
    // Область «Свои» — только по своим контрагентам и отчётам, где он ответственный.
    const scoped = person('y', { confirmReports: 'own' });
    expect(linesOf(scoped, { reports: [waiting] })).toEqual([]);
    expect(
      linesOf(scoped, { reports: [report({ ...waiting, id: 'ry', responsibleId: 'y' })] }),
    ).toHaveLength(1);
    expect(
      linesOf(
        { ...scoped, employeeId: 'acc' },
        { reports: [report({ ...waiting, submittedById: 'z' })] },
      ),
    ).toHaveLength(1);
    // Без повтора — только в день, когда исполнилось N дней; без подтверждения в политике — никогда.
    const longer = report({ open: false, waitingSince: addDays(TODAY, -5), submittedById: 'acc' });
    expect(linesOf(chief, { reports: [longer] }, { overdueRepeat: false })).toEqual([]);
    expect(linesOf(chief, { reports: [waiting] }, { reportConfirm: false })).toEqual([]);
    // Переключатель «Регулярные задачи по отчётам» выключен — тоже нет.
    const off = { ...chief, settings: withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'regtasks', false) };
    expect(linesOf(off, { reports: [waiting] })).toEqual([]);
  });

  it('задачи: завтра срок и просрочена — исполнителю; ждёт подтверждения дольше рабочего дня — тем, кто подтверждает', () => {
    const soon = task();
    const late = task({ dueDate: addDays(TODAY, -2) });
    const waiting = task({ open: false, waitingSince: addDays(TODAY, -2) });
    const fresh = task({ open: false, waitingSince: addDays(TODAY, -1) });
    const tasks = [soon, late, waiting, fresh];
    expect(linesOf(acc, { tasks })).toEqual([
      { key: 'tgTaskSoon', items: [{ id: soon.id, label: soon.title }] },
      { key: 'tgTaskOver', items: [{ id: late.id, label: late.title }] },
    ]);
    expect(linesOf(chief, { tasks })).toEqual([
      { key: 'tgTaskWait', items: [{ id: waiting.id, label: waiting.title }] },
    ]);
    // Выходные не считаются: следующий рабочий день — через два дня.
    expect(linesOf(chief, { tasks: [waiting] }, { nextWorkingDay: (d) => addDays(d, 2) })).toEqual(
      [],
    );
    // «Задачи» выключены в политике или переключатель «Ручные задачи» снят — ничего.
    expect(linesOf(acc, { tasks }, { tasks: false })).toEqual([]);
    const off = { ...acc, settings: withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'tasks', false) };
    expect(linesOf(off, { tasks })).toEqual([]);
  });

  it('сводка в понедельник: сдать и оплатить на неделе и просрочено — по контрагентам', () => {
    const monday: IsoDate = '2026-11-02';
    const week = { from: monday, to: addDays(monday, 6) };
    const reports = [
      report({
        dueDate: addDays(monday, 2),
        contractorName: 'ОсОО «Б»',
        typeShort: 'НДС',
        remindDays: [],
      }),
      report({ dueDate: addDays(monday, 20), typeShort: 'ЕН', remindDays: [] }),
      report({
        act: 'pay',
        payDue: addDays(monday, 4),
        unpaid: true,
        contractorName: 'ОсОО «А»',
        typeShort: 'Патент',
        remindDays: [],
      }),
      report({
        dueDate: addDays(monday, -3),
        contractorName: 'ОсОО «А»',
        typeShort: 'Соцфонд',
        remindDays: [],
      }),
      report({ responsibleId: 'other', dueDate: addDays(monday, 1), remindDays: [] }),
    ];
    const lines = linesOf(acc, { reports }, { today: monday, week });
    const summary = lines.find((l) => l.key === 'tgWeek');
    expect(summary).toMatchObject({ sub: 1, pay: 1, over: 1 });
    const text = reminderText({ lines: [summary!] }, texts, 'https://x');
    expect(text).toBe(
      '🗓 Неделя 02.11–08.11: сдать 1, оплатить 1, просрочено 1.\n• ОсОО «А»: оплатить Патент 06.11; просрочено Соцфонд\n• ОсОО «Б»: сдать НДС 04.11\n\nОткрыть в Buhuchet.kg: https://x',
    );
    // Главный бухгалтер видит всю организацию; переключатель «Сводка» снят — сводки нет.
    expect(
      linesOf(chief, { reports }, { today: monday, week }).find((l) => l.key === 'tgWeek'),
    ).toMatchObject({ sub: 2 });
    const noWeek = { ...chief, settings: withNotifyKind(DEFAULT_NOTIFY_SETTINGS, 'week', false) };
    expect(keys(linesOf(noWeek, { reports }, { today: monday, week }))).not.toContain('tgWeek');
    // Не понедельник — сводки нет; на неделе ничего нет — тоже.
    expect(keys(linesOf(acc, { reports }, { today: monday }))).not.toContain('tgWeek');
    expect(linesOf(acc, { reports: [] }, { today: monday, week })).toEqual([]);
  });

  it('все части — в одном сообщении; длинный список — «и ещё N», текст не длиннее предела', () => {
    const many = Array.from({ length: REMINDER_LIST_MAX + 4 }, () => report());
    const lines = linesOf(acc, { reports: [...many, report({ dueDate: TODAY })] });
    expect(keys(lines)).toEqual(['tgToday', 'tgBefore']);
    const text = reminderText({ lines }, texts, 'https://x');
    expect(text).toContain('; и ещё 4');
    const huge = Array.from({ length: 400 }, (_, i) =>
      report({ label: `Очень длинное название отчёта номер ${i}` }),
    );
    const long = reminderText(
      {
        lines: [
          { key: 'tgBefore', days: 3, items: huge.map((r) => ({ id: r.id, label: r.label })) },
        ],
      },
      { ...texts, more: 'и ещё {n}' },
      'https://x',
    );
    expect(long.length).toBeLessThanOrEqual(REMINDER_TEXT_MAX);
  });
});
