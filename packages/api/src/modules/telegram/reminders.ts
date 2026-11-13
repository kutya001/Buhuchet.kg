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
  botDayMonth,
  botDueText,
  botMessageProblem,
  botPlainText,
  confirmBotMessage,
  dailyReminders,
  fillTemplate,
  formatText,
  hasPermission,
  moreOnSiteMessage,
  nextWorkingDay,
  OPEN_REPORT_STATUSES,
  periodFull,
  productionCalendar,
  reminderText,
  reportBotMessage,
  scopeOf,
  STAFF_BOT_BUTTONS_MAX,
  taskOpen,
  TELEGRAM_TEMPLATE_DEFAULTS,
  weekdayMondayFirst,
  withOrganization,
  type BotMessage,
  type IsoDate,
  type ReminderPerson,
  type ReminderReport,
  type ReminderTask,
  type ReminderTexts,
  type TelegramTemplateKey,
  type Translate,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';
import { serverTexts } from '../l10n/texts';
import { sendOrgOutbox, type Pause } from './outbox';
import { botReportNames, botSiteUrl } from './staff-view';

/*
 * Напоминания за день и сводка по понедельникам (ТЗ «Уведомления в Telegram»; задача 2.25,
 * docs/decisions.md, п. Б-5): каждую минуту задача спрашивает базу, каким организациям пора — время
 * сводки из «Моей организации» по их часовому поясу наступило, «Напоминания в Telegram» включены, есть
 * привязанный Telegram, а за этот день ещё не собрано. Для такой организации в одной транзакции —
 * отметка дня, данные, одно сообщение каждому, у кого есть что сказать (ключ «человек + день»), и сразу
 * отправка. Повторный запуск в тот же день ничего не добавляет.
 *
 * Следом за сообщением дня — сообщения с кнопками (поток Т, задача Т2; прототип v97 `tgStaffList`): по
 * одному на каждый свой несданный отчёт из напоминания, сначала самые срочные, не больше 10 («В работе»,
 * «Сдан», «Открыть»); тому, кто подтверждает сдачу, — по одному на каждую сдачу, которая ждёт дольше
 * заданного («Подтвердить», «Вернуть», «Открыть»). Остальные — на сайте. Кнопки ничего не разрешают
 * сами: право, область и статус проверяются при нажатии.
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
    viewReports: hasPermission(e.subject, 'repView') ? scopeOf(e.subject, 'reports') : null,
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
    // Как в прототипе (главная, «Оплатить на неделе»): только отчёты с суммой к уплате больше нуля.
    unpaid: r.amount !== null && r.amount > r.paid,
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
  const rows = new Map(data.reports.map((r) => [r.id, r]));
  const site = { deps: { config: { APP_BASE_URL: baseUrl } } };
  const tpl = (key: TelegramTemplateKey, values: Record<string, string | number> = {}) =>
    fillTemplate(templates[key] ?? TELEGRAM_TEMPLATE_DEFAULTS[key], values);
  const dueTexts = {
    due: (date: string) => tr('telegram.item.due', { date }),
    over: (n: number) => tr('telegram.item.due_over', { n }),
    today: tr('telegram.item.due_today'),
    ahead: (n: number) => tr('telegram.item.due_in', { n }),
  };
  const reportUrl = (id: string) => botSiteUrl(site.deps, `/app/reports/all?report=${id}`);
  const out: OutboxMessage[] = [];
  for (const m of messages) {
    const e = byEmployee.get(m.employeeId)!;
    const chat = await telegramChat(tx, e.userId);
    if (!chat) continue;
    const key = `reminders:${e.userId}:${day}`;
    out.push({
      userId: e.userId,
      chatId: chat.chatId,
      kind: 'reminders',
      text: withOrganization(reminderText(m, texts, link), data.orgName, chat.shared),
      dedupeKey: key,
    });
    const push = (message: BotMessage, suffix: string) => {
      // Подпись кнопки в шаблоне длиннее предела — сообщение дня остаётся, это сообщение не уходит.
      const problem = botMessageProblem(message);
      if (problem) {
        ctx.logger.warn({ job: 'telegram.reminders', problem }, 'Telegram: сообщение с кнопками');
        return;
      }
      out.push({
        userId: e.userId,
        chatId: chat.chatId,
        kind: 'reminders',
        text: botPlainText(message),
        message,
        dedupeKey: `${key}:${suffix}`,
      });
    };
    const more = (shown: number, total: number, tab: 'all' | 'waiting', suffix: string) => {
      if (total <= shown) return;
      push(
        moreOnSiteMessage(
          tpl('tgMoreOnSite', { n: shown, ещё: total - shown }),
          tpl('tgBtnOpenReports'),
          botSiteUrl(site.deps, `/app/reports/${tab}`),
        ),
        suffix,
      );
    };
    const itemsOf = (keys: readonly string[]) =>
      m.lines.flatMap((l) => (keys.includes(l.key) && 'items' in l ? l.items : []));

    // Свои несданные отчёты напоминания: кнопки — только с правом «Менять статус отчётов».
    if (hasPermission(e.subject, 'changeStatus')) {
      const own = itemsOf(['tgOver', 'tgToday', 'tgBefore'])
        .map((i) => rows.get(i.id)!)
        .filter((r) => r.responsibleId === e.employeeId)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
      for (const r of own.slice(0, STAFF_BOT_BUTTONS_MAX)) {
        push(
          reportBotMessage(
            {
              id: r.id,
              name: botReportNames(r, tr).name,
              contractor: r.contractorName,
              todo: r.status === 'todo',
            },
            botDueText(r.dueDate, day, dueTexts),
            { work: tpl('tgBtnWork'), done: tpl('tgBtnDone'), open: tpl('tgBtnOpen') },
            reportUrl(r.id),
          ),
          `r:${r.id}`,
        );
      }
      more(STAFF_BOT_BUTTONS_MAX, own.length, 'all', 'more');
    }

    // Сдачи, которые ждут подтверждения дольше заданного (строка «Ждут подтверждения» того же дня).
    const waiting = itemsOf(['tgConfWait'])
      .map((i) => rows.get(i.id)!)
      .sort(
        (a, b) =>
          (a.waitingSince ?? '').localeCompare(b.waitingSince ?? '') || a.id.localeCompare(b.id),
      );
    if (waiting.length) {
      push({ text: tpl('tgConfHead', { n: waiting.length }) }, 'conf');
      for (const r of waiting.slice(0, STAFF_BOT_BUTTONS_MAX)) {
        const by = r.submittedById ? byEmployee.get(r.submittedById)?.shortName : undefined;
        const submitted = tr('telegram.item.submitted', {
          date: botDayMonth(r.waitingSince ?? day),
        });
        push(
          confirmBotMessage(
            { id: r.id, name: botReportNames(r, tr).name, contractor: r.contractorName },
            by ? `${submitted}, ${by}` : submitted,
            { ok: tpl('tgBtnConfOk'), back: tpl('tgBtnConfBack'), open: tpl('tgBtnOpen') },
            reportUrl(r.id),
          ),
          `c:${r.id}`,
        );
      }
      more(STAFF_BOT_BUTTONS_MAX, waiting.length, 'waiting', 'cmore');
    }
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
            return (await enqueueTelegram(tx, messages, ctx.clock.now())).length;
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
