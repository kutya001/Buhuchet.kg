import {
  commandCardReports,
  commandContractor,
  commandReports,
  feeSubject,
  findCommandContractors,
  messageTemplates,
  orgMenuSettings,
  type CommandReportRow,
  type Db,
  type Tx,
} from '@buhuchet/db';
import {
  BOT_COMMAND_DESCRIPTION_MAX,
  BOT_COMMANDS,
  BOT_FIND_MAX,
  BOT_FIND_MIN,
  botClip,
  botFindByInn,
  botFindQuery,
  botTemplate,
  commandHorizon,
  contractorBotMessage,
  contractorFees,
  feeReminder,
  fillTemplate,
  findListBotMessage,
  formatDateRu,
  formatSom,
  hasPermission,
  monthLabelGen,
  monthOf,
  OPEN_REPORT_STATUSES,
  overdueBotMessage,
  paymentStatus,
  todayBotMessage,
  weekDaysBotMessage,
  withOrganization,
  type AccessSubject,
  type BotCommand,
  type BotCommandCode,
  type BotMessage,
  type CommandReport,
  type CommandTexts,
  type IsoDate,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import type { ApiDeps } from '../../deps';
import { scopeSqlOf } from '../contractors/common';
import { reportScopeOf } from '../reports/common';
import { botReportRow, botSiteUrl } from './staff-view';

/*
 * Ответы на команды меню бота (поток Т, задача Т5; прототип v102 modules/tg-menu.js): что сотрудник видит
 * в «Сегодня», «Неделя», «Просрочено» и в карточке контрагента. Всё читается в транзакции сотрудника в
 * его организации (RLS) и в его области: отчёты — область группы «Отчеты для сдачи» (`reportScopeOf`,
 * как список отчётов сайта), контрагенты — область группы «Контрагенты» (`scopeSqlOf`); архивные
 * контрагенты не показываются. Права проверяет вызывающий: команда — своё право (`BOT_COMMANDS`),
 * карточка — «Просматривать контрагентов»; здесь — только то, что внутри карточки: отчёты видит тот, у
 * кого есть право на отчёты, долг за обслуживание — у кого есть право и включена функция.
 * Отдельно от обработчиков (`commands.ts`, `command-actions.ts`), чтобы они брали отсюда только вид.
 */

/** Кто спрашивает: права и область сотрудника, его организация. */
export interface CommandAsker {
  subject: AccessSubject;
  orgId: string;
}

/** Тексты ответов: шаблоны бота (уже прочитанные) и словарь. */
export function commandTexts(
  templates: Readonly<Record<string, string>>,
  tr: Translate,
): CommandTexts {
  return {
    tpl: (key, values = {}) => fillTemplate(botTemplate(key, templates[key]), values),
    columns: {
      contractor: tr('telegram.table.contractor'),
      report: tr('telegram.table.report'),
      status: tr('telegram.table.status'),
      payment: tr('telegram.table.payment'),
      due: tr('telegram.table.due'),
      day: tr('telegram.table.day'),
      toSubmit: tr('telegram.table.to_submit'),
      toPay: tr('telegram.table.to_pay'),
    },
    more: (n) => tr('telegram.table.more', { n }),
    payMark: (report) => tr('telegram.table.pay_mark', { report }),
    dayWords: (day) => `${Number(day.slice(8, 10))} ${monthLabelGen(monthOf(day)).split(' ')[0]!}`,
    weekdayShort: (n) => tr(`report.cal.dow.${n + 1}` as UiTextKey),
    counted: (head, n) => tr('telegram.cmd.counted', { head, n }),
  };
}

/** Подпись команды из действующих шаблонов: «Сегодня». */
export const commandLabel = (templates: Readonly<Record<string, string>>, c: BotCommand): string =>
  botTemplate(c.template, templates[c.template]);

/** Кнопки меню под полем ввода: подписи команд, по две в ряд. */
export function botMenuRows(templates: Readonly<Record<string, string>>): string[][] {
  const labels = BOT_COMMANDS.map((c) => commandLabel(templates, c));
  // По две кнопки в ряд; пятая команда («Мои на неделю», задача Т9) — отдельным рядом.
  const rows: string[][] = [];
  for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2));
  return rows;
}

/** Команды меню бота для Telegram (`setCommands`): «/today — Сегодня». */
export async function botMenuCommands(db: Db): Promise<{ command: string; description: string }[]> {
  const templates = await messageTemplates(db);
  // Описание команды в меню Telegram — не длиннее предела: одна длинная подпись шаблона иначе ломала бы
  // всё меню.
  return BOT_COMMANDS.map((c) => ({
    command: c.slash,
    description: botClip(commandLabel(templates, c), BOT_COMMAND_DESCRIPTION_MAX),
  }));
}

/**
 * Чат привязан к нескольким учётным записям — организация первой строкой сообщения (как в остальных
 * сообщениях бота): у сообщения с заголовком — в заголовке, иначе — в тексте.
 */
export function commandMessageFor(
  message: BotMessage,
  orgName: string | null,
  shared: boolean,
): BotMessage {
  if (!shared || !orgName) return message;
  return message.heading !== undefined
    ? { ...message, heading: withOrganization(message.heading, orgName, true) }
    : { ...message, text: withOrganization(message.text ?? '', orgName, true) };
}

/** Ячейка «Отчёт»: «НДС, окт.» (как в таблицах напоминаний). */
export const reportCell = (r: CommandReportRow, today: IsoDate, tr: Translate): string =>
  botReportRow(r, null, false, today, tr).report;

