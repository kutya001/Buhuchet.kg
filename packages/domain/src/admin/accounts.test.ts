import { describe, expect, it } from 'vitest';
import { accountActionRefusal, accountStatus } from './accounts';

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
