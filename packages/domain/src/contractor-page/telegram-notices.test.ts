import { describe, expect, it } from 'vitest';
import {
  CP_NOTICE_AT_DEFAULT,
  cpNoticeAt,
  cpNoticeDayDue,
  cpNoticeDays,
  cpNoticeSettings,
  cpNoticeDay,
  feeSoon,
  feeSoonBotMessage,
} from './telegram-notices';
import { CP_TG_PAID_ACTION, CP_TG_RECEIPT_ACTION } from './telegram-pay';

describe('строки «К оплате» и «Оплата за обслуживание» (прототип v115)', () => {
  it('дни — по порядку строки от «за 5», без повторов и чужих чисел; пусто — «за 5» (pgDaysOf)', () => {
    expect(cpNoticeDays([1, 3, 5])).toEqual([5, 3, 1]);
    expect(cpNoticeDays([2, 2, 9, 0])).toEqual([2]);
    expect(cpNoticeDays([])).toEqual([5]);
    expect(cpNoticeDays(null)).toEqual([5]);
    expect(cpNoticeDays(undefined)).toEqual([5]);
  });

  it('время — «ЧЧ:ММ»; из базы «ЧЧ:ММ:СС», пусто или не время — 10:00', () => {
    expect(cpNoticeAt('08:30:00')).toBe('08:30');
    expect(cpNoticeAt('23:59')).toBe('23:59');
    expect(cpNoticeAt(null)).toBe(CP_NOTICE_AT_DEFAULT);
    expect(cpNoticeAt('24:00')).toBe('10:00');
    expect(cpNoticeAt('9:00')).toBe('10:00');
  });

  it('нет строк — «за 5 дней» в 10:00, долг — по понедельникам', () => {
    expect(cpNoticeSettings({})).toEqual({
      payDays: [5],
      payAt: '10:00',
      feeDays: [5],
      feeAt: '10:00',
      debtWeekDay: 1,
    });
    expect(
      cpNoticeSettings({
        pay: { days: [1, 2], atTime: '09:15:00', weekday: null },
        fee: { days: [3], atTime: '18:00:00', weekday: 5 },
      }),
    ).toEqual({ payDays: [2, 1], payAt: '09:15', feeDays: [3], feeAt: '18:00', debtWeekDay: 5 });
  });

  it('время отправки попадает ровно в один запуск задачи (раз в 5 минут) — и в свой день', () => {
    // Запуск — по Бишкеку (UTC+6): 10:00 по Бишкеку — 04:00 UTC.
    const slot = (iso: string) => new Date(iso);
    expect(cpNoticeDay('10:00', slot('2026-11-20T04:00:00Z'))).toBe('2026-11-20');
    expect(cpNoticeDay('09:56', slot('2026-11-20T04:00:00Z'))).toBe('2026-11-20');
    expect(cpNoticeDay('09:55', slot('2026-11-20T04:00:00Z'))).toBeNull();
    expect(cpNoticeDay('10:01', slot('2026-11-20T04:00:00Z'))).toBeNull();
    expect(cpNoticeDay('10:03', slot('2026-11-20T04:05:00Z'))).toBe('2026-11-20');
    // 23:58 приходится на запуск 00:00 следующего дня — и на свой день.
    expect(cpNoticeDay('23:58', slot('2026-11-20T18:00:00Z'))).toBe('2026-11-20');
    expect(cpNoticeDay('00:00', slot('2026-11-20T18:00:00Z'))).toBe('2026-11-21');
    // Секунды запуска не мешают.
    expect(cpNoticeDay('10:00', slot('2026-11-20T04:00:40Z'))).toBe('2026-11-20');
    // Каждое время суток — ровно в одном запуске из 288 и в свой день.
    const day = Date.parse('2026-11-19T18:00:00Z'); // 00:00 20.11 по Бишкеку
    const runs = Array.from({ length: 289 }, (_, i) => new Date(day + i * 5 * 60_000));
    for (const at of ['00:00', '00:04', '07:31', '10:00', '13:44', '23:59']) {
      const hits = runs.map((r) => cpNoticeDay(at, r)).filter((d) => d === '2026-11-20');
      expect(hits).toHaveLength(1);
    }
  });

  it('отмеченный день — до срока ровно N дней', () => {
    expect(cpNoticeDayDue('2026-11-20', '2026-11-25', [5])).toBe(true);
    expect(cpNoticeDayDue('2026-11-21', '2026-11-25', [5])).toBe(false);
    expect(cpNoticeDayDue('2026-11-24', '2026-11-25', [5, 1])).toBe(true);
    expect(cpNoticeDayDue('2026-11-25', '2026-11-25', [5, 4, 3, 2, 1])).toBe(false);
    expect(cpNoticeDayDue('2026-11-27', '2026-12-01', [4])).toBe(true);
  });
});

