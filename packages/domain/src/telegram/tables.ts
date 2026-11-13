import { formatDateRu, type IsoDate } from '../common/dates';
import { formatSom, sumTyiyn, type Tyiyn } from '../common/money';
import { monthLabelGen, monthOf, type YearMonth } from '../common/months';
import { feeWhatsAppText } from '../fees/reminder';
import type { Translate, UiTextKey } from '../l10n/texts';
import { periodFull, periodLabel, type PeriodRef } from '../reports/periods';
import {
  BOT_BUTTON_TEXT_MAX,
  BOT_TABLE_NAME_MAX,
  BOT_COPY_MAX,
  BOT_TABLE_ROWS_MAX,
  botClip,
  type BotButton,
  type BotMessage,
  type BotTable,
} from './bot-message';
import type { ReminderItem, ReminderLine, WeekSummary } from './reminders';
import { botDayMonth } from './staff-bot';

/*
 * Таблицы в сообщениях бота (поток Т, задача Т3; пакет заказчика 13.11.2026, идеи 2, 8 и 10; прототип
 * v100 modules/tg-tables.js): утреннее напоминание — таблицей с раскрывающимися разделами; сводка недели
 * владельцу и главному бухгалтеру — таблицей по сотрудникам с кнопками «Напомнить»; долги за
 * обслуживание — свёрнутым разделом той же сводки с кнопками «Скопировать напоминание». Заголовки,
 * названия разделов и подписи кнопок — шаблоны «Справочников платформы», столбцы таблиц — словарь.
 * В таблице не больше 20 строк (долгов — 10): остальное — строкой «ещё N — на сайте», счётчик раздела
 * показывает, сколько записей всего.
 */

/** Кнопок «Напомнить» под сводкой недели (прототип `TG_NUDGE_MAX`). */
export const WEEK_NUDGE_MAX = 3;
/** Строк в таблице долгов и кнопок «Скопировать напоминание» (прототип `TG_DEBT_MAX`, `TG_FEE_COPY_MAX`). */
export const WEEK_DEBT_ROWS_MAX = 10;
export const WEEK_FEE_COPY_MAX = 3;
/** Код действия «Напомнить» (данные кнопки): запись — сотрудник. */
export const STAFF_BOT_NUDGE = 'nudge';

/**
 * Строки таблицы: первые `max`, остальное — строкой «ещё N — на сайте»; `n` — сколько записей всего
 * (прототип `tgRows`).
 */
export function botTableRows<T>(
  list: readonly T[],
  cells: (x: T) => readonly string[],
  more: (n: number) => string,
  max = BOT_TABLE_ROWS_MAX,
): Pick<BotTable, 'n' | 'rows' | 'foot'> {
  const rows = list.slice(0, max).map(cells);
  if (list.length <= max) return { n: list.length, rows };
  return {
    n: list.length,
    rows,
    foot: [more(list.length - max), ...rows[0]!.slice(1).map(() => '')],
  };
}

/**
 * Период коротко, чтобы столбец «Отчёт» помещался на телефоне (прототип `tgPerShort`): «окт.», «III кв.»,
 * «I полугодие», «2026»; год — только если он не текущий. У отчёта по событию — с датой события:
 * «окт. · дата события 15.10.2026».
 */
export function botPeriodBrief(
  ref: Pick<PeriodRef, 'period' | 'start' | 'event'> & { eventLabel?: string },
  today: IsoDate,
  t: Translate,
): string {
  const year = ref.start.slice(0, 4);
  const tail = year === today.slice(0, 4) ? '' : ` ${year}`;
  if (ref.period === 'Y') return year;
  if (ref.period === 'M') {
    const name = t(`report.month.${Number(ref.start.slice(5, 7))}` as UiTextKey).toLowerCase();
    const month = `${name.length > 3 ? `${name.slice(0, 3)}.` : name}${tail}`;
    if (!ref.event) return month;
    // Отчёт по событию: за месяц их может быть несколько — в ячейке есть дата события.
    const label = (ref.eventLabel || t('report.event.default')).replace(/^./u, (c) =>
      c.toLowerCase(),
    );
    return t('report.period.event_full', {
      period: month,
      event: label,
      date: formatDateRu(ref.event),
    });
  }
  // Квартал — коротко («III кв.»), полугодие — целиком («I полугодие»), как в прототипе.
  const label =
    ref.period === 'Q'
      ? periodLabel({ period: ref.period, start: ref.start }, t)
      : periodFull({ period: ref.period, start: ref.start }, t);
  return label.endsWith(` ${year}`) ? `${label.slice(0, -year.length - 1)}${tail}` : label;
}

