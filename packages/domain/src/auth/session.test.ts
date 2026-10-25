import { describe, expect, it } from 'vitest';
import { loginDenial, type AccountState } from './session';

const employee: AccountState = {
  isPlatformAdmin: false,
  userBlocked: false,
  employeeActive: true,
  orgStatus: 'active',
};

describe('loginDenial — кому нельзя войти даже с верным паролем', () => {
  it('активный сотрудник активной организации входит', () => {
    expect(loginDenial(employee)).toBeNull();
  });

  it('организация заблокирована — сообщение об организации, даже если и сотрудник заблокирован', () => {
    expect(loginDenial({ ...employee, orgStatus: 'blocked', employeeActive: false })).toBe(
      'org_blocked',
    );
  });

  it('учётную запись заблокировал администратор платформы', () => {
    expect(loginDenial({ ...employee, userBlocked: true })).toBe('user_blocked');
  });

  it('сотрудника заблокировал владелец; без записи сотрудника войти тоже нельзя', () => {
    expect(loginDenial({ ...employee, employeeActive: false })).toBe('employee_blocked');
    expect(loginDenial({ ...employee, employeeActive: null })).toBe('employee_blocked');
  });

  it('администратор платформы — без организации и сотрудника', () => {
    const admin: AccountState = {
      isPlatformAdmin: true,
      userBlocked: false,
      employeeActive: null,
      orgStatus: null,
    };
    expect(loginDenial(admin)).toBeNull();
    expect(loginDenial({ ...admin, userBlocked: true })).toBe('user_blocked');
  });
});