describe('«Оплата за обслуживание до …» (прототип v115 pgFeeSoon)', () => {
  const row = (month: string, charge: number, got: number, due: string) => ({
    month,
    charge,
    got,
    due,
  });

  it('ближайшее неоплаченное начисление этого месяца со сроком позже сегодняшнего', () => {
    const months = [
      row('2026-10', 500000, 500000, '2026-10-10'),
      row('2026-11', 500000, 0, '2026-11-20'),
    ];
    expect(feeSoon(months, '2026-11-15', new Set())).toEqual({
      month: '2026-11',
      due: '2026-11-20',
      sum: 500000,
    });
  });

  it('остаток — без полученного; срок этого месяца прошёл — следующий месяц', () => {
    const months = [
      row('2026-11', 500000, 200000, '2026-11-10'),
      row('2026-12', 500000, 100000, '2026-12-10'),
    ];
    expect(feeSoon(months, '2026-11-15', new Set())).toEqual({
      month: '2026-12',
      due: '2026-12-10',
      sum: 400000,
    });
  });

  it('в день срока, оплаченный месяц, «Оплатил» за месяц и без начисления — ничего', () => {
    expect(feeSoon([row('2026-11', 500000, 0, '2026-11-15')], '2026-11-15', new Set())).toBeNull();
    expect(
      feeSoon([row('2026-11', 500000, 500000, '2026-11-20')], '2026-11-15', new Set()),
    ).toBeNull();
    expect(
      feeSoon([row('2026-11', 500000, 0, '2026-11-20')], '2026-11-15', new Set(['2026-11'])),
    ).toBeNull();
    expect(feeSoon([row('2026-11', 0, 0, '2026-11-20')], '2026-11-15', new Set())).toBeNull();
    expect(feeSoon([], '2026-11-15', new Set())).toBeNull();
    // Месяц через один — уже не «ближайший».
    expect(feeSoon([row('2027-01', 500000, 0, '2027-01-10')], '2026-11-15', new Set())).toBeNull();
  });

  it('сообщение: реквизиты в конце текста, копирование, «Оплатил» и «Прислать чек»', () => {
    const m = feeSoonBotMessage({
      heading: 'Оплата за обслуживание до 20.11.2026',
      contractor: 'ОсОО «Ромашка»',
      text: 'Оплатите обслуживание',
      requisite: {
        text: 'Реквизиты для перевода — организация',
        copy: { text: 'Скопировать номер счёта', copy: '1234' },
      },
      paid: 'Оплатил',
      receipt: 'Прислать чек',
    });
    expect(m.text).toBe('Оплатите обслуживание\n\nРеквизиты для перевода — организация');
    expect(m.sub).toBe('ОсОО «Ромашка»');
    expect(m.buttons).toEqual([
      [{ text: 'Скопировать номер счёта', copy: '1234' }],
      [
        { text: 'Оплатил', action: CP_TG_PAID_ACTION, arg: 'fee' },
        { text: 'Прислать чек', action: CP_TG_RECEIPT_ACTION, arg: 'fee' },
      ],
    ]);
  });

  it('без реквизитов и без «Прислать чек» — только текст и «Оплатил»', () => {
    const m = feeSoonBotMessage({
      heading: 'h',
      contractor: 'c',
      text: 'Оплатите',
      requisite: null,
      paid: 'Оплатил',
      receipt: null,
    });
    expect(m.text).toBe('Оплатите');
    expect(m.buttons).toEqual([[{ text: 'Оплатил', action: CP_TG_PAID_ACTION, arg: 'fee' }]]);
  });
});
