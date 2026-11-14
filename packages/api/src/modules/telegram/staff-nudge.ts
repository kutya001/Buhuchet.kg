import { enqueueTelegram, loadReminderData, telegramChat, telegramFeatureOn } from '@buhuchet/db';
import {
  bishkekDate,
  BOT_TEXT_MAX,
  botMessageProblem,
  botPlainText,
  nudgeBotMessage,
  overdueOf,
  scopeOf,
  withOrganization,
  type TelegramTemplateKey,
} from '@buhuchet/domain';
import type { BotAction, BotPressResult } from './press';
import { reminderReports } from './reminders';
import { botReportRow, botSiteUrl, reportTableTexts } from './staff-view';

/*
 * «Напомнить» под сводкой недели (поток Т, задача Т3; пакет заказчика 13.11.2026, идея 8; прототип v100
 * modules/tg-tables.js — `tgAct('nudge')`, `tgNudgeMsg`): руководитель нажимает кнопку у сотрудника —
 * сотрудник получает сообщение со списком своего просроченного: несданные отчёты и неоплаченные налоги.
 *
 * Напомнить может тот, кто видит отчёты всех сотрудников: право «Просматривать отчёты» (ядро) и область
 * «Все» группы «Отчеты для сдачи» (здесь) — проверяются при каждом нажатии, кнопка сама ничего не
 * разрешает. Сотрудник — действующий, из той же организации (RLS) и не сам нажавший. Одному сотруднику —
 * одно напоминание в день, кто бы ни нажал: строка очереди с ключом «сотрудник + день» вставляется один
 * раз, повтор получает «уже получил напоминание сегодня». Данные кнопка не меняет, поэтому работает и
 * при выключенных «Действиях из Telegram»; в предел частоты нажатий входит (`limited`).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-6
export const nudgeAction: BotAction = {
  permission: 'repView',
  limited: true,
  run: (ctx) =>
    ctx.asUser(async (tx, access) => {
      const refused = async (
        key: TelegramTemplateKey,
        values: Record<string, string | number> = {},
      ): Promise<BotPressResult> => ({ reply: await ctx.text(key, values), alert: true });
      const self = ctx.user.employeeId;
      if (!access || !ctx.user.orgId || !self || !ctx.arg || ctx.arg === self) {
        return refused('tgActNoRight');
      }
      if (scopeOf(access.subject, 'reports') !== 'all') return refused('tgActNoRight');
      // «Напоминания в Telegram» организации выключили после сводки — кнопка устарела.
      if (!(await telegramFeatureOn(tx))) return refused('tgActStale');
      const today = bishkekDate(ctx.deps.clock.now());
      const data = await loadReminderData(tx, today);
      const target = data.employees.find((e) => e.employeeId === ctx.arg);
      if (!target) return refused('tgActNoRight');
      const tr = ctx.tr;
      const overdue = overdueOf(target.employeeId, reminderReports(data.reports, tr), {
        today,
        taxpay: data.features.taxpay === true,
      });
      if (!overdue.length) return refused('tgActStale');
      const values = { сотрудник: target.shortName, n: overdue.length };
      const chat = target.chatId === null ? null : await telegramChat(tx, target.userId);
      if (!chat) return refused('tgActNudgeNoTg', values);
      const rows = new Map(data.reports.map((r) => [r.id, r]));
      const by = data.employees.find((e) => e.employeeId === self)?.shortName ?? ctx.user.login;
      const message = nudgeBotMessage(
        withOrganization(
          await ctx.text('tgNudge', { кто: by, n: overdue.length }),
          data.orgName,
          chat.shared,
        ),
        overdue.map((o) => botReportRow(rows.get(o.report.id)!, null, o.pay, today, tr, true)),
        reportTableTexts(tr),
        {
          label: await ctx.text('tgBtnOpenReports'),
          url: botSiteUrl(ctx.deps, '/app/reports/all'),
        },
      );
      const text = botPlainText(message);
      // Не собралось — нажатие откатывается целиком: ключ «сотрудник + день» остаётся свободным.
      const problem =
        botMessageProblem(message) ??
        (text.length > BOT_TEXT_MAX ? 'текст длиннее предела Telegram' : null);
      if (problem) throw new Error(`Telegram: напоминание о просроченном — ${problem}`);
      const queued = await enqueueTelegram(
        tx,
        [
          {
            userId: target.userId,
            chatId: chat.chatId,
            kind: 'nudge',
            text,
            message,
            dedupeKey: `nudge:${target.userId}:${today}`,
          },
        ],
        ctx.deps.clock.now(),
      );
      if (!queued.length) return refused('tgActNudgeWait', values);
      return {
        done: tr('telegram.done.nudged'),
        reply: await ctx.text('tgActNudgeOk', values),
        queued,
      };
    }),
};
