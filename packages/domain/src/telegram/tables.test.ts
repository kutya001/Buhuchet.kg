import { describe, expect, it } from 'vitest';
import { formatText, UI_TEXTS, type Translate } from '../l10n/texts';
import {
  BOT_BUTTON_TEXT_MAX,
  BOT_COPY_MAX,
  botMessageProblem,
  botPlainText,
  botRichHtml,
} from './bot-message';
import type { ReminderItem, ReminderLine } from './reminders';
import {
  botDayWords,
  botPeriodBrief,
  botTableRows,
  feeCopyNote,
  morningTables,
  nudgeBotMessage,
  STAFF_BOT_NUDGE,
  WEEK_DEBT_ROWS_MAX,
  weekBotMessage,
  type BotReportRow,
  type MorningTexts,
  type WeekDebt,
  type WeekTexts,
} from './tables';

// Таблицы в сообщениях бота (поток Т, задача Т3; прототип v100 modules/tg-tables.js).
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const more = (n: number) => `ещё ${n} — на сайте`;
const columns = ['Контрагент', 'Отчёт', 'Срок'] as const;

const item = (id: string): ReminderItem => ({ id, label: id });
/** Срок строки — в её номере: «r-2026-11-10». */
const row = (i: ReminderItem, pay: boolean): BotReportRow => ({
  id: i.id,
  contractor: `ОсОО ${i.id.slice(0, 1).toUpperCase()}`,
  report: pay ? 'НДС, окт. (оплата)' : 'НДС, окт.',
  due: i.id.slice(2),
});

const morningTexts: MorningTexts = {
  over: '🔴 Просрочено',
  today: '📌 Сегодня',
  before: (d) => `⏰ Через ${d} дн.`,
  pay: '💳 Оплата налогов',
  sub: (n) => `Просрочено ${n.over} · сегодня ${n.today} · скоро ${n.soon} · оплата ${n.pay}`,
  columns,
  more,
};

