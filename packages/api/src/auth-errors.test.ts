import { formatText, UI_TEXTS, type UiTextKey } from '@buhuchet/domain';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { denialError, lockedError } from './auth-errors';
import { RESET_REQUESTED_MESSAGE } from './modules/auth/reset';

// Экран берёт тексты из словаря (`err.<код>`): подстановки и вариант текста — в details ответа.
describe('почему войти нельзя: details для текста словаря', () => {
  it('организация заблокирована — название в details.org; без названия details нет', () => {
    expect(denialError('org_blocked', { orgName: 'Ромашка', isPlatformAdmin: false })).toEqual({
      error: {
        code: 'org_blocked',
        message: 'Организация Ромашка заблокирована. Обратитесь к администратору платформы.',
        details: { org: 'Ромашка' },
      },
    });
    expect(denialError('org_blocked', { orgName: null, isPlatformAdmin: false }).error).toEqual({
      code: 'org_blocked',
      message: 'Организация заблокирована. Обратитесь к администратору платформы.',
    });
  });

  it('заблокированный администратор платформы — свой вариант текста', () => {
    expect(denialError('user_blocked', { orgName: null, isPlatformAdmin: true }).error).toEqual({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к администратору платформы.',
      details: { variant: 'platform_admin' },
    });
    expect(
      denialError('user_blocked', { orgName: 'Ромашка', isPlatformAdmin: false }).error,
    ).toEqual({
      code: 'user_blocked',
      message: 'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    });
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
      denialError('org_blocked', { orgName: 'Ромашка', isPlatformAdmin: false }),
      denialError('employee_blocked', { orgName: 'Ромашка', isPlatformAdmin: false }),
      denialError('user_blocked', { orgName: 'Ромашка', isPlatformAdmin: false }),
      denialError('user_blocked', { orgName: null, isPlatformAdmin: true }),
      lockedError({ header } as unknown as Context, new Date('2026-10-26T08:35:00Z')),
    ];
    for (const { error } of errors) expect(screen(error), error.code).toBe(error.message);
    expect(UI_TEXTS['auth.reset_requested'].ru).toBe(RESET_REQUESTED_MESSAGE);
  });
});
