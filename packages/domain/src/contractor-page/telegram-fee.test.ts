import { describe, expect, it } from 'vitest';
import type { FeeMonth } from '../fees/charges';
import {
  botKeyboard,
  botMessageProblem,
  botPlainText,
  findBotButton,
} from '../telegram/bot-message';
import {
  CP_TG_FEE_MESSAGES,
  CP_TG_FEE_REFUSALS,
  feeBotMessage,
  feeTelegramDue,
  feeTelegramRefusal,
  feeTelegramShown,
} from './telegram-fee';
import { CP_TG_PAID_ACTION, CP_TG_RECEIPT_ACTION } from './telegram-pay';

/*
 * «Напомнить в Telegram» об оплате за обслуживание (доработки 14.11.2026, блок 4, пункт 5; прототип v110
 * modules/cp-telegram.js: pgFeeTgShow, pgFeeTgWhy, pgFeeDue, pgFeeMsg).
 */

const shown = {
  telegram: true,
  cppage: true,
  fee: true,
  oneOff: false,
  debt: 500_000,
  linked: 1,
};

describe('feeTelegramShown — кнопка видна (pgFeeTgShow)', () => {
  it('нужны обе функции Telegram и страницы, плата, долг и подключённый Telegram', () => {
    expect(feeTelegramShown(shown)).toBe(true);
    expect(feeTelegramShown({ ...shown, telegram: false })).toBe(false);
    expect(feeTelegramShown({ ...shown, cppage: false })).toBe(false);
    expect(feeTelegramShown({ ...shown, fee: false })).toBe(false);
    expect(feeTelegramShown({ ...shown, debt: 0 })).toBe(false);
    expect(feeTelegramShown({ ...shown, linked: 0 })).toBe(false);
  });

  it('у разового контрагента платы за обслуживание нет — кнопки тоже', () => {
    expect(feeTelegramShown({ ...shown, oneOff: true })).toBe(false);
  });
});

const ok = {
  archived: false,
  sentAt: null,
  requisite: 'ok' as const,
  reachable: 2,
  recipients: 1,
};

describe('feeTelegramRefusal — что мешает (pgFeeTgWhy)', () => {
  it('ничего не мешает', () => {
    expect(feeTelegramRefusal(ok)).toBeNull();
  });

  it('порядок причин: архив, сегодня уже напоминали, реквизиты, раздел «Telegram», «Не напоминать»', () => {
    const all = {
      archived: true,
      sentAt: '10:15',
      requisite: 'none' as const,
      reachable: 0,
      recipients: 0,
    };
    expect(feeTelegramRefusal(all)).toBe('cp_tg_fee_archived');
    expect(feeTelegramRefusal({ ...all, archived: false })).toBe('cp_tg_fee_today');
    expect(feeTelegramRefusal({ ...all, archived: false, sentAt: null })).toBe('cp_tg_fee_no_req');
    expect(feeTelegramRefusal({ ...all, archived: false, sentAt: null, requisite: 'hidden' })).toBe(
      'cp_tg_fee_req_hidden',
    );
    expect(feeTelegramRefusal({ ...ok, reachable: 0, recipients: 0 })).toBe('cp_tg_fee_tg_off');
    expect(feeTelegramRefusal({ ...ok, recipients: 0 })).toBe('cp_tg_fee_all_off');
  });

  it('тексты отказов — как в прототипе', () => {
    expect(CP_TG_FEE_MESSAGES.cp_tg_fee_today).toBe('Сегодня уже напоминали в {time}');
    expect(CP_TG_FEE_MESSAGES.cp_tg_fee_no_req).toBe(
      'Не отправлено «К оплате»: у {contractor} нет реквизитов для перевода. Добавьте основной счёт для обслуживания: «Моя организация» → «Реквизиты».',
    );
    expect(CP_TG_FEE_MESSAGES.cp_tg_fee_all_off).toBe(
      'Все подключённые Telegram выключили напоминания кнопкой «Не напоминать»',
    );
    for (const code of CP_TG_FEE_REFUSALS) expect(CP_TG_FEE_MESSAGES[code]).toBeTruthy();
  });
});

