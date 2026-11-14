import { describe, expect, it } from 'vitest';
import {
  BOT_COPY_MAX,
  botKeyboard,
  botMessageProblem,
  botPlainText,
  findBotButton,
} from '../telegram/bot-message';
import {
  CP_PAY_DAYS,
  CP_TG_ASK_ACTION,
  CP_TG_PAID_ACTION,
  CP_TG_QUESTION_HISTORY_MAX,
  CP_TG_QUESTION_MAX,
  cpTgQuestion,
  cpTgQuestionForHistory,
  MONTH_PAY_SEND_MESSAGES,
  MONTH_PAY_SEND_REFUSALS,
  monthPayAutoDue,
  monthPayBotMessage,
  monthPaySendRefusal,
} from './telegram-pay';

describe('«Отправить в Telegram»: что мешает (прототип rmPaySendWhy)', () => {
  const ok = { canManagePage: true, archived: false, recipients: 2 };

  it('порядок причин: право, архив, никто не подключил', () => {
    expect(monthPaySendRefusal(ok)).toBeNull();
    expect(monthPaySendRefusal({ canManagePage: false, archived: true, recipients: 0 })).toBe(
      'month_pay_send_right',
    );
    expect(monthPaySendRefusal({ ...ok, archived: true, recipients: 0 })).toBe(
      'month_pay_send_archived',
    );
    expect(monthPaySendRefusal({ ...ok, recipients: 0 })).toBe('month_pay_send_not_linked');
  });

  it('у каждой причины есть текст', () => {
    for (const code of MONTH_PAY_SEND_REFUSALS) expect(MONTH_PAY_SEND_MESSAGES[code]).toBeTruthy();
    expect(MONTH_PAY_SEND_MESSAGES.month_pay_send_right).toBe(
      'Нужно право «Управлять страницей контрагента»',
    );
  });
});

describe('Само «К оплате» за 5 дней до ближайшего срока оплаты', () => {
  const pay = { due: '2026-11-20', noAmount: 0, total: 125_050 } as const;

  it('окно — от 5 дней до срока по день срока', () => {
    expect(CP_PAY_DAYS).toBe(5);
    expect(monthPayAutoDue(pay, '2026-11-14')).toBe(false);
    expect(monthPayAutoDue(pay, '2026-11-15')).toBe(true);
    expect(monthPayAutoDue(pay, '2026-11-18')).toBe(true);
    expect(monthPayAutoDue(pay, '2026-11-20')).toBe(true);
    expect(monthPayAutoDue(pay, '2026-11-21')).toBe(false);
  });

  it('окно через границу месяца и года', () => {
    expect(monthPayAutoDue({ ...pay, due: '2027-01-03' }, '2026-12-29')).toBe(true);
    expect(monthPayAutoDue({ ...pay, due: '2027-01-03' }, '2026-12-28')).toBe(false);
  });

  it('не уходит: платить нечего, есть отчёт без суммы, срока нет', () => {
    expect(monthPayAutoDue({ ...pay, total: 0 }, '2026-11-18')).toBe(false);
    expect(monthPayAutoDue({ ...pay, noAmount: 1 }, '2026-11-18')).toBe(false);
    expect(monthPayAutoDue({ ...pay, due: null }, '2026-11-18')).toBe(false);
  });
});

describe('Вопрос клиента бухгалтеру', () => {
  it('одной строкой, без управляющих знаков; пусто — null', () => {
    expect(cpTgQuestion('  Можно оплатить\n\nчастями?\t До 25  ')).toBe(
      'Можно оплатить частями? До 25',
    );
    expect(cpTgQuestion('')).toBeNull();
    expect(cpTgQuestion(' \n\t ')).toBeNull();
    // Знаки смены направления письма и нулевой ширины не проходят.
    expect(cpTgQuestion('Вопрос\u202E тсет\u200B!')).toBe('Вопрос тсет !');
    expect(cpTgQuestion('\u0000\u0007')).toBeNull();
  });

  it('не длиннее 500 знаков; знаки вне основной плоскости не режутся пополам', () => {
    expect(cpTgQuestion('я'.repeat(CP_TG_QUESTION_MAX))).toHaveLength(CP_TG_QUESTION_MAX);
    const long = cpTgQuestion('я'.repeat(CP_TG_QUESTION_MAX + 50))!;
    expect([...long]).toHaveLength(CP_TG_QUESTION_MAX);
    expect(long.endsWith('…')).toBe(true);
    const emoji = cpTgQuestion('😀'.repeat(CP_TG_QUESTION_MAX + 1))!;
    expect([...emoji]).toHaveLength(CP_TG_QUESTION_MAX);
    expect(emoji.endsWith('😀…')).toBe(true);
  });

  it('в историю — первые 200 знаков', () => {
    expect(cpTgQuestionForHistory('Короткий вопрос')).toBe('Короткий вопрос');
    const cut = cpTgQuestionForHistory('😀'.repeat(CP_TG_QUESTION_HISTORY_MAX + 5));
    expect([...cut]).toHaveLength(CP_TG_QUESTION_HISTORY_MAX);
    expect(cut).toBe('😀'.repeat(CP_TG_QUESTION_HISTORY_MAX));
  });
});

