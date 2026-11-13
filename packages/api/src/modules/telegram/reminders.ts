import {
  enqueueTelegram,
  feeDebtorList,
  loadReminderData,
  mainFeeRequisite,
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
  botDayWords,
  botDueText,
  botMessageProblem,
  botPlainText,
  confirmBotMessage,
  dailyReminders,
  FEE_WHATSAPP_TEMPLATE,
  feeCopyNote,
  feeReminder,
  feeWhatsAppText,
  fillTemplate,
  formatText,
  hasPermission,
  moreOnSiteMessage,
  morningTables,
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
  weekBotMessage,
  weekdayMondayFirst,
  withOrganization,
  type BotMessage,
  type IsoDate,
  type ReminderLine,
  type ReminderPerson,
  type ReminderReport,
  type ReminderTask,
  type ReminderTexts,
  type TelegramTemplateKey,
  type Translate,
  type WeekDebt,
} from '@buhuchet/domain';
import type { Job, JobContext } from '../../deps';
import { scopeSqlOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { sendOrgOutbox, type Pause } from './outbox';
import { botReportNames, botReportRow, botSiteUrl, reportTableTexts } from './staff-view';

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
 *
 * Таблицы (поток Т, задача Т3; прототип v100 modules/tg-tables.js): сообщение дня с отчётами — таблицами
 * по разделам «Просрочено», «Сегодня», «Через N дн.», «Оплата налогов» (простой текст — прежние строки);
 * по понедельникам владельцу и главному бухгалтеру — отдельное сообщение «Сводка недели» с таблицей по
 * сотрудникам, кнопками «Напомнить» и разделом «Долги за обслуживание» с кнопками «Скопировать
 * напоминание». Долги видит только тот, у кого есть право «Видеть плату за обслуживание», и только по
 * контрагентам своей области.
 */

/** Строки сообщения дня, которые уходят в таблицы; остальные остаются текстом над ними. */
const TABLE_LINES: readonly ReminderLine['key'][] = [
  'tgOver',
  'tgToday',
  'tgBefore',
  'tgPayOver',
  'tgPayToday',
  'tgPay',
];

/** Отчёты организации в виде, с которым работают правила напоминаний (`dailyReminders`, `overdueOf`). */
export function reminderReports(
  rows: Awaited<ReturnType<typeof loadReminderData>>['reports'],
  tr: Translate,
): ReminderReport[] {
  return rows.map((r) => ({
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
}

/** Значение считается один раз и только если понадобилось. */
function lazy<T>(make: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined;
  return () => (value ??= make());
}

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
  const reports = reminderReports(data.reports, tr);
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
  const tableTexts = reportTableTexts(tr);
  const names = new Map(data.employees.map((e) => [e.employeeId, e.shortName]));
  // Долги за обслуживание — по области получателя; у получателей с одной областью запрос один.
  const debtsByScope = new Map<string, Promise<WeekDebt[]>>();
  const requisite = lazy(() => mainFeeRequisite(tx, tr));
  const debtsOf = (e: (typeof data.employees)[number]): Promise<WeekDebt[]> => {
    if (data.features.fee !== true || !hasPermission(e.subject, 'fee')) return Promise.resolve([]);
    const scope = scopeSqlOf(e.subject);
    const key = scope ? e.employeeId : 'all';
    let debts = debtsByScope.get(key);
    if (!debts) {
      debts = (async () => {
        const [list, req] = await Promise.all([
          feeDebtorList(tx, { scope, today: day }),
          requisite(),
        ]);
        const template = templates.waFee ?? FEE_WHATSAPP_TEMPLATE;
        return list.map((c) => {
          const r = feeReminder(c.fees, c.feeDay, day);
          const note = (requisiteText: string | null, monthsText?: string) =>
            feeWhatsAppText(
              template,
              {
                contractor: c.name,
                months: r.months,
                ...(monthsText ? { monthsText } : {}),
                amount: r.amount,
                payBy: r.payBy,
                requisite: requisiteText,
              },
              (x) => tr('fee.wa.requisites', { req: x }),
            );
          return {
            name: c.name,
            debt: c.fees.debt,
            months: r.months.length,
            note: feeCopyNote([
              ...(req ? [note(req.text)] : []),
              note(null),
              note(null, tr('telegram.table.months_n', { n: r.months.length })),
            ]),
          };
        });
      })();
      debtsByScope.set(key, debts);
    }
    return debts;
  };
  const out: OutboxMessage[] = [];
  for (const m of messages) {
    const e = byEmployee.get(m.employeeId)!;
    const chat = await telegramChat(tx, e.userId);
    if (!chat) continue;
    const key = `reminders:${e.userId}:${day}`;
    // Сообщение дня: с отчётами — таблицами по разделам, простой текст — прежние строки; под таблицами
    // вместо ссылки в тексте — кнопка «Открыть отчёты на сайте» (если сайт по https). Не собралось —
    // прежним текстом.
    const morning = m.lines.length
      ? morningTables(
          m.lines,
          (item, pay) => botReportRow(rows.get(item.id)!, item, pay, day, tr),
          {
            over: tpl('tgSecOver'),
            today: tpl('tgSecToday'),
            before: (days) => tpl('tgSecBefore', { дней: days }),
            pay: tpl('tgSecPay'),
            sub: (n) =>
              tpl('tgMornSub', {
                просрочено: n.over,
                сегодня: n.today,
                скоро: n.soon,
                оплата: n.pay,
              }),
            ...tableTexts,
          },
        )
      : null;
    const weekUrl = botSiteUrl(site.deps, '/app/reports/week');
    const rest = m.lines.filter((l) => !TABLE_LINES.includes(l.key));
    const tables: BotMessage | null = morning && {
      heading: withOrganization(
        tpl('tgMornHead', { день: botDayWords(day, weekdayMondayFirst(day), tr) }),
        data.orgName,
        chat.shared,
      ),
      sub: morning.sub,
      ...(rest.length ? { text: reminderText({ lines: rest }, texts, null) } : {}),
      tables: morning.tables,
      plain: withOrganization(
        reminderText(m, texts, weekUrl ? null : link),
        data.orgName,
        chat.shared,
      ),
      ...(weekUrl ? { buttons: [[{ text: tpl('tgBtnOpenReports'), url: weekUrl }]] } : {}),
    };
    const tablesProblem = tables && botMessageProblem(tables);
    if (tablesProblem) {
      ctx.logger.warn(
        { job: 'telegram.reminders', problem: tablesProblem },
        'Telegram: сообщение дня без таблиц',
      );
    }
    if (tables && !tablesProblem) {
      out.push({
        userId: e.userId,
        chatId: chat.chatId,
        kind: 'reminders',
        text: botPlainText(tables),
        message: tables,
        dedupeKey: key,
      });
    } else if (m.lines.length) {
      out.push({
        userId: e.userId,
        chatId: chat.chatId,
        kind: 'reminders',
        text: withOrganization(reminderText(m, texts, link), data.orgName, chat.shared),
        dedupeKey: key,
      });
    }
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
    // ОТКЛОНЕНИЕ: docs/deviations.md#Т-5
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
        // «сдан ДД.ММ, кто»: «Дата сдачи» отчёта и сдавший, а если он неизвестен — ответственный
        // (прототип `tgConfMsg`: `r.subDate`, `r.subBy || r.resp`).
        const who = r.submittedById ?? r.responsibleId;
        const by = who ? byEmployee.get(who)?.shortName : undefined;
        const submitted = tr('telegram.item.submitted', {
          date: botDayMonth(r.submittedOn ?? r.waitingSince ?? day),
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

    // Понедельник: сводка недели владельцу и главному бухгалтеру — таблица по сотрудникам, «Напомнить»
    // (кнопка — только тому, кто видит отчёты всех сотрудников; право проверяется и при нажатии) и долги
    // за обслуживание.
    // ОТКЛОНЕНИЕ: docs/deviations.md#Т-6
    if (m.week) {
      const week = weekBotMessage(m.week, {
        self: e.employeeId,
        names,
        confirm: data.reportConfirm,
        canNudge: hasPermission(e.subject, 'repView') && scopeOf(e.subject, 'reports') === 'all',
        debts: await debtsOf(e),
        texts: {
          heading: withOrganization(
            tpl('tgWeekHead', {
              даты: `${botDayMonth(m.week.from)}–${botDayMonth(m.week.to)}`,
            }),
            data.orgName,
            chat.shared,
          ),
          sub: tpl('tgWeekSub', { n1: m.week.sub, n2: m.week.pay, n3: m.week.over }),
          employee: tr('telegram.table.employee'),
          toSubmit: tr('telegram.table.to_submit'),
          overdue: tr('telegram.table.overdue'),
          waiting: tr('telegram.table.waiting'),
          unassigned: tr('telegram.table.unassigned'),
          debtTitle: tpl('tgSecDebt'),
          contractor: tr('telegram.table.contractor'),
          debt: tr('telegram.table.debt'),
          months: tr('telegram.table.months'),
          total: tr('telegram.table.total'),
          totalOf: (n) => tr('telegram.table.total_of', { n }),
          nudge: (employee, n) => tpl('tgBtnNudge', { сотрудник: employee, n }),
          feeCopy: (contractor) => tpl('tgBtnFeeCopy', { контрагент: contractor }),
          more: tableTexts.more,
        },
      });
      if (week) push(week, 'week');
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