/** «пятницу, 13 ноября» — день в заголовке «Отчёты на …» (прототип `tgDayWords`). */
export function botDayWords(day: IsoDate, weekdayMondayFirst: number, t: Translate): string {
  const month = monthLabelGen(monthOf(day)).split(' ')[0]!;
  return `${t(`telegram.weekday.${weekdayMondayFirst}` as UiTextKey)}, ${Number(day.slice(8, 10))} ${month}`;
}

/** Строка таблицы отчётов: ячейки «Контрагент», «Отчёт», «Срок» и срок для порядка строк. */
export interface BotReportRow {
  id: string;
  contractor: string;
  report: string;
  due: IsoDate;
}

const byDue = (a: BotReportRow, b: BotReportRow) =>
  a.due.localeCompare(b.due) || a.id.localeCompare(b.id);
const reportCells = (r: BotReportRow) => [
  botClip(r.contractor, BOT_TABLE_NAME_MAX),
  r.report,
  botDayMonth(r.due),
];

export interface MorningTexts {
  /** Разделы — шаблоны `tgSecOver`, `tgSecToday`, `tgSecBefore`, `tgSecPay`. */
  over: string;
  today: string;
  before: (days: number) => string;
  pay: string;
  /** Строка итогов — шаблон `tgMornSub`. */
  sub: (n: { over: number; today: number; soon: number; pay: number }) => string;
  columns: readonly [string, string, string];
  more: (n: number) => string;
}

/**
 * Утреннее напоминание таблицей (прототип `tgMornMsg`): разделы «Просрочено», «Сегодня», «Через N дн.»
 * и «Оплата налогов» из строк напоминания дня. «Просрочено» и «Сегодня» раскрыты, остальное свёрнуто;
 * срочного нет — раскрыт первый раздел. В «Оплату налогов» попадают и оплата сегодня, и просроченная.
 * Остальные строки дня (ждут подтверждения, задачи) в таблицы не входят. null — отчётов в напоминании нет.
 */
export function morningTables(
  lines: readonly ReminderLine[],
  row: (item: ReminderItem, pay: boolean) => BotReportRow,
  texts: MorningTexts,
): { sub: string; tables: BotTable[] } | null {
  const over: BotReportRow[] = [];
  const today: BotReportRow[] = [];
  const before = new Map<number, BotReportRow[]>();
  const pay: BotReportRow[] = [];
  for (const l of lines) {
    if (l.key === 'tgOver') over.push(...l.items.map((i) => row(i, false)));
    else if (l.key === 'tgToday') today.push(...l.items.map((i) => row(i, false)));
    else if (l.key === 'tgBefore') {
      before.set(l.days, [...(before.get(l.days) ?? []), ...l.items.map((i) => row(i, false))]);
    } else if (l.key === 'tgPayOver' || l.key === 'tgPayToday' || l.key === 'tgPay') {
      pay.push(...l.items.map((i) => row(i, true)));
    }
  }
  const section = (title: string, rows: BotReportRow[], open: boolean): BotTable[] =>
    rows.length
      ? [
          {
            title,
            open,
            head: texts.columns,
            numeric: [2],
            ...botTableRows([...rows].sort(byDue), reportCells, texts.more),
          },
        ]
      : [];
  const days = [...before.keys()].sort((a, b) => a - b);
  const tables = [
    ...section(texts.over, over, true),
    ...section(texts.today, today, true),
    ...days.flatMap((d) => section(texts.before(d), before.get(d)!, false)),
    ...section(texts.pay, pay, false),
  ];
  if (!tables.length) return null;
  if (!over.length && !today.length) tables[0] = { ...tables[0]!, open: true };
  const soon = days.reduce((n, d) => n + before.get(d)!.length, 0);
  return {
    sub: texts.sub({ over: over.length, today: today.length, soon, pay: pay.length }),
    tables,
  };
}

