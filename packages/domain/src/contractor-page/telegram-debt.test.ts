import { describe, expect, it } from 'vitest';
import { formatSom } from '../common/money';
import { UI_TEXTS } from '../l10n/texts';
import {
  botKeyboard,
  botMessageProblem,
  botPlainText,
  findBotButton,
} from '../telegram/bot-message';
import { TELEGRAM_TEMPLATE_DEFAULTS } from '../telegram/messages';
import {
  cpDebt,
  cpTgDebtOnCommand,
  DEBT_TOGGLE_MESSAGES,
  DEBT_TOGGLE_REFUSALS,
  debtBotMessage,
  debtReminderDue,
  debtToggleRefusal,
  debtWeek,
} from './telegram-debt';
import { CP_TG_CLIENT_ACTIONS, CP_TG_NODEBT_ACTION, CP_TG_REQ_ACTION } from './telegram-pay';
import { parseCpReqArg } from './telegram-requisite';

/*
 * Напоминание клиенту о долге (доработки 13.11.2026, задача К5; прототип v94 modules/cp-telegram.js:
 * pgDebt, pgDebtTo, pgDebtMsg, pgDebtWhy).
 */

const labels = {
  heading: 'Напоминание об оплате',
  what: 'Что оплатить',
  amount: 'Сумма, сом',
  short: 'Не хватает на налоги этого месяца',
  fee: 'Долг за обслуживание',
  showRequisites: 'Показать реквизиты для перевода',
  noDebt: 'Не напоминать',
};

describe('Долг для напоминания (прототип pgDebt)', () => {
  it('складывается из недостачи на налоги и долга за обслуживание', () => {
    expect(cpDebt({ fee: 150_000, short: 2_500_50 })).toEqual({
      fee: 150_000,
      short: 2_500_50,
      sum: 4_000_50,
    });
  });

  it('выключенная функция (null), ноль и переплата в долг не входят', () => {
    expect(cpDebt({ fee: null, short: 100 })).toEqual({ fee: 0, short: 100, sum: 100 });
    expect(cpDebt({ fee: 100, short: null })).toEqual({ fee: 100, short: 0, sum: 100 });
    expect(cpDebt({ fee: 0, short: -500 })).toEqual({ fee: 0, short: 0, sum: 0 });
    expect(cpDebt({ fee: null, short: null }).sum).toBe(0);
  });
});

describe('Кому и когда напоминать (прототип pgDebtTo)', () => {
  const debt = cpDebt({ fee: 100, short: 0 });
  const ok = { orgOn: true, contractorOff: false, archived: false, debt };

  it('организация включила, у контрагента не выключено, не архив, долг есть', () => {
    expect(debtReminderDue(ok)).toBe(true);
    expect(debtReminderDue({ ...ok, orgOn: false })).toBe(false);
    expect(debtReminderDue({ ...ok, contractorOff: true })).toBe(false);
    expect(debtReminderDue({ ...ok, archived: true })).toBe(false);
    expect(debtReminderDue({ ...ok, debt: cpDebt({ fee: 0, short: 0 }) })).toBe(false);
  });

  it('неделя напоминания — её понедельник', () => {
    expect(debtWeek('2026-11-16')).toBe('2026-11-16');
    expect(debtWeek('2026-11-17')).toBe('2026-11-16');
    expect(debtWeek('2026-11-22')).toBe('2026-11-16');
    expect(debtWeek('2026-11-23')).toBe('2026-11-23');
    // Через границу года.
    expect(debtWeek('2027-01-01')).toBe('2026-12-28');
  });
});

describe('Переключатель в карточке (прототип pgDebtWhy)', () => {
  it('порядок причин: право, затем выключено у организации', () => {
    expect(debtToggleRefusal({ canManagePage: true, orgOn: true })).toBeNull();
    expect(debtToggleRefusal({ canManagePage: false, orgOn: false })).toBe('page_debt_right');
    expect(debtToggleRefusal({ canManagePage: true, orgOn: false })).toBe('page_debt_org_off');
  });

  it('у каждой причины есть текст — тот же, что в словаре', () => {
    for (const code of DEBT_TOGGLE_REFUSALS) {
      expect(DEBT_TOGGLE_MESSAGES[code]).toBeTruthy();
      expect(UI_TEXTS[`err.${code}`].ru).toBe(DEBT_TOGGLE_MESSAGES[code]);
    }
    expect(DEBT_TOGGLE_MESSAGES.page_debt_right).toBe(
      'Нужно право «Управлять страницей контрагента»',
    );
  });
});

describe('Команда «Напоминать»', () => {
  it('принимается слово в любом регистре, в кавычках, с точкой и косой чертой', () => {
    for (const text of [
      'Напоминать',
      ' напоминать ',
      '«Напоминать»',
      'НАПОМИНАТЬ.',
      '/напоминать',
    ]) {
      expect(cpTgDebtOnCommand(text)).toBe(true);
    }
  });

  it('другой текст командой не считается', () => {
    for (const text of ['Не напоминать', 'напоминать о долге', 'Отключить', '', 'напомнить']) {
      expect(cpTgDebtOnCommand(text)).toBe(false);
    }
  });
});