describe('таблицы в сообщениях бота (задача Т3)', () => {
  it('строки таблицы: первые 20, остальное — «ещё N — на сайте», счётчик — сколько всего (прототип tgRows)', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    const cut = botTableRows(list, (i) => [`Строка ${i}`, 'x', 'y'], more);
    expect(cut.n).toBe(23);
    expect(cut.rows).toHaveLength(20);
    expect(cut.foot).toEqual(['ещё 3 — на сайте', '', '']);
    expect(botTableRows([1, 2], (i) => [String(i)], more)).toEqual({ n: 2, rows: [['1'], ['2']] });
  });

  it('период коротко и день словами (прототип tgPerShort, tgDayWords)', () => {
    const today = '2026-11-13';
    expect(botPeriodBrief({ period: 'M', start: '2026-10-01' }, today, t)).toBe('окт.');
    expect(botPeriodBrief({ period: 'M', start: '2026-05-01' }, today, t)).toBe('май');
    expect(botPeriodBrief({ period: 'M', start: '2025-12-01' }, today, t)).toBe('дек. 2025');
    expect(botPeriodBrief({ period: 'Q', start: '2026-07-01' }, today, t)).toBe('III кв.');
    expect(botPeriodBrief({ period: 'Q', start: '2025-10-01' }, today, t)).toBe('IV кв. 2025');
    expect(botPeriodBrief({ period: 'H', start: '2026-01-01' }, today, t)).toBe('I пол.');
    expect(botPeriodBrief({ period: 'Y', start: '2026-01-01' }, today, t)).toBe('2026');
    expect(botDayWords(today, 4, t)).toBe('пятницу, 13 ноября');
    expect(botDayWords('2026-11-02', 0, t)).toBe('понедельник, 2 ноября');
  });

  it('утреннее напоминание: разделы по порядку, срочные раскрыты, оплата — одним разделом, строки по сроку', () => {
    const lines: ReminderLine[] = [
      { key: 'tgToday', items: [item('b-2026-11-13')] },
      { key: 'tgOver', items: [item('c-2026-11-10'), item('a-2026-11-05')] },
      { key: 'tgBefore', days: 7, items: [item('d-2026-11-20')] },
      { key: 'tgBefore', days: 3, items: [item('e-2026-11-16')] },
      { key: 'tgPayToday', items: [item('f-2026-11-13')] },
      { key: 'tgPayOver', items: [item('g-2026-11-01')] },
      { key: 'tgPay', days: 3, items: [item('h-2026-11-16')] },
      { key: 'tgConfWait', days: 3, items: [item('w-2026-11-01')] },
      { key: 'tgTaskSoon', items: [item('t-2026-11-14')] },
    ];
    const m = morningTables(lines, row, morningTexts)!;
    expect(m.sub).toBe('Просрочено 2 · сегодня 1 · скоро 2 · оплата 3');
    expect(m.tables.map((x) => [x.title, x.open, x.n])).toEqual([
      ['🔴 Просрочено', true, 2],
      ['📌 Сегодня', true, 1],
      ['⏰ Через 3 дн.', false, 1],
      ['⏰ Через 7 дн.', false, 1],
      ['💳 Оплата налогов', false, 3],
    ]);
    // Самые давние первыми; срок — «ДД.ММ», столбец срока — числовой (не переносится, вправо).
    expect(m.tables[0]!.rows).toEqual([
      ['ОсОО A', 'НДС, окт.', '05.11'],
      ['ОсОО C', 'НДС, окт.', '10.11'],
    ]);
    expect(m.tables[0]).toMatchObject({ head: columns, numeric: [2] });
    expect(m.tables[4]!.rows.map((r) => r[2])).toEqual(['01.11', '13.11', '16.11']);
    expect(m.tables[4]!.rows[0]![1]).toBe('НДС, окт. (оплата)');
    const message = { heading: 'Отчёты на пятницу, 13 ноября', ...m };
    expect(botMessageProblem(message)).toBeNull();
    expect(botRichHtml(message)).toContain('<details open><summary>🔴 Просрочено · 2</summary>');
    expect(botRichHtml(message)).toContain('<details><summary>💳 Оплата налогов · 3</summary>');
  });

  it('утреннее напоминание: срочного нет — раскрыт первый раздел; отчётов нет — таблиц нет; длинный раздел обрезан', () => {
    const calm = morningTables(
      [
        { key: 'tgBefore', days: 3, items: [item('a-2026-11-16')] },
        { key: 'tgPay', days: 7, items: [item('b-2026-11-20')] },
      ],
      row,
      morningTexts,
    )!;
    expect(calm.tables.map((x) => x.open)).toEqual([true, false]);
    expect(calm.sub).toBe('Просрочено 0 · сегодня 0 · скоро 1 · оплата 1');
    expect(
      morningTables([{ key: 'tgTaskOver', items: [item('t-2026-11-01')] }], row, morningTexts),
    ).toBeNull();
    const many = Array.from({ length: 26 }, (_, i) =>
      item(`${String.fromCharCode(97 + i)}-2026-11-01`),
    );
    const long = morningTables([{ key: 'tgOver', items: many }], row, morningTexts)!;
    expect(long.tables[0]).toMatchObject({ n: 26, foot: ['ещё 6 — на сайте', '', ''] });
    expect(long.tables[0]!.rows).toHaveLength(20);
    expect(long.sub).toContain('Просрочено 26');
  });

  const weekTexts: WeekTexts = {
    heading: '🗓 Неделя 09.11–15.11',
    sub: 'Сдать 7 · оплатить 2 · просрочено 3',
    employee: 'Сотрудник',
    toSubmit: 'Сдать',
    overdue: 'Просроч.',
    waiting: 'Ждут',
    unassigned: 'Без ответственного',
    debtTitle: '💰 Долги за обслуживание',
    contractor: 'Контрагент',
    debt: 'Долг, сом',
    months: 'Мес.',
    total: 'Всего',
    totalOf: (n) => `Всего у ${n} контрагентов`,
    nudge: (e, n) => `Напомнить: ${e} · просрочено ${n}`,
    feeCopy: (c) => `Скопировать напоминание: ${c}`,
    more,
  };
  const names = new Map([
    ['e1', 'Айбек С.'],
    ['e2', 'Нурлан Т.'],
    ['e3', 'Гульнара А.'],
    ['e4', 'Бакыт У.'],
    ['e5', 'Жылдыз К.'],
  ]);
  const rows = [
    { employeeId: 'e1', sub: 2, over: 1, wait: 0 },
    { employeeId: 'e2', sub: 6, over: 2, wait: 1 },
    { employeeId: 'e3', sub: 4, over: 0, wait: 2 },
    { employeeId: null, sub: 1, over: 0, wait: 0 },
    { employeeId: 'e4', sub: 0, over: 5, wait: 0 },
    { employeeId: 'e5', sub: 0, over: 1, wait: 0 },
  ];
  const debt = (name: string, som: number, months: number, note: string | null): WeekDebt => ({
    name,
    debt: som * 100,
    months,
    note,
  });

  it('сводка недели: сотрудники с просроченным — первыми, «Ждут» — при подтверждении сдачи, «Напомнить» — первым трём, не себе', () => {
    const o = { self: 'e4', names, confirm: true, canNudge: true, debts: [], texts: weekTexts };
    const m = weekBotMessage({ rows }, o)!;
    expect(m.heading).toBe('🗓 Неделя 09.11–15.11');
    expect(m.sub).toBe('Сдать 7 · оплатить 2 · просрочено 3');
    expect(m.tables).toHaveLength(1);
    expect(m.tables![0]).toMatchObject({
      head: ['Сотрудник', 'Сдать', 'Просроч.', 'Ждут'],
      numeric: [1, 2, 3],
      n: 6,
    });
    expect(m.tables![0]!.rows).toEqual([
      ['Бакыт У.', '0', '5', '0'],
      ['Нурлан Т.', '6', '2', '1'],
      ['Айбек С.', '2', '1', '0'],
      ['Жылдыз К.', '0', '1', '0'],
      ['Гульнара А.', '4', '0', '2'],
      ['Без ответственного', '1', '0', '0'],
    ]);
    // Себе (e4) не напоминают; без просроченного кнопки нет; кнопок не больше трёх.
    expect(m.buttons).toEqual([
      [{ text: 'Напомнить: Нурлан Т. · просрочено 2', action: STAFF_BOT_NUDGE, arg: 'e2' }],
      [{ text: 'Напомнить: Айбек С. · просрочено 1', action: STAFF_BOT_NUDGE, arg: 'e1' }],
      [{ text: 'Напомнить: Жылдыз К. · просрочено 1', action: STAFF_BOT_NUDGE, arg: 'e5' }],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    // Простой текст: число — с названием столбца.
    expect(botPlainText(m)).toContain('• Нурлан Т. — Сдать 6 — Просроч. 2 — Ждут 1');
    // Подтверждение сдачи выключено — столбца «Ждут» нет; напоминать не вправе — кнопок нет.
    const plain = weekBotMessage({ rows }, { ...o, confirm: false, canNudge: false })!;
    expect(plain.tables![0]!.head).toEqual(['Сотрудник', 'Сдать', 'Просроч.']);
    expect(plain.tables![0]!.rows[0]).toEqual(['Бакыт У.', '0', '5']);
    expect(plain.buttons).toBeUndefined();
    // Длинная подпись кнопки обрезается до предела Telegram.
    const long = weekBotMessage(
      { rows: [{ employeeId: 'e1', sub: 0, over: 1, wait: 0 }] },
      { ...o, names: new Map([['e1', 'Очень-очень длинное имя сотрудника '.repeat(3)]]) },
    )!;
    expect([...long.buttons![0]![0]!.text]).toHaveLength(BOT_BUTTON_TEXT_MAX);
    expect(botMessageProblem(long)).toBeNull();
    // Писать нечего — сообщения нет.
    expect(weekBotMessage({ rows: [] }, o)).toBeNull();
  });

  it('долги за обслуживание: свёрнутый раздел, самые большие первыми, итог по всем, «Скопировать напоминание» — первым трём', () => {
    const debts = [
      debt('ОсОО «Бета»', 4000, 1, 'Бета, оплатите'),
      debt('ОсОО «Альфа»', 12500.5, 3, 'Альфа, оплатите'),
      debt('ИП Гамма', 4000, 2, null),
      debt('ОсОО «Дельта»', 900, 1, 'Дельта, оплатите'),
    ];
    const o = { self: 'e1', names, confirm: true, canNudge: true, debts, texts: weekTexts };
    const m = weekBotMessage({ rows: [] }, o)!;
    expect(m.tables).toHaveLength(1);
    expect(m.tables![0]).toMatchObject({
      title: '💰 Долги за обслуживание',
      open: false,
      n: 4,
      head: ['Контрагент', 'Долг, сом', 'Мес.'],
      numeric: [1, 2],
    });
    expect(m.tables![0]!.rows.map((r) => [r[0], r[2]])).toEqual([
      ['ОсОО «Альфа»', '3'],
      ['ИП Гамма', '2'],
      ['ОсОО «Бета»', '1'],
      ['ОсОО «Дельта»', '1'],
    ]);
    expect(m.tables![0]!.rows[0]![1]!.replace(/\s/g, ' ')).toBe('12 500,50');
    expect(m.tables![0]!.foot!.map((x) => x.replace(/\s/g, ' '))).toEqual([
      'Всего',
      '21 400,50',
      '',
    ]);
    // Кнопка копирования — у первых трёх должников; у кого текст не поместился — кнопки нет.
    expect(m.buttons).toEqual([
      [{ text: 'Скопировать напоминание: ОсОО «Альфа»', copy: 'Альфа, оплатите' }],
      [{ text: 'Скопировать напоминание: ОсОО «Бета»', copy: 'Бета, оплатите' }],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    // Больше 10 должников: строк 10, итог — «Всего у N контрагентов» и сумма по всем.
    const many = Array.from({ length: 12 }, (_, i) => debt(`Контрагент ${i}`, 100, 1, null));
    const big = weekBotMessage({ rows }, { ...o, debts: many })!;
    expect(big.tables).toHaveLength(2);
    expect(big.tables![1]!.rows).toHaveLength(WEEK_DEBT_ROWS_MAX);
    expect(big.tables![1]).toMatchObject({ n: 12 });
    expect(big.tables![1]!.foot!.map((x) => x.replace(/\s/g, ' '))).toEqual([
      'Всего у 12 контрагентов',
      '1 200,00',
      '',
    ]);
  });

  it('текст для копирования: первый вариант, который помещается в 256 знаков; ни один — кнопки нет', () => {
    const long = 'я'.repeat(BOT_COPY_MAX + 1);
    const fits = 'я'.repeat(BOT_COPY_MAX);
    expect(feeCopyNote([long, fits, 'короткий'])).toBe(fits);
    expect(feeCopyNote(['с реквизитами', 'без'])).toBe('с реквизитами');
    expect(feeCopyNote([long, long])).toBeNull();
    expect(feeCopyNote([''])).toBeNull();
  });

  it('«Напомнить»: текст и таблица просроченного, ссылка — только у сайта по https', () => {
    const list: BotReportRow[] = [
      { id: 'b', contractor: 'ОсОО Б', report: 'НДС, окт. — оплата', due: '2026-11-10' },
      { id: 'a', contractor: 'ОсОО А', report: 'ЕН, III кв.', due: '2026-10-20' },
    ];
    const open = { label: 'Открыть отчёты на сайте', url: 'https://buhuchet.kg/app/reports/all' };
    const m = nudgeBotMessage(
      '🔔 Айбек С. напоминает о просроченном: 2.',
      list,
      { columns, more },
      open,
    );
    expect(m.text).toBe('🔔 Айбек С. напоминает о просроченном: 2.');
    expect(m.tables![0]).toMatchObject({ head: columns, numeric: [2], n: 2 });
    expect(m.tables![0]!.rows).toEqual([
      ['ОсОО А', 'ЕН, III кв.', '20.10'],
      ['ОсОО Б', 'НДС, окт. — оплата', '10.11'],
    ]);
    expect(m.buttons).toEqual([[{ text: open.label, url: open.url }]]);
    expect(botMessageProblem(m)).toBeNull();
    expect(botPlainText(m)).toBe(
      [
        '🔔 Айбек С. напоминает о просроченном: 2.',
        '• ОсОО А — ЕН, III кв. — Срок 20.10',
        '• ОсОО Б — НДС, окт. — оплата — Срок 10.11',
      ].join('\n'),
    );
    expect(
      nudgeBotMessage('x', list, { columns, more }, { ...open, url: null }).buttons,
    ).toBeUndefined();
  });
});
