import { describe, expect, it } from 'vitest';
import { BOT_COPY_MAX, botKeyboard, botMessageProblem } from '../telegram/bot-message';
import {
  transferBlock,
  transferBotMessage,
  transferCopyButton,
  transferLines,
  transferText,
  type TransferRequisite,
} from './telegram-requisite';

/*
 * Реквизиты для перевода в сообщениях клиенту (доработки 14.11.2026, блок 4, пункты 1–3; прототип v110
 * modules/cp-telegram.js: pgRqLines, pgRqText, pgRqBtn, tgAct('cp-req')).
 */

const labels = {
  phone: 'Перевод по номеру телефона',
  banks: 'Банки и кошельки',
  bank: 'Банк',
  wallet: 'Банк или кошелёк',
  account: 'Счёт',
  bik: 'БИК',
  holder: 'Получатель',
  copyPhone: 'Скопировать номер телефона',
  copyRequisites: 'Скопировать реквизиты для перевода',
};
const copyLabels = { phone: labels.copyPhone, requisites: labels.copyRequisites };

const orgAccount: TransferRequisite = {
  owner: 'org',
  kind: 'acc',
  phoneText: '',
  bankNames: ['Оптима Банк'],
  accountNo: '1090123456789012',
  bik: '109001',
  holderName: 'ОсОО «Бухгалтер Плюс»',
};
const phone: TransferRequisite = {
  owner: 'employee',
  kind: 'phone',
  phoneText: '0555 123 456',
  bankNames: ['MBank', 'О!Деньги'],
  accountNo: null,
  bik: null,
  holderName: 'Асанова Айгуль',
};
const wallet: TransferRequisite = {
  owner: 'employee',
  kind: 'acc',
  phoneText: '',
  bankNames: ['Элсом'],
  accountNo: '996555123456',
  bik: null,
  holderName: 'Асанова Айгуль',
};

describe('Строки реквизита (прототип pgRqLines)', () => {
  it('расчётный счёт организации: банк, счёт, БИК, получатель', () => {
    expect(transferLines(orgAccount, labels)).toEqual([
      'Банк: Оптима Банк',
      'Счёт: 1090123456789012',
      'БИК: 109001',
      'Получатель: ОсОО «Бухгалтер Плюс»',
    ]);
  });

  it('номер телефона: номер, банки и кошельки, получатель', () => {
    expect(transferLines(phone, labels)).toEqual([
      'Перевод по номеру телефона: 0555 123 456',
      'Банки и кошельки: MBank, О!Деньги',
      'Получатель: Асанова Айгуль',
    ]);
  });

  it('счёт или кошелёк сотрудника: «Банк или кошелёк», счёт, получатель, без БИК', () => {
    expect(transferLines(wallet, labels)).toEqual([
      'Банк или кошелёк: Элсом',
      'Счёт: 996555123456',
      'Получатель: Асанова Айгуль',
    ]);
  });

  it('пустые значения не выводятся', () => {
    expect(transferLines({ ...orgAccount, bik: null, holderName: ' ' }, labels)).toEqual([
      'Банк: Оптима Банк',
      'Счёт: 1090123456789012',
    ]);
  });

  it('блок — заголовок «Реквизиты для перевода — …» и строки', () => {
    expect(
      transferText('Реквизиты для перевода — организации ОсОО «Бухгалтер Плюс»', ['A', 'B']),
    ).toBe('Реквизиты для перевода — организации ОсОО «Бухгалтер Плюс»\nA\nB');
  });
});

describe('Кнопка копирования по виду реквизита (прототип pgRqBtn)', () => {
  it('номер телефона — «Скопировать номер телефона», только цифры номера без пробелов', () => {
    expect(transferCopyButton(phone, transferLines(phone, labels), copyLabels)).toEqual({
      text: 'Скопировать номер телефона',
      copy: '0555123456',
    });
  });

  it('счёт — «Скопировать реквизиты для перевода», строки реквизита', () => {
    const lines = transferLines(orgAccount, labels);
    expect(transferCopyButton(orgAccount, lines, copyLabels)).toEqual({
      text: 'Скопировать реквизиты для перевода',
      copy: lines.join('\n'),
    });
    expect(transferCopyButton(wallet, transferLines(wallet, labels), copyLabels)?.text).toBe(
      'Скопировать реквизиты для перевода',
    );
  });

  it('длиннее предела кнопки копирования — кнопки нет (реквизиты и так в тексте)', () => {
    const long = { ...orgAccount, holderName: 'О'.repeat(BOT_COPY_MAX) };
    expect(transferCopyButton(long, transferLines(long, labels), copyLabels)).toBeNull();
  });

  it('блок одним вызовом: текст и кнопка', () => {
    const block = transferBlock(
      phone,
      'Реквизиты для перевода — сотрудника Асанова Айгуль',
      labels,
    );
    expect(block.text).toBe(
      'Реквизиты для перевода — сотрудника Асанова Айгуль\nПеревод по номеру телефона: 0555 123 456\nБанки и кошельки: MBank, О!Деньги\nПолучатель: Асанова Айгуль',
    );
    expect(block.copy).toEqual({ text: 'Скопировать номер телефона', copy: '0555123456' });
  });
});

describe('Сообщение по «Показать реквизиты для перевода» (прототип tgAct(cp-req))', () => {
  it('«Для налогов» или «Для обслуживания», контрагент, реквизиты без сумм и кнопка копирования', () => {
    const block = transferBlock(
      orgAccount,
      'Реквизиты для перевода — организации ОсОО «Бухгалтер Плюс»',
      labels,
    );
    const m = transferBotMessage({ heading: 'Для обслуживания', contractor: 'ИП Сыдыков', block });
    expect(m).toMatchObject({ heading: 'Для обслуживания', sub: 'ИП Сыдыков', text: block.text });
    expect(botKeyboard(m)).toEqual([
      [{ text: 'Скопировать реквизиты для перевода', copy: block.copy?.copy }],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    // Без кнопки копирования — сообщение без кнопок.
    expect(
      transferBotMessage({
        heading: 'Для налогов',
        contractor: 'ИП',
        block: { ...block, copy: null },
      }).buttons,
    ).toBeUndefined();
  });
});