const month = (m: string, due: string, charge: number, got: number): FeeMonth => ({
  month: m,
  charge,
  paid: got,
  fromAdvance: 0,
  got,
  due,
  status: got >= charge ? 'paid' : got > 0 ? 'partial' : 'unpaid',
  overdue: due < '2026-11-14' && got < charge,
});

describe('feeTelegramDue — месяцы долга и срок (pgFeeDue)', () => {
  const months = [
    month('2026-08', '2026-08-10', 500_000, 500_000),
    month('2026-09', '2026-09-10', 500_000, 200_000),
    month('2026-10', '2026-10-10', 500_000, 0),
    month('2026-11', '2026-11-20', 500_000, 0),
  ];

  it('месяцы с наступившим сроком и недоплатой; срок — день оплаты месяца после последнего', () => {
    expect(feeTelegramDue({ months }, 20, '2026-11-14')).toEqual({
      months: ['2026-09', '2026-10'],
      payBy: '2026-11-20',
    });
  });

  it('срок не раньше завтрашнего дня: прошедший и сегодняшний — завтра', () => {
    expect(feeTelegramDue({ months }, 10, '2026-11-14').payBy).toBe('2026-11-15');
    expect(feeTelegramDue({ months }, 14, '2026-11-14').payBy).toBe('2026-11-15');
  });

  it('месяцев с наступившим сроком нет — срок завтра', () => {
    expect(feeTelegramDue({ months: [months[3]!] }, 20, '2026-11-14')).toEqual({
      months: [],
      payBy: '2026-11-15',
    });
  });
});

describe('feeBotMessage — сообщение клиенту (pgFeeMsg)', () => {
  const requisite = {
    text: 'Реквизиты для перевода — организации «Бухгалтер Плюс»\nБанк: Оптима Банк\nСчёт: 1090123456789012',
    copy: { text: 'Скопировать реквизиты для перевода', copy: 'Банк: Оптима Банк' },
  };
  const message = feeBotMessage({
    heading: 'Оплата за обслуживание до 20.11.2026',
    contractor: 'ОсОО «Ромашка»',
    text: 'Долг за обслуживание — 5 000,00 сом (октябрь 2026). Пожалуйста, оплатите до 20.11.2026.',
    requisite,
    paid: 'Оплатил',
  });

  it('заголовок со сроком, контрагент, текст сотрудника и реквизиты в конце', () => {
    expect(message.heading).toBe('Оплата за обслуживание до 20.11.2026');
    expect(message.sub).toBe('ОсОО «Ромашка»');
    expect(message.text).toBe(
      `Долг за обслуживание — 5 000,00 сом (октябрь 2026). Пожалуйста, оплатите до 20.11.2026.\n\n${requisite.text}`,
    );
    expect(botMessageProblem(message)).toBeNull();
    expect(botPlainText(message)).toContain('Реквизиты для перевода — организации');
  });

  it('кнопки: копирование по виду реквизита, ниже «Оплатил» — с меткой «fee», без суммы', () => {
    expect(message.buttons).toEqual([
      [requisite.copy],
      [{ text: 'Оплатил', action: CP_TG_PAID_ACTION, arg: 'fee' }],
    ]);
    expect(findBotButton(message, CP_TG_PAID_ACTION, 'fee')).toBeTruthy();
    expect(botKeyboard(message)).toBeTruthy();
  });

  it('кнопки копирования нет (длинный текст) — только «Оплатил»', () => {
    const m = feeBotMessage({
      heading: 'h',
      contractor: 'c',
      text: 't',
      requisite: { ...requisite, copy: null },
      paid: 'Оплатил',
    });
    expect(m.buttons).toEqual([[{ text: 'Оплатил', action: CP_TG_PAID_ACTION, arg: 'fee' }]]);
  });

  it('клиент может отправлять файлы — рядом с «Оплатил» «Прислать чек» (прототип v115 pgFeeBtns)', () => {
    const m = feeBotMessage({
      heading: 'h',
      contractor: 'c',
      text: 't',
      requisite: { ...requisite, copy: null },
      paid: 'Оплатил',
      receipt: 'Прислать чек',
    });
    expect(m.buttons).toEqual([
      [
        { text: 'Оплатил', action: CP_TG_PAID_ACTION, arg: 'fee' },
        { text: 'Прислать чек', action: CP_TG_RECEIPT_ACTION, arg: 'fee' },
      ],
    ]);
  });
});
