import { describe, expect, it } from 'vitest';
import { isValidOrgInn } from './inn';
import { defaultOrgPolicy } from './policy';
import { slugFree, slugOf } from './slug';

describe('defaultOrgPolicy — как TemDB.json прототипа', () => {
  it('включены задачи, календарь, Telegram и файлы, остальное выключено', () => {
    const p = defaultOrgPolicy();
    expect(
      Object.entries(p.features)
        .filter(([, on]) => on)
        .map(([f]) => f),
    ).toEqual(['tasks', 'calendar', 'telegram', 'files']);
    expect(Object.keys(p.features)).toHaveLength(11);
  });

  it('напоминания за 7 и 3 дня, сводка в 09:00, подтверждения и «Сдан» после оплаты включены', () => {
    expect(defaultOrgPolicy()).toMatchObject({
      remindDays: [7, 3],
      overdueRepeat: true,
      digestTime: '09:00',
      timezone: 'Asia/Bishkek',
      confirmWaitDays: 3,
      taskConfirm: true,
      reportConfirm: true,
      payBeforeSubmit: true,
    });
  });

  it('каждый вызов — новый объект', () => {
    const a = defaultOrgPolicy();
    a.remindDays.push(1);
    expect(defaultOrgPolicy().remindDays).toEqual([7, 3]);
  });
});

describe('slugOf и slugFree — как в прототипе', () => {
  it('форма собственности и кавычки отбрасываются, кириллица — латиницей', () => {
    expect(slugOf('ОсОО «Бухгалтер Плюс»')).toBe('buhgalter-plyus');
    expect(slugOf('ОсОО «Финконсалт Ош»')).toBe('finkonsalt-osh');
    expect(slugOf('ИП Үмөт Ңайза')).toBe('umot-ngaiza');
  });

  it('не длиннее 30 символов и без дефиса на конце', () => {
    const s = slugOf('ОсОО «Очень длинное название бухгалтерской фирмы»');
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.endsWith('-')).toBe(false);
  });

  it('первый свободный адрес', () => {
    expect(slugFree('buhgalter-plyus', [])).toBe('buhgalter-plyus');
    expect(slugFree('buhgalter-plyus', ['buhgalter-plyus'])).toBe('buhgalter-plyus-2');
    expect(slugFree('buhgalter-plyus', ['buhgalter-plyus', 'buhgalter-plyus-2'])).toBe(
      'buhgalter-plyus-3',
    );
    expect(slugFree('ab', [])).toBe('ab-org');
    expect(slugFree('', ['org'])).toBe('org-2');
    expect(slugFree('a'.repeat(30), ['a'.repeat(30)])).toBe(`${'a'.repeat(28)}-2`);
  });
});

describe('isValidOrgInn', () => {
  it('ровно 14 цифр', () => {
    expect(isValidOrgInn('01203201910123')).toBe(true);
    expect(isValidOrgInn('0120320191012')).toBe(false);
    expect(isValidOrgInn('0120320191012a')).toBe(false);
  });
});
