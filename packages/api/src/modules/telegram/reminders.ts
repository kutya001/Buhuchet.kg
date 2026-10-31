import {
  enqueueTelegram,
  loadReminderData,
  markDigestDay,
  messageTemplates,
  productionCalendarEntries,
  telegramChat,
  telegramDigestOrgs,
  withOrgContext,
  type OutboxMessage,
  type Tx,
} from '@buhuchet/db';
import {
  addDays,
  dailyReminders,
  formatText,
  hasPermission,
  nextWorkingDay,
  OPEN_REPORT_STATUSES,
  periodFull,
  productionCalendar,
  reminderText,
  scopeOf,
  taskOpen,
  TELEGRAM_TEMPLATE_DEFAULTS,
  weekdayMondayFirst,
  withOrganization,
  type IsoDate,
  type ReminderPerson,
  type ReminderReport,
  type ReminderTask,
  type ReminderTexts,
  type Translate,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { sendOrgOutbox, type Pause } from './outbox';

/*
 * Напоминания за день и сводка по понедельникам (ТЗ «Уведомления в Telegram»; задача 2.25,
 * docs/decisions.md, п. Б-5): каждую минуту задача спрашивает базу, каким организациям пора — время
 * сводки из «Моей организации» по их часовому поясу наступило, «Напоминания в Telegram» включены, есть
 * привязанный Telegram, а за этот день ещё не собрано. Для такой организации в одной транзакции —
 * отметка дня, данные, одно сообщение каждому, у кого есть что сказать (ключ «человек + день»), и сразу
 * отправка. Повторный запуск в тот же день ничего не добавляет.
 */

/** Сообщения за день организации из контекста; `link` — адрес сайта для ссылки на список отчётов. */
export async function buildDailyReminders(
  ctx: JobContext,
  tx: Tx,
  day: IsoDate,
  baseUrl: string,
): Promise<OutboxMessage[]> {
  const [data, entries, t, templates] = await Promise.all([
    loadReminderData(tx, day),
    productionCalendarEntries(tx),
    serverTexts(ctx),
    messageTemplates(ctx.db),
  ]);
  const calendar = productionCalendar(entries);
  const tr: Translate = (key, params) => formatText(t(key), params);
  const people: ReminderPerson[] = data.employees.map((e) => ({
    employeeId: e.employeeId,
    shortName: e.shortName,
    boss: e.subject.isOwner || e.chief,
    isOwner: e.subject.isOwner,
    linked: e.chatId !== null,
    settings: e.settings,
    confirmReports: hasPermission(e.subject, 'repConfirm') ? scopeOf(e.subject, 'reports') : null,
    confirmTasks: hasPermission(e.subject, 'tasksConfirm'),
  }));
  const reports: ReminderReport[] = data.reports.map((r) => ({
    id: r.id,
    label: tr('telegram.item.report', {
      type: r.typeShort,
      period: periodFull({ period: r.period, start: r.periodStart }, tr),
      contractor: r.contractorName,
    }),
    typeShort: r.typeShort,
    contractorName: r.contractorName,
    contractorResponsibleId: r.contractorResponsibleId,
    act: r.act,
    dueDate: r.dueDate,
    payDue: r.payDue,
    open: OPEN_REPORT_STATUSES.has(r.status),
    unpaid: r.amount === null || r.amount > r.paid,
    responsibleId: r.responsibleId,
    remindDays: r.remindDays,
    waitingSince: r.waitingSince,
    submittedById: r.submittedById,
    paused: false,
  }));
  const tasks: ReminderTask[] = data.tasks.map((x) => ({
    id: x.id,
    title: x.title,
    executorId: x.executorId,
    authorId: x.authorId,
    dueDate: x.dueDate,
    open: taskOpen(x.status),
    waitingSince: x.status === 'on_confirm' ? x.doneOn : null,
  }));
  const messages = dailyReminders(
    people,
    { reports, tasks },
    {
      today: day,
      overdueRepeat: data.overdueRepeat,
      reportConfirm: data.reportConfirm,
      confirmWaitDays: data.confirmWaitDays,
      taxpay: data.features.taxpay === true,
      tasks: data.features.tasks === true,
      week: weekdayMondayFirst(day) === 0 ? { from: day, to: addDays(day, 6) } : null,
      nextWorkingDay: (d) => nextWorkingDay(calendar, d),
    },
  );
  const texts: ReminderTexts = {
    template: (key) => templates[key] ?? TELEGRAM_TEMPLATE_DEFAULTS[key],
    more: t('telegram.more'),
    unlinked: t('telegram.unlinked'),
    unassigned: t('telegram.unassigned'),
    weekContractor: t('telegram.week.contractor'),
    weekSub: t('telegram.week.sub'),
    weekPay: t('telegram.week.pay'),
    weekOver: t('telegram.week.over'),
    open: t('telegram.open'),
  };
  const link = new URL('/app/reports/week', baseUrl).href;
  const byEmployee = new Map(data.employees.map((e) => [e.employeeId, e]));
  const out: OutboxMessage[] = [];
  for (const m of messages) {
    const e = byEmployee.get(m.employeeId)!;
    const chat = await telegramChat(tx, e.userId);
    if (!chat) continue;
    out.push({
      userId: e.userId,
      chatId: chat.chatId,
      kind: 'reminders',
      text: withOrganization(reminderText(m, texts, link), data.orgName, chat.shared),
      dedupeKey: `reminders:${e.userId}:${day}`,
    });
  }
  return out;
}

/** Напоминания за день — задача расписания (каждую минуту; собирает только тем, кому пора). */
export function telegramRemindersJob(baseUrl: string, pause?: Pause): Job {
  return {
    name: 'telegram.reminders',
    cron: '* * * * *',
    lookbackMinutes: 1,
    async run(ctx) {
      if (!ctx.telegram) return;
      const failed: string[] = [];
      let queued = 0;
      for (const { orgId, day } of await telegramDigestOrgs(ctx.db, ctx.clock.now())) {
        try {
          const n = await withOrgContext(ctx.db, { orgId, kind: 'job' }, async (tx) => {
            if (!(await markDigestDay(tx, day))) return 0;
            const messages = await buildDailyReminders(ctx, tx, day as IsoDate, baseUrl);
            return (await enqueueTelegram(tx, messages)).length;
          });
          queued += n;
          if (n) await sendOrgOutbox(ctx, orgId, pause ? { pause } : {});
        } catch (err) {
          failed.push(orgId);
          ctx.logger.error(
            { job: 'telegram.reminders', orgId, err },
            'напоминания организации не собраны',
          );
        }
      }
      if (queued) ctx.logger.info({ job: 'telegram.reminders', queued }, 'напоминания за день');
      if (failed.length) {
        throw new Error(`telegram.reminders: не собраны напоминания организаций: ${failed.length}`);
      }
    },
  };
}
