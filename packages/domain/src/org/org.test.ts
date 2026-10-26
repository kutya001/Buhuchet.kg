import { describe, expect, it } from 'vitest';
import { isValidOrgInn } from './inn';
import { defaultOrgPolicy } from './policy';
import { LOGO_MAX_BYTES, logoImageType, logoProblem } from './profile';
import { RESERVED_SLUGS, slugFree, slugOf, slugProblem } from './slug';

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
      pageSections: ['pay', 'reports', 'money', 'fee', 'kpi', 'contacts'],
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

  it('занятые слова программы не предлагаются', () => {
    expect(slugFree('demo', [])).toBe('demo-2');
    expect(slugFree('admin', ['admin-2'])).toBe('admin-3');
  });
});

describe('slugProblem — адрес страницы организации (прототип v58, slugErr)', () => {
  it('формат: 3–30 символов, строчные латинские буквы, цифры и дефис', () => {
    expect(slugProblem('ahti')).toBeNull();
    expect(slugProblem('buhgalter-plyus-2')).toBeNull();
    expect(slugProblem('ab')).toBe('slug_invalid');
    expect(slugProblem('Ahti')).toBe('slug_invalid');
    expect(slugProblem('ахти')).toBe('slug_invalid');
    expect(slugProblem('a'.repeat(31))).toBe('slug_invalid');
  });

  it('занятые слова — «Этот адрес занят, выберите другой»', () => {
    expect(slugProblem('admin')).toBe('slug_reserved');
    expect(slugProblem('buhuchet')).toBe('slug_reserved');
    expect(RESERVED_SLUGS).toHaveLength(25);
    for (const word of RESERVED_SLUGS) expect(slugProblem(word), word).toBe('slug_reserved');
  });
});

describe('логотип', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

  it('тип — по первым байтам: PNG или JPG', () => {
    expect(logoImageType(png)).toBe('image/png');
    expect(logoImageType(jpeg)).toBe('image/jpeg');
    expect(logoImageType(svg)).toBeNull();
    expect(logoImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('не больше 2 МБ', () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(logoProblem(big)).toBe('logo_too_large');
    const max = new Uint8Array(LOGO_MAX_BYTES);
    max.set(png);
    expect(logoProblem(max)).toBeNull();
    expect(logoProblem(svg)).toBe('logo_type');
  });
});

describe('isValidOrgInn', () => {
  it('ровно 14 цифр', () => {
    expect(isValidOrgInn('01203201910123')).toBe(true);
    expect(isValidOrgInn('0120320191012')).toBe(false);
    expect(isValidOrgInn('0120320191012a')).toBe(false);
  });
});