describe('Сообщение «К оплате» (прототип pgPayMsg)', () => {
  const labels = {
    heading: 'Налоги к оплате до',
    accountant: 'бухгалтер',
    tax: 'Налог',
    amount: 'Сумма',
    due: 'Срок',
    total: 'Итого',
    copy: 'Скопировать реквизиты',
    paid: 'Оплатил',
    ask: 'Вопрос бухгалтеру',
  };
  const base = {
    contractor: 'ОсОО «Ала-Тоо Трейд»',
    accountant: 'Асанова А.',
    month: '2026-10',
    lines: [
      { name: 'ЕН', left: 125_050, due: '2026-11-20' },
      { name: 'НДС', left: 500_000, due: '2026-11-25' },
    ],
    total: 625_050,
    due: '2026-11-20',
    requisite: 'Перевод по номеру 0555 123 456 (M-Bank)',
    text: 'Налоги за октябрь 2026: к оплате 6 250,50 сом до 20.11.2026.',
    labels,
  } as const;

  it('заголовок со сроком, контрагент и бухгалтер, таблица налогов с итогом, кнопки', () => {
    const m = monthPayBotMessage(base);
    expect(botMessageProblem(m)).toBeNull();
    expect(m.heading).toBe('Налоги к оплате до 20.11.2026');
    expect(m.sub).toBe('ОсОО «Ала-Тоо Трейд» · бухгалтер Асанова А.');
    expect(m.text).toBe(base.text);
    expect(m.tables).toEqual(
      [
        {
          head: ['Налог', 'Сумма', 'Срок'],
          rows: [
            ['ЕН', '1 250,50', '20.11'],
            ['НДС', '5 000,00', '25.11'],
          ],
          foot: ['Итого', '6 250,50', ''],
          numeric: [1],
        },
      ].map((t) => ({
        ...t,
        rows: t.rows.map((r) => [r[0], expect.stringMatching(r[1]!.replace(/ /g, '\\s')), r[2]]),
        foot: [t.foot[0], expect.stringMatching(t.foot[1]!.replace(/ /g, '\\s')), ''],
      })),
    );
    expect(botKeyboard(m)).toEqual([
      [{ text: 'Скопировать реквизиты', copy: base.requisite }],
      [
        { text: 'Оплатил', data: 'cpPaid:2026-10' },
        { text: 'Вопрос бухгалтеру', data: 'cpAsk:2026-10' },
      ],
    ]);
    expect(findBotButton(m, CP_TG_PAID_ACTION, '2026-10')).toBeTruthy();
    expect(findBotButton(m, CP_TG_ASK_ACTION, '2026-10')).toBeTruthy();
    // Другого месяца в сообщении нет: подделанное нажатие кнопку не найдёт.
    expect(findBotButton(m, CP_TG_PAID_ACTION, '2026-09')).toBeFalsy();
    const plain = botPlainText(m);
    expect(plain).toContain('Налоги к оплате до 20.11.2026');
    expect(plain).toContain('ЕН');
    expect(plain).toContain('Итого');
  });

  it('без ответственного — только контрагент; без реквизита — без кнопки копирования', () => {
    const m = monthPayBotMessage({ ...base, accountant: null, requisite: null });
    expect(m.sub).toBe('ОсОО «Ала-Тоо Трейд»');
    expect(m.text).toBe(base.text);
    expect(botKeyboard(m)).toHaveLength(1);
    expect(botMessageProblem(m)).toBeNull();
  });

  it('реквизит длиннее предела кнопки копирования — в тексте сообщения', () => {
    const fits = 'р'.repeat(BOT_COPY_MAX);
    expect(botKeyboard(monthPayBotMessage({ ...base, requisite: fits }))[0]).toEqual([
      { text: 'Скопировать реквизиты', copy: fits },
    ]);
    const long = 'р'.repeat(BOT_COPY_MAX + 1);
    const m = monthPayBotMessage({ ...base, requisite: long });
    expect(m.text).toBe(`${base.text}\n${long}`);
    expect(botKeyboard(m)).toHaveLength(1);
    expect(botMessageProblem(m)).toBeNull();
  });
});
