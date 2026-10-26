import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequest,
  LoginRequest,
  MeResponse,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
} from './auth';
import { TelegramLinkResponse } from './telegram';

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

  it('«кто я»: права — только из каталога 39 прав, модули — только из меню', () => {
    const me = {
      user: {
        id: '0b2d4e6f-0000-4000-8000-00000000000a',
        login: 'erkin',
        isPlatformAdmin: false,
        mustChangePassword: false,
      },
      employee: null,
      organization: null,
      telegram: { name: '@erkin_s', linkedAt: '2026-10-18T03:00:00.000Z' },
      permissions: ['cpView'],
      scopes: { cps: 'own' },
      features: { tasks: true, projects: false },
      modules: ['home', 'cps', 'tasks'],
    };
    expect(MeResponse.parse(me)).toEqual(me);
    expect(MeResponse.safeParse({ ...me, permissions: ['rootAccess'] }).success).toBe(false);
    expect(MeResponse.safeParse({ ...me, modules: ['admin'] }).success).toBe(false);
  });

  it('«Забыли пароль?»: логин, код из 6 цифр и новый пароль не короче 8 символов', () => {
    expect(PasswordResetRequest.parse({ login: ' Erkin ' })).toEqual({ login: 'Erkin' });
    expect(PasswordResetRequest.safeParse({ login: '' }).success).toBe(false);
    const ok = (code: string, newPassword = 'Новый-пароль') =>
      PasswordResetConfirmRequest.safeParse({ login: 'erkin', code, newPassword }).success;
    expect(ok('482913')).toBe(true);
    expect(ok(' 482913 ')).toBe(true);
    expect(ok('48291')).toBe(false);
    expect(ok('4829134')).toBe(false);
    expect(ok('48291a')).toBe(false);
    expect(ok('482913', '1234567')).toBe(false);
  });

  it('ссылка привязки Telegram — адрес и срок', () => {
    expect(
      TelegramLinkResponse.safeParse({
        url: 'https://t.me/buhuchet_bot?start=abc',
        expiresAt: '2026-10-18T03:15:00.000Z',
      }).success,
    ).toBe(true);
    expect(TelegramLinkResponse.safeParse({ url: 'abc', expiresAt: 'завтра' }).success).toBe(false);
  });
});
