import { weekdayMondayFirst, type IsoDate } from '../common/dates';
import type { PermissionId } from '../roles/permissions';
import { reportWeek } from '../reports/rules';
import {
  BOT_BUTTON_TEXT_MAX,
  BOT_TABLE_NAME_MAX,
  botClip,
  type BotButton,
  type BotMessage,
  type BotTable,
} from './bot-message';
import type { TelegramTemplateKey } from './messages';
import { botDayMonth } from './staff-bot';
import { botTableRows } from './tables';

/*
 * Ответы по запросу: меню команд бота (поток Т, задача Т5; пакет заказчика 13.11.2026, идея 4; прототип
 * v102 modules/tg-menu.js). Команды «Сегодня», «Неделя», «Просрочено», «Найти контрагента» бот понимает
 * и как команду меню Telegram (/today, /week, /overdue, /find), и как текст кнопки под полем ввода.
 * Команды ничего не меняют. Здесь — разбор команды и вид ответов; данные (отчёты в области сотрудника,
 * контрагенты, долг) собирает сервер.
 */

/** Команда меню: код, шаблон подписи, команда меню Telegram, право (прототип `TG_CMDS`). */
export const BOT_COMMANDS = [
  { code: 'today', template: 'tgCmdToday', slash: 'today', permission: 'repView' },
  { code: 'week', template: 'tgCmdWeek', slash: 'week', permission: 'repView' },
  { code: 'over', template: 'tgCmdOver', slash: 'overdue', permission: 'repView' },
  { code: 'find', template: 'tgCmdFind', slash: 'find', permission: 'cpView' },
  // Виджет «Мои отчёты на неделю» (задача Т9, `./widget`; прототип v106 `TG_CMDS`).
  { code: 'widget', template: 'tgCmdWidget', slash: 'myweek', permission: 'repView' },
] as const satisfies readonly {
  code: string;
  template: TelegramTemplateKey;
  slash: string;
  permission: PermissionId;
}[];

export type BotCommand = (typeof BOT_COMMANDS)[number];
export type BotCommandCode = BotCommand['code'];

/** Действия кнопок и просьбы поиска контрагента (прототип `tgAct('cpFind')`, `tgAct('cpCard')`). */
export const BOT_FIND_ACTION = 'cpFind';
export const BOT_CARD_ACTION = 'cpCard';

/** Предел Telegram для описания команды в меню бота (`setMyCommands`). */
export const BOT_COMMAND_DESCRIPTION_MAX = 256;

/** Поиск контрагента: кнопок с названиями, знаков в запросе — от и до (прототип `TG_FIND_*`). */
export const BOT_FIND_MAX = 5;
export const BOT_FIND_MIN = 2;
export const BOT_FIND_QUERY_MAX = 60;

/**
 * Команда из текста сообщения: «/today», «/today@имя_бота» или подпись кнопки меню («Сегодня») —
 * подписи приходят из действующих шаблонов. Регистр команды и подписи не важен.
 */
export function parseBotCommand(
  text: string,
  labels: Readonly<Record<BotCommandCode, string>>,
): BotCommand | null {
  const said = text.trim();
  const slash = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?$/i.exec(said)?.[1]?.toLowerCase();
  const lower = said.toLowerCase();
  return (
    BOT_COMMANDS.find((c) =>
      slash ? c.slash === slash : labels[c.code].trim().toLowerCase() === lower,
    ) ?? null
  );
}

/** Запрос поиска: без регистра, «ё» как «е», пробелы подряд — один, не длиннее предела (`tgFindNorm`). */
export function botFindQuery(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BOT_FIND_QUERY_MAX);
}

/** Ищут ли по ИНН: запрос только из цифр — ещё и по началу ИНН. */
export const botFindByInn = (query: string): boolean => /^\d+$/.test(query);

/** Отчёт в ответе на команду: ячейки готовыми строками и открытые сроки. */
export interface CommandReport {
  id: string;
  contractor: string;
  /** Ячейка «Отчёт»: «НДС, окт.». */
  report: string;
  /** Статус сдачи словами. */
  status: string;
  /** Статус оплаты словами. */
  payStatus: string;
  /** Срок сдачи, пока отчёт не сдан (у «Уплаты» — нет). */
  subDue: IsoDate | null;
  /** Срок оплаты, пока налог не оплачен. */
  payDue: IsoDate | null;
}

