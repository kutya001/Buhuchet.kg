import { describe, expect, it } from 'vitest';
import type { IsoDate } from '../common/dates';
import { botPlainText } from './bot-message';
import {
  BOT_CARD_ACTION,
  BOT_COMMANDS,
  BOT_FIND_MAX,
  BOT_FIND_QUERY_MAX,
  botFindByInn,
  botFindQuery,
  commandHorizon,
  contractorBotMessage,
  findListBotMessage,
  overdueBotMessage,
  parseBotCommand,
  todayBotMessage,
  weekDaysBotMessage,
  type CommandReport,
  type CommandTexts,
} from './commands';
import { TELEGRAM_TEMPLATE_DEFAULTS, fillTemplate } from './messages';

// Ответы по запросу (поток Т, задача Т5; прототип v102 modules/tg-menu.js).

const LABELS = { today: 'Сегодня', week: 'Неделя', over: 'Просрочено', find: 'Найти контрагента' };
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const T: CommandTexts = {
  tpl: (key, values = {}) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], values),
  columns: {
    contractor: 'Контрагент',
    report: 'Отчёт',
    status: 'Статус',
    payment: 'Оплата',
    due: 'Срок',
    day: 'День',
    toSubmit: 'Сдать',
    toPay: 'Оплатить',
  },
  more: (n) => `ещё ${n} — на сайте`,
  payMark: (report) => `${report} — оплата`,
  dayWords: (day) => `${Number(day.slice(8))} ноября`,
  weekdayShort: (n) => DOW[n]!,
  counted: (head, n) => `${head} · ${n}`,
};
// Пятница 13.11.2026.
const TODAY: IsoDate = '2026-11-13';
const URL = 'https://buhuchet.kg/app/reports/week';

const rep = (
  id: string,
  contractor: string,
  subDue: IsoDate | null,
  payDue: IsoDate | null = null,
): CommandReport => ({
  id,
  contractor,
  report: 'НДС, окт.',
  status: 'К сдаче',
  payStatus: 'Не оплачено',
  subDue,
  payDue,
});

describe('команда меню бота', () => {
  it('понимает команду меню Telegram, команду с именем бота и подпись кнопки', () => {
    expect(parseBotCommand('/today', LABELS)?.code).toBe('today');
    expect(parseBotCommand(' /OVERDUE@buhuchet_bot ', LABELS)?.code).toBe('over');
    expect(parseBotCommand('неделя', LABELS)?.code).toBe('week');
    expect(parseBotCommand('Найти контрагента', LABELS)?.code).toBe('find');
  });

  it('подпись берётся из действующих шаблонов; остальное — не команда', () => {
    expect(parseBotCommand('Сегодня', { ...LABELS, today: 'На сегодня' })).toBeNull();
    expect(parseBotCommand('На сегодня', { ...LABELS, today: 'На сегодня' })?.code).toBe('today');
    expect(parseBotCommand('/start', LABELS)).toBeNull();
    expect(parseBotCommand('/today сейчас', LABELS)).toBeNull();
    expect(parseBotCommand('сегодня сдам', LABELS)).toBeNull();
  });

  it('у каждой команды — право: отчёты или контрагенты', () => {
    expect(BOT_COMMANDS.map((c) => [c.code, c.slash, c.permission])).toEqual([
      ['today', 'today', 'repView'],
      ['week', 'week', 'repView'],
      ['over', 'overdue', 'repView'],
      ['find', 'find', 'cpView'],
    ]);
  });
});

