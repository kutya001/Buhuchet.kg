import { describe, expect, it } from 'vitest';
import {
  isFullName,
  newEmployeeRoleRefusal,
  phoneProblem,
  staffActionRefusal,
  type StaffTarget,
} from './rules';
import { auditActorName, PLATFORM_ADMIN_NAME } from './names';

/** Часть справочника «Коды телефонов» (refDB.json → phoneCodes). */
const CODES = [
  { code: '996', mask: 'XXX XXX XXX' },
  { code: '7', mask: 'XXX XXX XX XX' },
  { code: '998', mask: 'XX XXX XX XX' },
];

describe('ФИО и телефон нового сотрудника', () => {
  it('ФИО — хотя бы фамилия и имя (прототип: «Введите фамилию и имя»)', () => {
    expect(isFullName('Токтогулов Алишер Бакытович')).toBe(true);
    expect(isFullName('  Токтогулов   Алишер ')).toBe(true);
    expect(isFullName('Алишер')).toBe(false);
    expect(isFullName('   ')).toBe(false);
    expect(isFullName(`Ф ${'и'.repeat(200)}`)).toBe(false);
  });

  it('телефон: код страны из справочника и цифры по маске', () => {
    expect(phoneProblem('+996555100200', CODES)).toBeNull();
    expect(phoneProblem('+77011234567', CODES)).toBeNull();
    expect(phoneProblem('+998901234567', CODES)).toBeNull();
    expect(phoneProblem('+99655510020', CODES)).toBe('Номер — 9 цифр после кода страны');
    expect(phoneProblem('+1555100200', CODES)).toBe('Неизвестный код страны');
    expect(phoneProblem('996555100200', CODES)).toBe('Номер — «+», код страны и цифры');
    expect(phoneProblem('+996 555 100 200', CODES)).toBe('Номер — «+», код страны и цифры');
  });
});

describe('действия над сотрудником', () => {
  const owner = { employeeId: 'e1', isOwner: true };
  const chief = { employeeId: 'e2', isOwner: false };
  const target = (employeeId: string, role: Partial<StaffTarget['role']> = {}): StaffTarget => ({
    employeeId,
    role: { isOwner: false, permissions: ['cpView'], ...role },
  });
  const accRole = { isOwner: false, permissions: ['cpView' as const] };
  const staffRole = { isOwner: false, permissions: ['staffView' as const, 'staff' as const] };
  const ownerRole = { isOwner: true, permissions: [] };

  it('у владельца организации действий нет, кроме правки своих ФИО и телефона', () => {
    const o = target('e1', ownerRole);
    for (const action of ['changeRole', 'block', 'unblock', 'resetPassword'] as const) {
      expect(staffActionRefusal(owner, o, action, accRole)).toBe('owner_employee');
    }
    expect(staffActionRefusal(owner, o, 'edit')).toBeNull();
    expect(staffActionRefusal(chief, o, 'edit')).toBe('owner_employee');
  });

  it('себя не блокируют; разблокировать и править можно', () => {
    expect(staffActionRefusal(chief, target('e2'), 'block')).toBe('own_account');
    expect(staffActionRefusal(chief, target('e3'), 'block')).toBeNull();
    expect(staffActionRefusal(chief, target('e3', staffRole), 'block')).toBeNull();
    expect(staffActionRefusal(chief, target('e3'), 'unblock')).toBeNull();
    expect(staffActionRefusal(chief, target('e2'), 'edit')).toBeNull();
  });

  it('смена роли: свою — только владелец; роль владельца не назначается', () => {
    expect(staffActionRefusal(chief, target('e2'), 'changeRole', accRole)).toBe('own_role');
    expect(staffActionRefusal(chief, target('e3'), 'changeRole', accRole)).toBeNull();
    expect(staffActionRefusal(owner, target('e3'), 'changeRole', ownerRole)).toBe('owner_role');
    expect(() => staffActionRefusal(owner, target('e3'), 'changeRole')).toThrow();
  });

  it('роль с правами «выдаёт только владелец» назначает и снимает только владелец', () => {
    expect(staffActionRefusal(chief, target('e3'), 'changeRole', staffRole)).toBe('owner_granted');
    expect(staffActionRefusal(chief, target('e3', staffRole), 'changeRole', accRole)).toBe(
      'owner_granted',
    );
    expect(staffActionRefusal(owner, target('e3'), 'changeRole', staffRole)).toBeNull();
    expect(staffActionRefusal(owner, target('e3', staffRole), 'changeRole', accRole)).toBeNull();
  });

  it('пароль сотрудника с такими правами сбрасывает только владелец', () => {
    expect(staffActionRefusal(chief, target('e3', staffRole), 'resetPassword')).toBe(
      'owner_granted',
    );
    expect(staffActionRefusal(owner, target('e3', staffRole), 'resetPassword')).toBeNull();
    expect(staffActionRefusal(chief, target('e3'), 'resetPassword')).toBeNull();
  });

  it('роль нового сотрудника', () => {
    expect(newEmployeeRoleRefusal(owner, ownerRole)).toBe('owner_role');
    expect(newEmployeeRoleRefusal(chief, staffRole)).toBe('owner_granted');
    expect(newEmployeeRoleRefusal(owner, staffRole)).toBeNull();
    expect(newEmployeeRoleRefusal(chief, accRole)).toBeNull();
  });
});

describe('«Создал» и «Изменил»', () => {
  it('имя сотрудника, администратор платформы или система', () => {
    expect(auditActorName('u1', 'Алишер Т.')).toBe('Алишер Т.');
    expect(auditActorName('admin', null)).toBe(PLATFORM_ADMIN_NAME);
    expect(auditActorName(null, null)).toBeNull();
  });
});
