import { describe, expect, it } from 'vitest';
import { ChangePasswordRequest, LoginRequest, MeResponse } from './auth';

describe('схемы входа', () => {
  it('логин обрезается по краям; пустой логин или пароль не принимаются', () => {
    expect(LoginRequest.parse({ login: '  erkin ', password: 'x' })).toEqual({
      login: 'erkin',
      password: 'x',
    });
    expect(LoginRequest.safeParse({ login: '   ', password: 'x' }).success).toBe(false);
    expect(LoginRequest.safeParse({ login: 'erkin', password: '' }).success).toBe(false);
    expect(LoginRequest.safeParse({ login: 'a'.repeat(65), password: 'x' }).success).toBe(false);
  });

  it('новый пароль — не короче 8 символов и не длиннее 128 (прототип modules/profile.js)', () => {
    const ok = (newPassword: string) =>
      ChangePasswordRequest.safeParse({ currentPassword: 'old', newPassword }).success;
    expect(ok('1234567')).toBe(false);
    expect(ok('12345678')).toBe(true);
    expect(ok('x'.repeat(128))).toBe(true);
    expect(ok('x'.repeat(129))).toBe(false);
  });

  it('«кто я»: права — только из каталога 39 прав', () => {
    const me = {
      user: {
        id: '0b2d4e6f-0000-4000-8000-00000000000a',
        login: 'erkin',
        isPlatformAdmin: false,
        mustChangePassword: false,
      },
      employee: null,
      organization: null,
      permissions: ['cpView'],
      scopes: { cps: 'own' },
    };
    expect(MeResponse.parse(me)).toEqual(me);
    expect(MeResponse.safeParse({ ...me, permissions: ['rootAccess'] }).success).toBe(false);
  });
});