describe('«Сегодня»', () => {
  it('ничего нет — одной строкой, без кнопки', () => {
    const m = todayBotMessage([rep('1', 'А', '2026-11-14')], TODAY, T, URL);
    expect(m).toEqual({
      text: 'На сегодня, 13 ноября, ничего нет: отчётов к сдаче и налогов к оплате нет.',
    });
  });

  it('отчёты со сроком сегодня и налоги к оплате сегодня — двумя таблицами, по названию контрагента', () => {
    const m = todayBotMessage(
      [
        rep('2', 'Ромашка', TODAY),
        rep('1', 'Берёза', TODAY, TODAY),
        rep('3', 'Вяз', '2026-11-20', TODAY),
        rep('4', 'Дуб', '2026-11-10'),
      ],
      TODAY,
      T,
      URL,
    );
    expect(m.heading).toBe('Сегодня, 13 ноября');
    expect(m.sub).toBe('Сдать 2 · оплатить 2');
    expect(m.tables).toEqual([
      {
        head: ['Контрагент', 'Отчёт', 'Статус'],
        n: 2,
        rows: [
          ['Берёза', 'НДС, окт.', 'К сдаче'],
          ['Ромашка', 'НДС, окт.', 'К сдаче'],
        ],
      },
      {
        title: '💳 Оплата налогов',
        head: ['Контрагент', 'Отчёт', 'Оплата'],
        n: 2,
        rows: [
          ['Берёза', 'НДС, окт.', 'Не оплачено'],
          ['Вяз', 'НДС, окт.', 'Не оплачено'],
        ],
      },
    ]);
    expect(m.buttons).toEqual([[{ text: 'Открыть отчёты на сайте', url: URL }]]);
  });

  it('только оплата — раздел оплаты сразу раскрыт; сайт не по https — без кнопки', () => {
    const m = todayBotMessage([rep('1', 'А', null, TODAY)], TODAY, T, null);
    expect(m.tables).toHaveLength(1);
    expect(m.tables![0]!.open).toBe(true);
    expect(m.buttons).toBeUndefined();
  });

  it('в таблице не больше 20 строк, остальное — строкой «ещё N — на сайте»', () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      rep(String(i).padStart(2, '0'), `К${i}`, TODAY),
    );
    const table = todayBotMessage(many, TODAY, T, URL).tables![0]!;
    expect(table.rows).toHaveLength(20);
    expect(table.n).toBe(23);
    expect(table.foot).toEqual(['ещё 3 — на сайте', '', '']);
  });
});

describe('«Неделя»', () => {
  it('дни с сегодняшнего до конца недели; просроченное — только в строке итогов', () => {
    const m = weekDaysBotMessage(
      [
        rep('1', 'А', TODAY),
        rep('2', 'Б', '2026-11-15', TODAY),
        rep('3', 'В', '2026-11-10', '2026-11-09'),
        rep('4', 'Г', '2026-11-16'),
      ],
      TODAY,
      T,
      URL,
    );
    expect(m.heading).toBe('🗓 Неделя 09.11–15.11');
    expect(m.sub).toBe(fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS.tgWeekSub, { n1: 2, n2: 1, n3: 2 }));
    expect(m.tables).toEqual([
      {
        head: ['День', 'Сдать', 'Оплатить'],
        numeric: [1, 2],
        rows: [
          ['Пт, 13.11', '1', '1'],
          ['Вс, 15.11', '1', '0'],
        ],
      },
    ]);
  });

  it('в выходные неделя — следующая; на неделе пусто, но есть просроченное — без таблицы', () => {
    expect(commandHorizon('2026-11-14')).toBe('2026-11-22');
    const m = weekDaysBotMessage([rep('1', 'А', '2026-11-13')], '2026-11-14', T, URL);
    expect(m.heading).toBe('🗓 Неделя 16.11–22.11');
    expect(m.tables).toEqual([]);
  });

  it('нечего сдавать и оплачивать, просроченного нет — одной строкой', () => {
    expect(weekDaysBotMessage([rep('1', 'А', '2026-11-30')], TODAY, T, URL)).toEqual({
      text: 'На неделе 09.11–15.11 сдавать и оплачивать нечего, просроченного нет.',
    });
  });
});

