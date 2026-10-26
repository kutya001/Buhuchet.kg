import { describe, expect, it } from 'vitest';
import type { PermissionId } from '../roles/permissions';
import {
  applyPhoneMask,
  isFullName,
  joinPhone,
  maskDigits,
  newEmployeeRoleRefusal,
  formatPhone,
  phoneProblem,
  splitPhone,
  staffActionRefusal,
  type StaffActor,
  type StaffTarget,
} from './rules';
import { auditActorName, initials, PLATFORM_ADMIN_NAME } from './names';

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

  it('телефон для показа — по маске страны; неподходящий номер — как есть (прототип fmtPhone)', () => {
    expect(formatPhone('+996555100200', CODES)).toBe('+996 555 100 200');
    expect(formatPhone('+77011234567', CODES)).toBe('+7 701 123 45 67');
    expect(formatPhone('+998901234567', CODES)).toBe('+998 90 123 45 67');
    expect(formatPhone('+99655510020', CODES)).toBe('+99655510020');
    expect(formatPhone('8 555 100 200', CODES)).toBe('8 555 100 200');
  });

  /** Коды для поля ввода: у Казахстана и России один код «7», Таджикистан выключен. */
  const OPTIONS = [
    { cc: 'KG', code: '996', mask: 'XXX XXX XXX', active: true },
    { cc: 'KZ', code: '7', mask: 'XXX XXX XX XX', active: true },
    { cc: 'RU', code: '7', mask: 'XXX XXX XX XX', active: true },
    { cc: 'TJ', code: '992', mask: 'XX XXX XXXX', active: false },
  ];

  it('поле ввода телефона: маска по мере ввода, лишние цифры отбрасываются (прототип applyMask)', () => {
    expect(maskDigits('XXX XXX XXX')).toBe(9);
    expect(maskDigits('XX XXX XX XX')).toBe(9);
    expect(applyPhoneMask('XXX XXX XXX', '')).toBe('');
    expect(applyPhoneMask('XXX XXX XXX', '5551')).toBe('555 1');
    expect(applyPhoneMask('XXX XXX XXX', '555100200999')).toBe('555 100 200');
    expect(applyPhoneMask('XXX XXX XX XX', '7011234567')).toBe('701 123 45 67');
  });

  it('поле ввода из номера: страна по коду, цифры после кода; пусто — первая включённая страна', () => {
    expect(splitPhone('+996555100200', OPTIONS)).toEqual({ cc: 'KG', local: '555100200' });
    expect(splitPhone('+77011234567', OPTIONS)).toEqual({ cc: 'KZ', local: '7011234567' });
    expect(splitPhone('+992901234567', OPTIONS)).toEqual({ cc: 'TJ', local: '901234567' });
    expect(splitPhone(null, OPTIONS)).toEqual({ cc: 'KG', local: '' });
    expect(splitPhone('+1555', OPTIONS)).toEqual({ cc: 'KG', local: '' });
    expect(splitPhone('+996555', OPTIONS)).toEqual({ cc: 'KG', local: '' });
    expect(splitPhone(null, [])).toEqual({ cc: '', local: '' });
  });

  it('номер из поля ввода: «+», код и цифры; без цифр — не указан; сколько цифр не хватает', () => {
    expect(joinPhone('KG', '555 100 200', OPTIONS)).toEqual({
      phone: '+996555100200',
      need: 9,
      missing: 0,
    });
    expect(joinPhone('RU', '701', OPTIONS)).toEqual({ phone: '+7701', need: 10, missing: 7 });
    expect(joinPhone('KG', '', OPTIONS)).toEqual({ phone: null, need: 9, missing: 0 });
    expect(joinPhone('KG', '5551002009', OPTIONS).phone).toBe('+996555100200');
    expect(joinPhone('XX', '555', OPTIONS)).toEqual({ phone: null, need: 0, missing: 0 });
  });
});