/** Должник за обслуживание в сводке недели: долг, сколько месяцев и текст напоминания для копирования. */
export interface WeekDebt {
  name: string;
  debt: Tyiyn;
  months: number;
  /** Текст для кнопки «Скопировать напоминание»; null — в 256 знаков не поместился, кнопки нет. */
  note: string | null;
}

export interface WeekTexts {
  /** Шаблоны `tgWeekHead` и `tgWeekSub` с подстановками. */
  heading: string;
  sub: string;
  /** Столбцы таблицы сотрудников: «Сотрудник», «Сдать», «Просроч.», «Ждут». */
  employee: string;
  toSubmit: string;
  overdue: string;
  waiting: string;
  unassigned: string;
  /** Раздел долгов — шаблон `tgSecDebt`; столбцы «Контрагент», «Долг, сом», «Мес.». */
  debtTitle: string;
  contractor: string;
  debt: string;
  months: string;
  total: string;
  totalOf: (n: number) => string;
  /** Подписи кнопок — шаблоны `tgBtnNudge` и `tgBtnFeeCopy`. */
  nudge: (employee: string, n: number) => string;
  feeCopy: (contractor: string) => string;
  more: (n: number) => string;
}

/**
 * Сводка недели руководителю (прототип `tgWeekMsg`): таблица по сотрудникам — сколько сдать до конца
 * недели, сколько просрочено и сколько сдач ждут подтверждения (столбец «Ждут» — только при включённом
 * подтверждении сдачи); сотрудники с просроченным — первыми. «Напомнить» — у первых трёх сотрудников с
 * просроченным, не себе и только тому, кто вправе напоминать. Долги за обслуживание — свёрнутым
 * разделом: самые большие первыми, не больше 10 строк, итог — по всем; «Скопировать напоминание» — у
 * первых трёх. null — писать нечего.
 */