describe('«Просрочено»', () => {
  it('несданные и неоплаченные с прошедшим сроком, сначала самые старые; оплата — с пометкой', () => {
    const m = overdueBotMessage(
      [
        rep('1', 'А', '2026-11-12', '2026-11-05'),
        rep('2', 'Б', '2026-11-01'),
        rep('3', 'В', TODAY),
      ],
      TODAY,
      T,
      URL,
    );
    expect(m.heading).toBe('🔴 Просрочено · 3');
    expect(m.tables![0]!.rows).toEqual([
      ['Б', 'НДС, окт.', '01.11'],
      ['А', 'НДС, окт. — оплата', '05.11'],
      ['А', 'НДС, окт.', '12.11'],
    ]);
  });

  it('просроченного нет — одной строкой', () => {
    expect(overdueBotMessage([rep('1', 'А', TODAY)], TODAY, T, URL)).toEqual({
      text: 'Просроченного нет: отчёты сданы и налоги оплачены в срок.',
    });
  });
});

describe('«Найти контрагента»', () => {
  it('запрос: без регистра, «ё» как «е», лишние пробелы убраны, не длиннее предела', () => {
    expect(botFindQuery('  ОсОО   «Берёзка» ')).toBe('осоо «березка»');
    expect(botFindQuery('я'.repeat(100))).toHaveLength(BOT_FIND_QUERY_MAX);
    expect(botFindByInn('0120')).toBe(true);
    expect(botFindByInn('012 ромашка')).toBe(false);
  });

  it('несколько найденных — кнопки с названиями, не больше пяти', () => {
    const found = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Контрагент ${i}` }));
    const few = findListBotMessage(found.slice(0, 3), 3, T);
    expect(few.text).toBe('Найдено контрагентов: 3. Выберите нужного.');
    expect(few.buttons).toHaveLength(3);
    const many = findListBotMessage(found, 7, T);
    expect(many.text).toBe(
      fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS.tgFindMore, { n: 7, показано: BOT_FIND_MAX }),
    );
    expect(many.buttons).toHaveLength(BOT_FIND_MAX);
    expect(many.buttons![0]).toEqual([
      { text: 'Контрагент 0', action: BOT_CARD_ACTION, arg: 'c0' },
    ]);
  });

  it('карточка: ответственный, долг, отчёты по сроку; без права на отчёты таблицы нет', () => {
    const sub = 'Ответственный: Асанов А. · обслуживается с 01.02.2026';
    const full = contractorBotMessage(
      {
        name: 'ОсОО «Ромашка»',
        sub,
        debt: 'Долг за обслуживание: 5 000 сом за 2 мес.',
        reports: [
          { id: '2', report: 'ЕН, окт.', due: '2026-11-20', status: 'К сдаче' },
          { id: '1', report: 'НДС, окт.', due: '2026-11-10', status: 'В работе' },
        ],
      },
      T,
      'https://buhuchet.kg/app/contractors/all?contractor=1',
    );
    expect(full.heading).toBe('ОсОО «Ромашка»');
    expect(full.sub).toBe(sub);
    expect(full.text).toBe('Долг за обслуживание: 5 000 сом за 2 мес.');
    expect(full.tables![0]!.rows).toEqual([
      ['НДС, окт.', '10.11', 'В работе'],
      ['ЕН, окт.', '20.11', 'К сдаче'],
    ]);
    expect(full.buttons![0]![0]!.text).toBe('Открыть на сайте');
    const empty = contractorBotMessage({ name: 'А', sub, debt: null, reports: [] }, T, null);
    expect(empty.text).toBe('Просроченных отчётов и отчётов со сроком в этом месяце нет.');
    const closed = contractorBotMessage({ name: 'А', sub, debt: null, reports: null }, T, null);
    expect(closed.text).toBeUndefined();
    expect(closed.tables).toEqual([]);
    expect(botPlainText(closed)).toContain('А');
  });
});
