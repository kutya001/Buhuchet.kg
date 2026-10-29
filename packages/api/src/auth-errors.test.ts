import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { denialError, lockedError } from './auth-errors';
import { RESET_REQUESTED_MESSAGE } from './modules/auth/reset';

// Экран берёт тексты из словаря (`err.<код>`): подстановки и вариант текста — в details ответа.
describe('почему войти нельзя: тексты прототипа v59 и details для текста словаря', () => {
  it('организация заблокирована — без названия организации', () => {
    expect(denialError('org_blocked', { isPlatformAdmin: false })).toEqual({
      error: {
        code: 'org_blocked',
        message: 'Организация заблокирована. Обратитесь к администратору платформы.',
      },
    });
  });

  it('заблокированный администратор платформы — свой вариант текста', () => {
    expect(denialError('user_blocked', { isPlatformAdmin: true }).error).toEqual({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к администратору платформы.',
      details: { variant: 'platform_admin' },
    });
    expect(denialError('user_blocked', { isPlatformAdmin: false }).error).toEqual({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    });
  });

  it('вход закрыт — один текст для любого логина, срок — в details и Retry-After', () => {
    const headers = new Map<string, string>();
    const c = { header: (k: string, v: string) => headers.set(k, v) } as unknown as Context;
    const until = new Date(Date.now() + 10 * 60_000);
    expect(lockedError(c, until).error).toEqual({
      code: 'login_locked',
      message: 'Вход временно закрыт: слишком много неверных попыток. Попробуйте через 15 минут.',
      details: { lockedUntil: until.toISOString(), minutes: 15 },
    });
    expect(Number(headers.get('retry-after'))).toBeGreaterThan(9 * 60);
  });
});

describe('тексты словаря err.* совпадают с текстами сервера', () => {
  /** Что покажет экран: текст словаря по коду и варианту с подстановками из details. */
  const screen = ({ code, details }: { code: string; details?: unknown }) => {
    const { variant, ...params } = (details ?? {}) as Record<string, string | number>;
    const key = (variant ? `err.${code}.${variant}` : `err.${code}`) as UiTextKey;
    return formatText(UI_TEXTS[key].ru, params);
  };
  const header = () => undefined;

  it('блокировки, закрытый вход и ответ «Забыли пароль?»', () => {
    const errors = [
      denialError('org_blocked', { isPlatformAdmin: false }),
      denialError('employee_blocked', { isPlatformAdmin: false }),
      denialError('user_blocked', { isPlatformAdmin: false }),
      denialError('user_blocked', { isPlatformAdmin: true }),
      lockedError({ header } as unknown as Context, new Date('2026-10-26T08:35:00Z')),
    ];
    for (const { error } of errors) expect(screen(error), error.code).toBe(error.message);
    expect(UI_TEXTS['auth.code_sent'].ru).toBe(RESET_REQUESTED_MESSAGE);
  });

  it('страница входа показывает тексты словаря refDB (auth.*) — те же, что в ответах сервера', () => {
    const at = lockedError({ header } as unknown as Context, null).error.message;
    expect(UI_TEXTS['auth.locked'].ru).toBe(at);
    expect(UI_TEXTS['auth.org_blocked'].ru).toBe(
      denialError('org_blocked', { isPlatformAdmin: false }).error.message,
    );
    expect(UI_TEXTS['auth.user_blocked'].ru).toBe(
      denialError('employee_blocked', { isPlatformAdmin: false }).error.message,
    );
    expect(UI_TEXTS['auth.bad_login'].ru).toBe(UI_TEXTS['err.invalid_credentials'].ru);
  });
});
