import { describe, expect, it } from 'vitest';
import { NewEmployeeForm, PhoneCodes } from './staff';

describe('форма «Новый сотрудник»', () => {
  const ok = {
    fullName: '  Асанова Айгуль ',
    login: ' Aigul.A ',
    temporaryPassword: 'Bh-7K4M-Q9TX',
    roleId: 'r1',
  };
  const messages = (input: unknown) => {
    const res = NewEmployeeForm.safeParse(input);
    return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('ФИО обрезается, логин — в нижнем регистре без пробелов по краям', () => {
    expect(NewEmployeeForm.parse(ok)).toEqual({
      fullName: 'Асанова Айгуль',
      login: 'aigul.a',
      temporaryPassword: 'Bh-7K4M-Q9TX',
      roleId: 'r1',
    });
  });

  it('ошибки — ключи словаря: фамилия и имя, логин, пароль от 8 символов, роль', () => {
    expect(
      messages({ fullName: 'Айгуль', login: 'аа', temporaryPassword: 'Bh-1234', roleId: '' }),
    ).toEqual([
      'fullName: staff.err.full_name',
      'login: staff.err.login',
      'temporaryPassword: staff.err.password',
      'roleId: staff.err.role',
    ]);
    expect(messages({ ...ok, login: 'ab' })).toEqual(['login: staff.err.login']);
    // Первое сообщение поля показывает форма: слишком длинное ФИО — «Слишком длинное значение».
    expect(messages({ ...ok, fullName: `Ф ${'и'.repeat(250)}` })[0]).toBe(
      'fullName: form.too_long',
    );
  });
});

describe('коды телефонов', () => {
  it('страна, флаг, код, маска и признак «включён»', () => {
    const row = { cc: 'KG', flag: '🇰🇬', name: 'Кыргызстан', code: '996', mask: 'XXX XXX XXX' };
    expect(PhoneCodes.parse({ items: [{ ...row, active: true }] }).items[0]!.cc).toBe('KG');
    expect(PhoneCodes.safeParse({ items: [row] }).success).toBe(false);
  });
});