describe('Сообщение (прототип v110 pgDebtMsg)', () => {
  const base = {
    contractor: 'ОсОО «Ала-Тоо Трейд»',
    debt: cpDebt({ fee: 500_000, short: 1_250_50 }),
    requisites: { tax: true, fee: true },
    text: 'К оплате 6 250,50 сом. Пожалуйста, оплатите или напишите вашему бухгалтеру.',
    labels,
  };
  const show = (arg: string) => ({
    text: 'Показать реквизиты для перевода',
    action: CP_TG_REQ_ACTION,
    arg,
  });

  it('заголовок, контрагент, текст, таблица; одна кнопка «Показать реквизиты для перевода» на оба вида долга и «Не напоминать»', () => {
    const m = debtBotMessage(base);
    expect(m.heading).toBe('Напоминание об оплате');
    expect(m.sub).toBe('ОсОО «Ала-Тоо Трейд»');
    expect(m.text).toBe(base.text);
    expect(m.tables).toEqual([
      {
        head: ['Что оплатить', 'Сумма, сом'],
        rows: [
          ['Не хватает на налоги этого месяца', formatSom(1_250_50)],
          ['Долг за обслуживание', formatSom(500_000)],
        ],
        numeric: [1],
      },
    ]);
    expect(m.buttons).toEqual([
      [show('tax-fee')],
      [{ text: 'Не напоминать', action: CP_TG_NODEBT_ACTION }],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    expect(findBotButton(m, CP_TG_REQ_ACTION, 'tax-fee')).not.toBeNull();
    expect(findBotButton(m, CP_TG_NODEBT_ACTION, null)).not.toBeNull();
    expect(botKeyboard(m)).toEqual([
      [{ text: 'Показать реквизиты для перевода', data: 'cpReq:tax-fee' }],
      [{ text: 'Не напоминать', data: 'cpNoDebt' }],
    ]);
    expect(botPlainText(m)).toContain('Напоминание об оплате');
  });

  it('только долг за обслуживание — реквизиты только для обслуживания; только недостача — только для налогов', () => {
    const fee = debtBotMessage({ ...base, debt: cpDebt({ fee: 500_000, short: 0 }) });
    expect(fee.tables?.[0]?.rows).toEqual([['Долг за обслуживание', formatSom(500_000)]]);
    expect(fee.buttons?.[0]).toEqual([show('fee')]);
    const tax = debtBotMessage({ ...base, debt: cpDebt({ fee: 0, short: 100 }) });
    expect(tax.tables?.[0]?.rows).toEqual([['Не хватает на налоги этого месяца', '1,00']]);
    expect(tax.buttons?.[0]).toEqual([show('tax')]);
  });

  it('реквизитов нет ни для одного вида — кнопки «Показать реквизиты» нет, «Не напоминать» остаётся', () => {
    const m = debtBotMessage({ ...base, requisites: { tax: false, fee: false } });
    expect(m.buttons).toEqual([[{ text: 'Не напоминать', action: CP_TG_NODEBT_ACTION }]]);
    expect(debtBotMessage({ ...base, requisites: { tax: false, fee: true } }).buttons?.[0]).toEqual(
      [show('fee')],
    );
  });

  it('`arg` кнопки разбирается обратно; неизвестное — ничего', () => {
    expect(parseCpReqArg('tax-fee')).toEqual({ tax: true, fee: true });
    expect(parseCpReqArg('fee')).toEqual({ tax: false, fee: true });
    expect(parseCpReqArg('x')).toEqual({ tax: false, fee: false });
    expect(parseCpReqArg(undefined)).toEqual({ tax: false, fee: false });
  });
});

describe('Тексты бота и коды действий', () => {
  it('шаблоны — как в справочнике прототипа', () => {
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgCpDebt).toBe(
      'К оплате {сумма}. Пожалуйста, оплатите или напишите вашему бухгалтеру.',
    );
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpNoDebt).toBe('Не напоминать');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgCpNoDebtOk).toBe(
      'Напоминания о долге выключены. Чтобы включить снова, отправьте боту «Напоминать».',
    );
    // Прототип v110: прежние кнопки реквизитов убраны, вместо них — кнопки по виду реквизита.
    expect(TELEGRAM_TEMPLATE_DEFAULTS).not.toHaveProperty('tgBtnCpReq');
    expect(TELEGRAM_TEMPLATE_DEFAULTS).not.toHaveProperty('tgBtnCpReqTax');
    expect(TELEGRAM_TEMPLATE_DEFAULTS).not.toHaveProperty('tgBtnCpReqFee');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpShowReq).toBe('Показать реквизиты для перевода');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpCopyPhone).toBe('Скопировать номер телефона');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpCopyReq).toBe('Скопировать реквизиты для перевода');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpOk).toBe('Подтвердить');
    expect(TELEGRAM_TEMPLATE_DEFAULTS.tgBtnCpNo).toBe('Отклонить');
  });

  it('«Не напоминать» и «Показать реквизиты для перевода» — действия клиента', () => {
    expect(CP_TG_CLIENT_ACTIONS).toContain(CP_TG_NODEBT_ACTION);
    expect(CP_TG_CLIENT_ACTIONS).toContain(CP_TG_REQ_ACTION);
  });
});