/** Тексты ответов: шаблоны бота с подстановками и столбцы таблиц из словаря. */
export interface CommandTexts {
  /** Шаблон бота с подстановками. */
  tpl(key: TelegramTemplateKey, values?: Readonly<Record<string, string | number>>): string;
  columns: {
    contractor: string;
    report: string;
    status: string;
    payment: string;
    due: string;
    day: string;
    toSubmit: string;
    toPay: string;
  };
  more(n: number): string;
  /** «{report} — оплата» в списке просроченного. */
  payMark(report: string): string;
  /** «13 ноября». */
  dayWords(day: IsoDate): string;
  /** «Пн» … «Вс» по номеру дня недели с понедельника (0–6). */
  weekdayShort(mondayFirst: number): string;
  /** «Просрочено · 7». */
  counted(head: string, n: number): string;
}

const byContractor = (a: CommandReport, b: CommandReport) =>
  a.contractor.localeCompare(b.contractor, 'ru') || a.id.localeCompare(b.id);
const name = (r: CommandReport) => botClip(r.contractor, BOT_TABLE_NAME_MAX);
const siteButton = (text: string, url: string | null): Pick<BotMessage, 'buttons'> =>
  url ? { buttons: [[{ text, url }]] } : {};

/**
 * «Сегодня» (прототип `tgTodayMsg`): несданные отчёты со сроком сегодня и налоги, которые сегодня нужно
 * оплатить; ничего нет — одной строкой.
 */
export function todayBotMessage(
  reports: readonly CommandReport[],
  today: IsoDate,
  t: CommandTexts,
  url: string | null,
): BotMessage {
  const sub = reports.filter((r) => r.subDue === today).sort(byContractor);
  const pay = reports.filter((r) => r.payDue === today).sort(byContractor);
  const day = t.dayWords(today);
  if (!sub.length && !pay.length) return { text: t.tpl('tgTodayNone', { день: day }) };
  const tables: BotTable[] = [];
  if (sub.length) {
    tables.push({
      head: [t.columns.contractor, t.columns.report, t.columns.status],
      ...botTableRows(sub, (r) => [name(r), r.report, r.status], t.more),
    });
  }
  if (pay.length) {
    tables.push({
      title: t.tpl('tgSecPay'),
      ...(sub.length ? {} : { open: true }),
      head: [t.columns.contractor, t.columns.report, t.columns.payment],
      ...botTableRows(pay, (r) => [name(r), r.report, r.payStatus], t.more),
    });
  }
  return {
    heading: t.tpl('tgTodayHead', { день: day }),
    sub: t.tpl('tgTodaySub', { сдать: sub.length, оплатить: pay.length }),
    tables,
    ...siteButton(t.tpl('tgBtnOpenReports'), url),
  };
}

/**
 * «Неделя» (прототип `tgWeekDaysMsg`): дни с сегодняшнего до конца недели, в которые есть что сдать или
 * оплатить; в строке итогов — и просроченное. В выходные неделя — следующая, как во вкладке «На неделе».
 */
export function weekDaysBotMessage(
  reports: readonly CommandReport[],
  today: IsoDate,
  t: CommandTexts,
  url: string | null,
): BotMessage {
  const { from, to } = reportWeek(today);
  const days = new Map<IsoDate, { sub: number; pay: number }>();
  const day = (d: IsoDate) => {
    let x = days.get(d);
    if (!x) days.set(d, (x = { sub: 0, pay: 0 }));
    return x;
  };
  let n1 = 0;
  let n2 = 0;
  let n3 = 0;
  for (const r of reports) {
    if (r.subDue) {
      if (r.subDue < today) n3 += 1;
      else if (r.subDue <= to) {
        day(r.subDue).sub += 1;
        n1 += 1;
      }
    }
    if (r.payDue) {
      if (r.payDue < today) n3 += 1;
      else if (r.payDue <= to) {
        day(r.payDue).pay += 1;
        n2 += 1;
      }
    }
  }
  const values = { даты: `${botDayMonth(from)}–${botDayMonth(to)}` };
  const list = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!list.length && !n3) return { text: t.tpl('tgWeekNone', values) };
  return {
    heading: t.tpl('tgWeekHead', values),
    sub: t.tpl('tgWeekSub', { n1, n2, n3 }),
    tables: list.length
      ? [
          {
            head: [t.columns.day, t.columns.toSubmit, t.columns.toPay],
            numeric: [1, 2],
            rows: list.map(([d, x]) => [
              `${t.weekdayShort(weekdayMondayFirst(d))}, ${botDayMonth(d)}`,
              String(x.sub),
              String(x.pay),
            ]),
          },
        ]
      : [],
    ...siteButton(t.tpl('tgBtnOpenReports'), url),
  };
}

