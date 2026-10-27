import { describe, expect, it } from 'vitest';
import {
  ChangePasswordForm,
  ChangePasswordRequest,
  LoginForm,
  LoginRequest,
  MeResponse,
  PasswordResetCodeForm,
  PasswordResetConfirmRequest,
  PasswordResetLoginForm,
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
      employee: {
        id: '0b2d4e6f-0000-4000-8000-00000000000b',
        fullName: 'Сыдыков Эркин',
        shortName: 'Эркин С.',
        phone: '+996 555 100 200',
        roleId: '0b2d4e6f-0000-4000-8000-00000000000c',
        roleName: 'Владелец',
        isOwner: true,
      },
      organization: null,
      telegram: { name: '@erkin_s', linkedAt: '2026-10-18T03:00:00.000Z' },
      permissions: ['cpView'],
      scopes: { cps: 'own' },
      features: { tasks: true, projects: false },
      reportConfirm: true,
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
    // Экран вставляет ссылку в href: только https://t.me без логина и порта.
    for (const url of [
      'javascript:alert(1)',
      'http://t.me/buhuchet_bot?start=abc',
      'https://t.me.evil.example/buhuchet_bot',
      'https://evil.example@t.me/buhuchet_bot',
      'https://t.me:8443/buhuchet_bot',
    ]) {
      expect(
        TelegramLinkResponse.safeParse({ url, expiresAt: '2026-10-18T03:15:00.000Z' }).success,
        url,
      ).toBe(false);
    }
  });
});

describe('формы входа и смены пароля (сообщения — ключи словаря)', () => {
  /** Ключи сообщений по полям: что покажет форма. */
  const errors = (result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  }) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));

  it('вход: пустые логин и пароль — «Введите логин», «Введите пароль»; логин обрезается', () => {
    expect(errors(LoginForm.safeParse({ login: '  ', password: '' }))).toEqual({
      login: 'auth.err.login',
      password: 'auth.err.password',
    });
    expect(LoginForm.parse({ login: ' erkin ', password: 'x' })).toEqual({
      login: 'erkin',
      password: 'x',
    });
    expect(errors(LoginForm.safeParse({ login: 'a'.repeat(65), password: 'x' }))).toEqual({
      login: 'form.too_long',
    });
    expect(errors(PasswordResetLoginForm.safeParse({ login: '' }))).toEqual({
      login: 'auth.err.login',
    });
  });

  it('код из Telegram — 6 цифр; новый пароль — не короче 8 символов; повтор должен совпасть', () => {
    const base = { code: '482913', newPassword: 'Новый-пароль', repeat: 'Новый-пароль' };
    expect(PasswordResetCodeForm.safeParse(base).success).toBe(true);
    expect(errors(PasswordResetCodeForm.safeParse({ ...base, code: '48291' }))).toEqual({
      code: 'auth.err.code',
    });
    expect(
      errors(
        PasswordResetCodeForm.safeParse({ ...base, newPassword: '1234567', repeat: '1234567' }),
      ),
    ).toEqual({ newPassword: 'auth.err.short' });
    expect(errors(PasswordResetCodeForm.safeParse({ ...base, repeat: 'Другой-пароль' }))).toEqual({
      repeat: 'auth.err.mismatch',
    });
  });

  it('смена пароля: текущий обязателен, новый и повтор — как в «Забыли пароль?», новый не равен текущему', () => {
    const base = { currentPassword: 'old', newPassword: 'Новый-пароль', repeat: 'Новый-пароль' };
    expect(ChangePasswordForm.safeParse(base).success).toBe(true);
    expect(errors(ChangePasswordForm.safeParse({ ...base, currentPassword: '' }))).toEqual({
      currentPassword: 'auth.err.current',
    });
    expect(errors(ChangePasswordForm.safeParse({ ...base, repeat: '' }))).toEqual({
      repeat: 'auth.err.mismatch',
    });
    // Новый пароль не совпадает с текущим (docs/deviations.md п. 41).
    expect(
      errors(
        ChangePasswordForm.safeParse({
          currentPassword: 'Старый-пароль',
          newPassword: 'Старый-пароль',
          repeat: 'Старый-пароль',
        }),
      ),
    ).toEqual({ newPassword: 'auth.err.same' });
    // Форма отправляет методу смены пароля только его поля.
    const { currentPassword, newPassword } = ChangePasswordForm.parse(base);
    expect(ChangePasswordRequest.safeParse({ currentPassword, newPassword }).success).toBe(true);
  });
});
