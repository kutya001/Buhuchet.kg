import { BOT_TABLE_NAME_MAX, botClip, type BotMessage } from './bot-message';
import type { GroupSummary } from './reminders';
import { botTableRows, type BotReportRow } from './tables';
import { botDayMonth } from './staff-bot';

/*
 * Общий рабочий чат фирмы (поток Т, задача Т8; пакет заказчика 13.11.2026, идея 11; прототип v105
 * modules/tg-group.js). Бот входит в рабочую группу фирмы в Telegram и по рабочим дням пишет туда сводку
 * дня — только числа и имена сотрудников, без контрагентов и сумм: в группе может оказаться посторонний.
 * Под сводкой — «Мои»: нажавший получает свой список скрытым сообщением, его видит только он.
 * Подключение — одноразовой ссылкой `t.me/<бот>?startgroup=g_<ключ>` на 15 минут: группа получает
 * «/start@<бот> g_<ключ>».
 */

/** Код действия «Мои» (данные кнопки под сводкой). */
export const GROUP_MINE = 'grpMine';
/** Приставка ключа ссылки подключения группы: `g_<ключ>` (до 64 знаков A-Z a-z 0-9 _ -). */
export const GROUP_START_PREFIX = 'g_';
/** Сколько минут действует ссылка подключения группы (прототип `TG_GRP_LINK_MIN`). */
export const GROUP_LINK_MINUTES = 15;
/** Длина названия группы, которое хранится и показывается (Telegram — до 128 знаков). */
export const GROUP_TITLE_MAX = 128;

/** Ключ из «/start g_<ключ>»; null — это не ссылка подключения группы. */
export function groupStartToken(token: string): string | null {
  return token.startsWith(GROUP_START_PREFIX) ? token.slice(GROUP_START_PREFIX.length) : null;
}

/** Название группы для хранения: одной строкой, без управляющих знаков, не длиннее предела. */
export function groupTitleClean(title: string | null | undefined): string {
  const one = (title ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return botClip(one, GROUP_TITLE_MAX);
}

export interface GroupSummaryTexts {
  /** Шаблоны `tgGrpHead` и `tgGrpSub` с подстановками. */
  heading: string;
  sub: string;
  /** Столбцы «Сотрудник», «Сегодня», «Просроч.»; без ответственного; подпись «Мои». */
  employee: string;
  today: string;
  overdue: string;
  unassigned: string;
  mine: string;
  more: (n: number) => string;
}

/**
 * Сводка дня в группу (прототип v105 `tgGrpMsg`): строка итогов и таблица по сотрудникам — сначала с
 * просроченным, затем по числу на сегодня и по имени; под ней кнопка «Мои».
 */
export function groupSummaryMessage(
  summary: Pick<GroupSummary, 'rows'>,
  names: ReadonlyMap<string, string>,
  texts: GroupSummaryTexts,
): BotMessage {
  const name = (id: string | null) => (id ? (names.get(id) ?? '—') : texts.unassigned);
  const rows = [...summary.rows].sort(
    (a, b) =>
      b.over - a.over ||
      b.today - a.today ||
      name(a.employeeId).localeCompare(name(b.employeeId), 'ru'),
  );
  return {
    heading: texts.heading,
    sub: texts.sub,
    tables: [
      {
        head: [texts.employee, texts.today, texts.overdue],
        numeric: [1, 2],
        ...botTableRows(
          rows,
          (x) => [botClip(name(x.employeeId), BOT_TABLE_NAME_MAX), String(x.today), String(x.over)],
          texts.more,
        ),
      },
    ],
    buttons: [[{ text: texts.mine, action: GROUP_MINE }]],
  };
}

/**
 * Скрытое сообщение «Мои» (прототип v105): заголовок и таблица «Контрагент | Отчёт | Срок» — до 20
 * строк, остальное «на сайте». Срок сегодня — словом «сегодня». Кнопок нет: скрытое сообщение — ответ на
 * нажатие, а не запись переписки.
 */
export function groupMineMessage(
  heading: string,
  rows: readonly BotReportRow[],
  texts: {
    columns: readonly [string, string, string];
    today: string;
    todayDay: string;
    more: (n: number) => string;
  },
): BotMessage {
  return {
    heading,
    tables: [
      {
        head: texts.columns,
        numeric: [2],
        ...botTableRows(
          rows,
          (r) => [
            botClip(r.contractor, BOT_TABLE_NAME_MAX),
            r.report,
            r.due === texts.todayDay ? texts.today : botDayMonth(r.due),
          ],
          texts.more,
        ),
      },
    ],
  };
}