/** Отчёт в виде правил ответа: открытый срок сдачи и открытый срок оплаты — как в напоминаниях. */
function commandReport(
  r: CommandReportRow,
  o: { today: IsoDate; taxpay: boolean; tr: Translate },
): CommandReport {
  return {
    id: r.id,
    contractor: r.contractorName,
    report: reportCell(r, o.today, o.tr),
    status: o.tr(`status.report.${r.status}` as UiTextKey),
    payStatus: o.tr(
      `status.payment.${paymentStatus({ act: r.act, status: r.status, sum: r.amount, paid: r.paid })}` as UiTextKey,
    ),
    subDue: OPEN_REPORT_STATUSES.has(r.status) && r.act !== 'pay' ? r.dueDate : null,
    // Оплата налогов — только при включённом «Учёте оплаты налогов» и сумме к уплате больше нуля.
    payDue:
      o.taxpay && r.act !== 'sub' && r.payDue && r.amount !== null && r.amount > r.paid
        ? r.payDue
        : null,
  };
}

/** Ответ на «Сегодня», «Неделя» или «Просрочено» — отчёты в области сотрудника. */
export async function reportsCommandMessage(
  deps: ApiDeps,
  tx: Tx,
  asker: CommandAsker,
  code: Exclude<BotCommandCode, 'find' | 'widget'>,
  o: { today: IsoDate; t: CommandTexts; tr: Translate },
): Promise<BotMessage> {
  const [{ features }, rows] = await Promise.all([
    orgMenuSettings(tx, asker.orgId),
    commandReports(tx, {
      scope: reportScopeOf(asker.subject),
      horizon: commandHorizon(o.today),
    }),
  ]);
  const reports = rows.map((r) =>
    commandReport(r, { today: o.today, taxpay: features.taxpay, tr: o.tr }),
  );
  if (code === 'today') {
    return todayBotMessage(reports, o.today, o.t, botSiteUrl(deps, '/app/reports/week'));
  }
  if (code === 'week') {
    return weekDaysBotMessage(reports, o.today, o.t, botSiteUrl(deps, '/app/reports/week'));
  }
  return overdueBotMessage(reports, o.today, o.t, botSiteUrl(deps, '/app/reports/all'));
}

/**
 * Карточка контрагента одним сообщением; null — контрагента нет, он в архиве или вне области сотрудника
 * (в том числе чужой организации — RLS).
 */
export async function contractorCardMessage(
  deps: ApiDeps,
  tx: Tx,
  asker: CommandAsker,
  contractorId: string,
  o: { today: IsoDate; t: CommandTexts; tr: Translate },
): Promise<BotMessage | null> {
  const scope = scopeSqlOf(asker.subject);
  const c = await commandContractor(tx, contractorId, scope);
  if (!c) return null;
  const { tr, t } = o;
  const sub = t.tpl('tgCardSub', {
    ответственный: c.responsibleName ?? tr('telegram.card.nobody'),
    дата: formatDateRu(c.startDate),
  });
  // Долг за обслуживание — у кого есть право и включена функция; у разового обслуживания его нет.
  let debt: string | null = null;
  if (!c.oneOff && hasPermission(asker.subject, 'fee')) {
    const { features } = await orgMenuSettings(tx, asker.orgId);
    const found = features.fee ? await feeSubject(tx, c.id, scope) : null;
    if (found) {
      const fees = contractorFees(found.subject, found.payments, o.today);
      const months = feeReminder(fees, found.subject.feeDay, o.today).months.length;
      debt = t.tpl('tgCardDebt', {
        долг:
          fees.debt > 0
            ? tr('telegram.card.debt', { sum: formatSom(fees.debt), n: months })
            : tr('telegram.card.no_debt'),
      });
    }
  }
  // Отчёты — у кого есть право на отчёты, в области отчётов сотрудника.
  const reports = hasPermission(asker.subject, 'repView')
    ? (
        await commandCardReports(tx, {
          contractorId: c.id,
          scope: reportScopeOf(asker.subject),
          today: o.today,
        })
      ).map((r) => ({
        id: r.id,
        report: reportCell(r, o.today, tr),
        due: r.dueDate,
        status: tr(`status.report.${r.status}` as UiTextKey),
      }))
    : null;
  return contractorBotMessage(
    { name: c.name, sub: c.paused ? tr('telegram.card.paused', { sub }) : sub, debt, reports },
    t,
    botSiteUrl(deps, `/app/cps/all?contractor=${c.id}`),
  );
}

/**
 * Ответ на просьбу «напишите название или ИНН» (прототип `tgAct('cpFind').reply`): запрос короткий или
 * никто не найден — `again` (бот ждёт другой ответ); найден один — его карточка; несколько — кнопки с
 * названиями (до `BOT_FIND_MAX`).
 */
export async function findContractorAnswer(
  deps: ApiDeps,
  tx: Tx,
  asker: CommandAsker,
  text: string,
  o: { today: IsoDate; t: CommandTexts; tr: Translate },
): Promise<{ again: string } | { message: BotMessage }> {
  const query = botFindQuery(text);
  if (query.length < BOT_FIND_MIN) return { again: o.t.tpl('tgFindShort', { n: BOT_FIND_MIN }) };
  const found = await findCommandContractors(tx, {
    scope: scopeSqlOf(asker.subject),
    query,
    byInn: botFindByInn(query),
    limit: BOT_FIND_MAX,
  });
  if (!found.total) return { again: o.t.tpl('tgFindNone') };
  if (found.total === 1) {
    const card = await contractorCardMessage(deps, tx, asker, found.rows[0]!.id, o);
    // Контрагент ушёл из области между запросами — как «не найден».
    return card ? { message: card } : { again: o.t.tpl('tgFindNone') };
  }
  return { message: findListBotMessage(found.rows, found.total, o.t) };
}
