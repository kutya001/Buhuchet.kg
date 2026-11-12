import { describe, expect, it } from 'vitest';
import { accountActionRefusal, accountCardTabs, accountStates, accountStatus } from './accounts';

// Админка → «Учётные записи»: статус из двух блокировок (docs/deviations.md, п. 49) и кому из Админки
// нельзя сбросить пароль и поменять блокировку (прототип accActions: «Это вы»).

describe('статус учётной записи', () => {
  it('блокировка администратором видна и поверх блокировки владельцем', () => {
    expect(accountStatus({ blocked: false, employeeActive: true })).toBe('active');
    expect(accountStatus({ blocked: true, employeeActive: true })).toBe('blocked');
    expect(accountStatus({ blocked: true, employeeActive: false })).toBe('blocked');
    expect(accountStatus({ blocked: false, employeeActive: false })).toBe('owner_blocked');
  });
});

describe('действия Админки над учётной записью', () => {
  const me = 'u-admin';
  it('своя учётная запись — «Это вы», другой администратор платформы — нельзя, сотрудник — можно', () => {
    expect(accountActionRefusal(me, { id: me, isPlatformAdmin: true })).toBe('self');
    expect(accountActionRefusal(me, { id: 'u-2', isPlatformAdmin: true })).toBe('platform_admin');
    expect(accountActionRefusal(me, { id: 'u-3', isPlatformAdmin: false })).toBeNull();
  });
});

describe('карточка пользователя: состояния и вкладки', () => {
  const base = {
    isPlatformAdmin: false,
    blocked: false,
    employeeActive: true,
    loginLocked: false,
    mustChangePassword: false,
  };

  it('без блокировок — «Активен»; состояний может быть несколько, в порядке прототипа', () => {
    expect(accountStates(base)).toEqual(['active']);
    expect(accountStates({ ...base, blocked: true, mustChangePassword: true })).toEqual([
      'blocked_admin',
      'temp_password',
    ]);
    expect(
      accountStates({ ...base, blocked: true, employeeActive: false, loginLocked: true }),
    ).toEqual(['blocked_admin', 'blocked_owner', 'login_locked']);
    expect(accountStates({ ...base, employeeActive: false })).toEqual(['blocked_owner']);
  });

  it('администратор платформы: одно состояние и три вкладки', () => {
    expect(accountStates({ ...base, isPlatformAdmin: true, mustChangePassword: true })).toEqual([
      'active',
    ]);
    expect(accountStates({ ...base, isPlatformAdmin: true, blocked: true })).toEqual([
      'blocked_admin',
    ]);
    expect(accountCardTabs(true)).toEqual(['main', 'ses', 'hist']);
    expect(accountCardTabs(false)).toEqual(['main', 'work', 'ses', 'kb', 'tg', 'hist']);
  });
});