describe('действия над сотрудником', () => {
  const owner: StaffActor = { employeeId: 'e1', isOwner: true, permissions: new Set(), scopes: {} };
  /** Кадровик: «Сотрудники и роли», контрагенты — «Все», финансов нет. */
  const hr: StaffActor = {
    employeeId: 'e2',
    isOwner: false,
    permissions: new Set(['cpView', 'createCp', 'staffView', 'staff', 'export']),
    scopes: { cps: 'all' },
  };
  const role = (
    permissions: PermissionId[],
    scopes: StaffTarget['role']['scopes'] = {},
  ): StaffTarget['role'] => ({ isOwner: false, permissions, scopes });
  const accRole = role(['cpView']);
  const staffRole = role(['staffView', 'staff']);
  const finRole = role(['finView', 'money']);
  const ownerRole = { isOwner: true, permissions: [], scopes: {} };
  const target = (employeeId: string, r: StaffTarget['role'] = accRole): StaffTarget => ({
    employeeId,
    role: r,
  });

  it('у владельца организации действий нет, кроме правки своих ФИО и телефона', () => {
    const o = target('e1', ownerRole);
    for (const action of ['changeRole', 'block', 'unblock', 'resetPassword'] as const) {
      expect(staffActionRefusal(owner, o, action, accRole)).toBe('owner_employee');
    }
    expect(staffActionRefusal(owner, o, 'edit')).toBeNull();
    expect(staffActionRefusal(hr, o, 'edit')).toBe('owner_employee');
  });

  it('себя не блокируют; разблокировать и править можно', () => {
    expect(staffActionRefusal(hr, target('e2'), 'block')).toBe('own_account');
    expect(staffActionRefusal(hr, target('e3'), 'block')).toBeNull();
    expect(staffActionRefusal(hr, target('e3', role(['cpView', 'export'])), 'block')).toBeNull();
    expect(staffActionRefusal(hr, target('e3'), 'unblock')).toBeNull();
    expect(staffActionRefusal(hr, target('e2'), 'edit')).toBeNull();
  });

  it('сотрудника с правами «выдаёт только владелец» блокирует и разблокирует только владелец', () => {
    expect(staffActionRefusal(hr, target('e3', staffRole), 'block')).toBe('owner_granted');
    expect(staffActionRefusal(hr, target('e3', staffRole), 'unblock')).toBe('owner_granted');
    expect(staffActionRefusal(owner, target('e3', staffRole), 'block')).toBeNull();
    expect(staffActionRefusal(owner, target('e3', staffRole), 'unblock')).toBeNull();
  });

  it('сотрудника с ролью шире своей блокирует и разблокирует только владелец', () => {
    expect(staffActionRefusal(hr, target('e3', finRole), 'block')).toBe('beyond_own');
    expect(staffActionRefusal(hr, target('e3', finRole), 'unblock')).toBe('beyond_own');
    expect(staffActionRefusal(owner, target('e3', finRole), 'unblock')).toBeNull();
  });

  it('смена роли: свою — только владелец; роль владельца не назначается', () => {
    expect(staffActionRefusal(hr, target('e2'), 'changeRole', accRole)).toBe('own_role');
    expect(staffActionRefusal(hr, target('e3'), 'changeRole', accRole)).toBeNull();
    expect(staffActionRefusal(owner, target('e3'), 'changeRole', ownerRole)).toBe('owner_role');
    expect(() => staffActionRefusal(owner, target('e3'), 'changeRole')).toThrow();
  });

  it('роль с правами «выдаёт только владелец» назначает и снимает только владелец', () => {
    expect(staffActionRefusal(hr, target('e3'), 'changeRole', staffRole)).toBe('owner_granted');
    expect(staffActionRefusal(hr, target('e3', staffRole), 'changeRole', accRole)).toBe(
      'owner_granted',
    );
    expect(staffActionRefusal(owner, target('e3'), 'changeRole', staffRole)).toBeNull();
    expect(staffActionRefusal(owner, target('e3', staffRole), 'changeRole', accRole)).toBeNull();
  });

  it('роль шире своей не владелец не назначает и не снимает', () => {
    expect(staffActionRefusal(hr, target('e3'), 'changeRole', finRole)).toBe('beyond_own');
    expect(staffActionRefusal(hr, target('e3', finRole), 'changeRole', accRole)).toBe('beyond_own');
    expect(
      staffActionRefusal(hr, target('e3'), 'changeRole', role(['repView'], { reports: 'all' })),
    ).toBe('beyond_own');
    expect(
      staffActionRefusal(
        hr,
        target('e3'),
        'changeRole',
        role(['cpView', 'createCp'], { cps: 'all' }),
      ),
    ).toBeNull();
    expect(staffActionRefusal(owner, target('e3'), 'changeRole', finRole)).toBeNull();
  });

  it('пароль сбрасывает не владелец только сотруднику с ролью не шире своей и без прав владельца', () => {
    expect(staffActionRefusal(hr, target('e3', staffRole), 'resetPassword')).toBe('owner_granted');
    expect(staffActionRefusal(hr, target('e3', finRole), 'resetPassword')).toBe('beyond_own');
    expect(staffActionRefusal(owner, target('e3', staffRole), 'resetPassword')).toBeNull();
    expect(staffActionRefusal(owner, target('e3', finRole), 'resetPassword')).toBeNull();
    expect(staffActionRefusal(hr, target('e3'), 'resetPassword')).toBeNull();
  });

  it('роль нового сотрудника', () => {
    expect(newEmployeeRoleRefusal(owner, ownerRole)).toBe('owner_role');
    expect(newEmployeeRoleRefusal(hr, staffRole)).toBe('owner_granted');
    expect(newEmployeeRoleRefusal(hr, finRole)).toBe('beyond_own');
    expect(newEmployeeRoleRefusal(owner, staffRole)).toBeNull();
    expect(newEmployeeRoleRefusal(owner, finRole)).toBeNull();
    expect(newEmployeeRoleRefusal(hr, accRole)).toBeNull();
  });
});

describe('инициалы для «Мой профиль»', () => {
  it('первые буквы фамилии и имени (прототип core/org.js initials)', () => {
    expect(initials('Сыдыков Эркин Маратович')).toBe('СЭ');
    expect(initials('  алиев   нурлан ')).toBe('АН');
    expect(initials('Администратор')).toBe('А');
    expect(initials('')).toBe('');
  });
});

describe('«Создал» и «Изменил»', () => {
  it('имя сотрудника, администратор платформы или система', () => {
    expect(auditActorName('u1', 'Алишер Т.')).toBe('Алишер Т.');
    expect(auditActorName('admin', null)).toBe(PLATFORM_ADMIN_NAME);
    expect(auditActorName(null, null)).toBeNull();
  });
});