/**
 * «Просрочено» (прототип `tgOverMsg`): несданные отчёты и неоплаченные налоги с прошедшим сроком, сначала
 * самые старые; строка оплаты — с пометкой «— оплата».
 */
export function overdueBotMessage(
  reports: readonly CommandReport[],
  today: IsoDate,
  t: CommandTexts,
  url: string | null,
): BotMessage {
  const list: { r: CommandReport; due: IsoDate; pay: boolean }[] = [];
  for (const r of reports) {
    if (r.subDue && r.subDue < today) list.push({ r, due: r.subDue, pay: false });
    if (r.payDue && r.payDue < today) list.push({ r, due: r.payDue, pay: true });
  }
  list.sort((a, b) => a.due.localeCompare(b.due) || a.r.id.localeCompare(b.r.id));
  if (!list.length) return { text: t.tpl('tgOverNone') };
  return {
    heading: t.counted(t.tpl('tgSecOver'), list.length),
    tables: [
      {
        head: [t.columns.contractor, t.columns.report, t.columns.due],
        numeric: [2],
        ...botTableRows(
          list,
          (x) => [name(x.r), x.pay ? t.payMark(x.r.report) : x.r.report, botDayMonth(x.due)],
          t.more,
        ),
      },
    ],
    ...siteButton(t.tpl('tgBtnOpenReports'), url),
  };
}

/** Отчёт в карточке контрагента: ячейка, срок и статус словами. */
export interface CardReport {
  id: string;
  report: string;
  due: IsoDate;
  status: string;
}

/** Карточка контрагента одним сообщением (прототип `tgCpMsg`). */
export interface CommandCard {
  name: string;
  /** «Ответственный: … · обслуживается с …» целиком (с пометкой о приостановке). */
  sub: string;
  /** Строка «Долг за обслуживание: …»; null — долг получателю не показывается. */
  debt: string | null;
  /** Просроченные отчёты и отчёты со сроком в этом месяце; null — нет права на отчёты. */
  reports: readonly CardReport[] | null;
}

export function contractorBotMessage(
  card: CommandCard,
  t: CommandTexts,
  url: string | null,
): BotMessage {
  const reports = card.reports
    ? [...card.reports].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
    : null;
  const text = [card.debt ?? '', reports && !reports.length ? t.tpl('tgCardNoReports') : '']
    .filter(Boolean)
    .join('\n');
  return {
    heading: card.name,
    sub: card.sub,
    ...(text ? { text } : {}),
    tables: reports?.length
      ? [
          {
            head: [t.columns.report, t.columns.due, t.columns.status],
            numeric: [1],
            ...botTableRows(reports, (r) => [r.report, botDayMonth(r.due), r.status], t.more),
          },
        ]
      : [],
    ...siteButton(t.tpl('tgBtnOpenCp'), url),
  };
}

/** Несколько найденных контрагентов: кнопки с названиями, не больше `BOT_FIND_MAX` (`tgFindMany`). */
export function findListBotMessage(
  found: readonly { id: string; name: string }[],
  total: number,
  t: CommandTexts,
): BotMessage {
  const shown = found.slice(0, BOT_FIND_MAX);
  return {
    text: t.tpl(total > BOT_FIND_MAX ? 'tgFindMore' : 'tgFindMany', {
      n: total,
      показано: BOT_FIND_MAX,
    }),
    buttons: shown.map((c): BotButton[] => [
      { text: botClip(c.name, BOT_BUTTON_TEXT_MAX), action: BOT_CARD_ACTION, arg: c.id },
    ]),
  };
}

/** Последний день недели команды «Неделя»: дальше него сроки для ответов не нужны. */
export const commandHorizon = (today: IsoDate): IsoDate => reportWeek(today).to;