export function weekBotMessage(
  week: Pick<WeekSummary, 'rows'>,
  o: {
    self: string;
    names: ReadonlyMap<string, string>;
    confirm: boolean;
    canNudge: boolean;
    /** Кому можно напомнить: действующие сотрудники. Не задано — всем из таблицы. */
    active?: ReadonlySet<string>;
    debts: readonly WeekDebt[];
    texts: WeekTexts;
  },
): BotMessage | null {
  const { texts } = o;
  if (!week.rows.length && !o.debts.length) return null;
  const name = (id: string | null) => (id ? (o.names.get(id) ?? '—') : texts.unassigned);
  const rows = [...week.rows].sort(
    (a, b) =>
      b.over - a.over ||
      b.sub - a.sub ||
      name(a.employeeId).localeCompare(name(b.employeeId), 'ru'),
  );
  const tables: BotTable[] = [];
  const buttons: BotButton[][] = [];
  if (rows.length) {
    tables.push({
      head: [texts.employee, texts.toSubmit, texts.overdue, ...(o.confirm ? [texts.waiting] : [])],
      numeric: [1, 2, 3],
      ...botTableRows(
        rows,
        (x) => [
          name(x.employeeId),
          String(x.sub),
          String(x.over),
          ...(o.confirm ? [String(x.wait)] : []),
        ],
        texts.more,
      ),
    });
    if (o.canNudge) {
      for (const x of rows
        .filter(
          (r) =>
            r.employeeId &&
            r.employeeId !== o.self &&
            r.over > 0 &&
            (!o.active || o.active.has(r.employeeId)),
        )
        .slice(0, WEEK_NUDGE_MAX)) {
        buttons.push([
          {
            text: botClip(texts.nudge(name(x.employeeId), x.over), BOT_BUTTON_TEXT_MAX),
            action: STAFF_BOT_NUDGE,
            arg: x.employeeId!,
          },
        ]);
      }
    }
  }
  if (o.debts.length) {
    const debts = [...o.debts].sort(
      (a, b) => b.debt - a.debt || a.name.localeCompare(b.name, 'ru'),
    );
    tables.push({
      title: texts.debtTitle,
      open: false,
      n: debts.length,
      head: [texts.contractor, texts.debt, texts.months],
      numeric: [1, 2],
      rows: debts
        .slice(0, WEEK_DEBT_ROWS_MAX)
        .map((c) => [botClip(c.name, BOT_TABLE_NAME_MAX), formatSom(c.debt), String(c.months)]),
      foot: [
        debts.length > WEEK_DEBT_ROWS_MAX ? texts.totalOf(debts.length) : texts.total,
        formatSom(sumTyiyn(debts.map((c) => c.debt))),
        '',
      ],
    });
    for (const c of debts.slice(0, WEEK_FEE_COPY_MAX)) {
      if (c.note) {
        buttons.push([{ text: botClip(texts.feeCopy(c.name), BOT_BUTTON_TEXT_MAX), copy: c.note }]);
      }
    }
  }
  return {
    heading: texts.heading,
    sub: texts.sub,
    tables,
    ...(buttons.length ? { buttons } : {}),
  };
}

/**
 * Текст для кнопки «Скопировать напоминание» (прототип `tgFeeNote`): кнопка Telegram копирует не больше
 * 256 знаков, поэтому берётся первый вариант, который помещается, — с реквизитами, без реквизитов, с
 * месяцами числом («за 4 мес.»); не помещается ни один — null, кнопки у контрагента нет.
 */
export function feeCopyNote(variants: readonly string[], max = BOT_COPY_MAX): string | null {
  return variants.find((x) => x.length >= 1 && x.length <= max) ?? null;
}

/**
 * Текст напоминания о долге для кнопки копирования — тот же, что «Напомнить об оплате» на сайте
 * (`feeWhatsAppText`), по шагам: с реквизитами, без реквизитов, с месяцами числом (`monthsCount`).
 */
export function feeDebtCopyNote(
  template: string,
  values: {
    contractor: string;
    months: readonly YearMonth[];
    amount: Tyiyn;
    payBy: IsoDate;
    requisite: string | null;
  },
  texts: { requisites: (req: string) => string; monthsCount: string },
  max = BOT_COPY_MAX,
): string | null {
  const make = (requisite: string | null, monthsText?: string) =>
    feeWhatsAppText(
      template,
      { ...values, requisite, ...(monthsText ? { monthsText } : {}) },
      texts.requisites,
    );
  return feeCopyNote(
    [
      ...(values.requisite ? [make(values.requisite)] : []),
      make(null),
      make(null, texts.monthsCount),
    ],
    max,
  );
}

/**
 * «Напомнить» от руководителя (прототип `tgNudgeMsg`): текст шаблона `tgNudge` и таблица просроченного
 * сотрудника — несданные отчёты и неоплаченные налоги (с пометкой «оплата»); ниже — «Открыть отчёты на
 * сайте», если сайт по https.
 */
export function nudgeBotMessage(
  text: string,
  rows: readonly BotReportRow[],
  texts: { columns: readonly [string, string, string]; more: (n: number) => string },
  open: { label: string; url: string | null },
): BotMessage {
  return {
    text,
    tables: [
      {
        head: texts.columns,
        numeric: [2],
        ...botTableRows([...rows].sort(byDue), reportCells, texts.more),
      },
    ],
    ...(open.url ? { buttons: [[{ text: open.label, url: open.url }]] } : {}),
  };
}
