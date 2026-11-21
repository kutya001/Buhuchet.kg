import { describe, expect, it } from 'vitest';
import { fillTemplate, TELEGRAM_TEMPLATE_DEFAULTS } from '../telegram/messages';
import {
  memoryWarnEvent,
  memoryWarnLevel,
  SUB_EVENT_TEMPLATES,
  subOwnerValues,
  subscriptionCheckWait,
  subscriptionGbText,
  subscriptionReminder,
} from './notify';
import { SUBSCRIPTION_MB_BYTES } from './subscriptions';

const GB = 1000 * SUBSCRIPTION_MB_BYTES;

describe('subscriptionReminder — за 7 дней и каждый день до оплаты (прототип subRemindText)', () => {
  const base = { pending: false, today: '2026-11-20' as const, remindDays: 7 };

  it('за 8 дней молчит, за 7 и в последний день — «истекает» с днями', () => {
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-28' })).toBeNull();
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-27' })).toEqual({
      event: 'soon',
      days: 7,
    });
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-20' })).toEqual({
      event: 'soon',
      days: 0,
    });
  });

  it('на следующий день после «Оплачено до» и дальше — «просрочена»', () => {
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-19' })).toEqual({ event: 'over' });
    expect(subscriptionReminder({ ...base, paidUntil: '2026-10-01' })).toEqual({ event: 'over' });
  });

  it('чек на проверке и «Нет подписки» — без напоминаний; срок напоминаний — из настроек', () => {
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-19', pending: true })).toBeNull();
    expect(subscriptionReminder({ ...base, paidUntil: null })).toBeNull();
    expect(subscriptionReminder({ ...base, paidUntil: '2026-11-30', remindDays: 10 })).toEqual({
      event: 'soon',
      days: 10,
    });
  });
});

describe('память 80 % и 100 % — один раз, пока занятое не опустится ниже порога', () => {
  it('порог по занятому и пределу', () => {
    expect(memoryWarnLevel(0, 10 * GB)).toBe(0);
    expect(memoryWarnLevel(8 * GB - 1, 10 * GB)).toBe(0);
    expect(memoryWarnLevel(8 * GB, 10 * GB)).toBe(80);
    expect(memoryWarnLevel(10 * GB - 1, 10 * GB)).toBe(80);
    expect(memoryWarnLevel(10 * GB, 10 * GB)).toBe(100);
    expect(memoryWarnLevel(12 * GB, 10 * GB)).toBe(100);
    expect(memoryWarnLevel(12 * GB, null)).toBe(0);
    expect(memoryWarnLevel(12 * GB, 0)).toBe(0);
  });

  it('сообщение — только при подъёме порога; после спуска ниже — снова', () => {
    expect(memoryWarnEvent(0, 80)).toBe('mem80');
    expect(memoryWarnEvent(80, 80)).toBeNull();
    expect(memoryWarnEvent(80, 100)).toBe('memfull');
    expect(memoryWarnEvent(0, 100)).toBe('memfull');
    expect(memoryWarnEvent(100, 80)).toBeNull();
    expect(memoryWarnEvent(80, 100)).toBe('memfull');
    expect(memoryWarnEvent(100, 0)).toBeNull();
    expect(memoryWarnEvent(0, 80)).toBe('mem80');
  });
});

describe('subscriptionGbText — «9,4 из 14 ГБ» (прототип subGb)', () => {
  it('один знак после запятой, целое — без «,0»', () => {
    expect(subscriptionGbText(14 * GB)).toBe('14');
    expect(subscriptionGbText(9_400 * SUBSCRIPTION_MB_BYTES)).toBe('9,4');
    expect(subscriptionGbText(9_449 * SUBSCRIPTION_MB_BYTES)).toBe('9,4');
    expect(subscriptionGbText(9_450 * SUBSCRIPTION_MB_BYTES)).toBe('9,5');
    expect(subscriptionGbText(0)).toBe('0');
    expect(subscriptionGbText(40 * SUBSCRIPTION_MB_BYTES)).toBe('0');
  });
});

describe('subscriptionCheckWait — чек на проверке (блок 6, пункт 3)', () => {
  it('в день чека повтора нет, со следующего — каждый день; дольше 3 дней — «больше 3 дней»', () => {
    expect(subscriptionCheckWait('2026-11-20', '2026-11-20', 3)).toEqual({
      days: 0,
      repeat: false,
      late: false,
    });
    expect(subscriptionCheckWait('2026-11-20', '2026-11-21', 3)).toEqual({
      days: 1,
      repeat: true,
      late: false,
    });
    expect(subscriptionCheckWait('2026-11-20', '2026-11-23', 3).late).toBe(false);
    expect(subscriptionCheckWait('2026-11-20', '2026-11-24', 3)).toEqual({
      days: 4,
      repeat: true,
      late: true,
    });
  });
});

describe('тексты владельцам — шаблоны tgSub* с подстановками прототипа', () => {
  const fill = (e: Parameters<typeof subOwnerValues>[0]) =>
    fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[SUB_EVENT_TEMPLATES[e.event]], subOwnerValues(e));

  it('«истекает» и «просрочена» — дата, дни и сумма продления в сомах', () => {
    expect(
      fill({ event: 'soon', org: 'Финконсалт', paidUntil: '2026-11-30', days: 3, renew: 285_000 }),
    ).toBe(
      '⏳ Подписка «Финконсалт» оплачена до 30.11.2026, осталось дней: 3. Продлите её, чтобы доступ не закрылся: продление на тот же срок и пакет — 2 850 сом.',
    );
    expect(fill({ event: 'over', org: 'Ф', paidUntil: '2026-11-19', renew: 100_050 })).toContain(
      'срок закончился 19.11.2026',
    );
    expect(fill({ event: 'over', org: 'Ф', paidUntil: '2026-11-19', renew: 100_050 })).toContain(
      '1 000,50 сом',
    );
  });

  it('итог проверки и память', () => {
    expect(fill({ event: 'paid', org: 'Ф', paidUntil: '2027-02-28' })).toBe(
      '✅ Оплата подтверждена: подписка «Ф» действует до 28.02.2027.',
    );
    expect(fill({ event: 'rejected', org: 'Ф', reason: 'сумма не совпадает' })).toContain(
      'отклонён: сумма не совпадает.',
    );
    expect(
      fill({
        event: 'mem80',
        org: 'Ф',
        usedBytes: 11_200 * SUBSCRIPTION_MB_BYTES,
        limitBytes: 14 * GB,
      }),
    ).toContain('занято 11,2 из 14 ГБ');
    expect(fill({ event: 'memfull', org: 'Ф', usedBytes: 14 * GB, limitBytes: 14 * GB })).toContain(
      'Память «Ф» заполнена: занято 14 из 14 ГБ',
    );
  });
});
