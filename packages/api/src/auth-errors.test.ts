import { describe, expect, it } from 'vitest';
import { denialError } from './auth-errors';

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
