import { describe, expect, it } from 'vitest';
import { botMessageProblem, botPressData, BOT_ASK_CANCEL } from '../telegram/bot-message';
import { CP_TG_CLIENT_ACTIONS, CP_TG_FILE_TO_ACTION, CP_TG_RECEIPT_ACTION } from './telegram-pay';
import {
  CP_RECEIPT_EXTENSIONS,
  CP_TG_FILE_TO_MAX,
  cpReceiptArg,
  cpReceiptFileOk,
  fileToBotMessage,
  parseCpReceiptArg,
  receiptAskBotMessage,
  receiptOfferBotMessage,
} from './telegram-receipt';

const ID = '0b5c6f4e-2d1a-4c3b-9e8f-7a6b5c4d3e2f';

describe('чек через бота (прототип v115 cp-telegram.js)', () => {
  it('чек — фото или PDF: расширения как PG_RCPT_EXT, без учёта регистра', () => {
    expect([...CP_RECEIPT_EXTENSIONS]).toEqual([
      'pdf',
      'jpg',
      'jpeg',
      'png',
      'heic',
      'heif',
      'webp',
    ]);
    for (const name of [
      'чек.pdf',
      'Фото из Telegram 15.11.2026.jpg',
      'scan.JPEG',
      'a.heic',
      'b.WebP',
    ]) {
      expect(cpReceiptFileOk(name)).toBe(true);
    }
    for (const name of ['выписка.xlsx', 'чек.docx', 'pdf', '.pdf', 'чек', 'чек.pdf.exe']) {
      expect(cpReceiptFileOk(name)).toBe(false);
    }
  });

  it('данные кнопки «Прислать чек»: это сообщение или «К оплате» по номеру; чужие — null', () => {
    expect(cpReceiptArg('fee')).toBe('fee');
    expect(cpReceiptArg('tax', ID)).toBe(`tax.${ID}`);
    // Данные помещаются в кнопку Telegram (64 байта, идентификатор — до 40 знаков).
    expect(botPressData(CP_TG_RECEIPT_ACTION, cpReceiptArg('tax', ID))).toBe(`cpReceipt:tax.${ID}`);
    expect(parseCpReceiptArg('fee')).toEqual({ purpose: 'fee', paidId: null });
    expect(parseCpReceiptArg('tax')).toEqual({ purpose: 'tax', paidId: null });
    expect(parseCpReceiptArg(`tax.${ID}`)).toEqual({ purpose: 'tax', paidId: ID });
    expect(parseCpReceiptArg(`fee.${ID}`)).toEqual({ purpose: 'fee', paidId: ID });
    for (const bad of [
      null,
      '',
      'debt',
      `tax.${ID.toUpperCase()}`,
      'tax.1',
      `x.${ID}`,
      `tax.${ID}x`,
    ]) {
      expect(parseCpReceiptArg(bad)).toBeNull();
    }
  });

  it('предложение после «Оплатил» — текст и кнопка «Прислать чек»', () => {
    const m = receiptOfferBotMessage({
      text: 'Пришлите чек',
      button: 'Прислать чек',
      arg: `tax.${ID}`,
    });
    expect(m).toEqual({
      text: 'Пришлите чек',
      buttons: [[{ text: 'Прислать чек', action: CP_TG_RECEIPT_ACTION, arg: `tax.${ID}` }]],
    });
    expect(botMessageProblem(m)).toBeNull();
  });

  it('просьба «Пришлите чек» — ждёт файл до конца дня, под ней «Отмена»; «Отмена» — кнопка клиента', () => {
    const m = receiptAskBotMessage({
      text: 'Пришлите чек ответом',
      cancel: 'Отмена',
      arg: 'fee',
      day: '2026-11-15',
    });
    expect(m.ask).toEqual({
      action: CP_TG_RECEIPT_ACTION,
      arg: 'fee',
      kind: 'file',
      day: '2026-11-15',
    });
    expect(m.buttons).toEqual([[{ text: 'Отмена', action: BOT_ASK_CANCEL }]]);
    expect(botMessageProblem(m)).toBeNull();
    expect(CP_TG_CLIENT_ACTIONS).toContain(BOT_ASK_CANCEL);
    expect(CP_TG_CLIENT_ACTIONS).toContain(CP_TG_RECEIPT_ACTION);
  });

  it('«От какой компании?» — кнопка на подключение, по одной в ряду, длинное название с многоточием', () => {
    const long = 'ОсОО «' + 'Очень длинное название'.repeat(4) + '»';
    const m = fileToBotMessage({
      text: 'От какой компании?',
      links: [
        { arg: 'l1', name: 'ОсОО «Ала-Тоо»' },
        { arg: 'l2', name: `  ИП   Асанов \n Б.  ` },
        { arg: 'l3', name: long },
      ],
    });
    expect(m.buttons?.map((r) => r.map((b) => [b.text, b.action, b.arg]))).toEqual([
      [['ОсОО «Ала-Тоо»', CP_TG_FILE_TO_ACTION, 'l1']],
      [['ИП Асанов Б.', CP_TG_FILE_TO_ACTION, 'l2']],
      [[`${long.slice(0, 63)}…`, CP_TG_FILE_TO_ACTION, 'l3']],
    ]);
    expect(botMessageProblem(m)).toBeNull();
    const many = fileToBotMessage({
      text: 'От какой компании?',
      links: Array.from({ length: 25 }, (_, i) => ({ arg: `l${i}`, name: `К${i}` })),
    });
    expect(many.buttons).toHaveLength(CP_TG_FILE_TO_MAX);
  });
});
