import { UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeErrorText, makeTranslate } from '../l10n/translate';
import { loginErrorText } from './login-errors';

// Страница входа показывает тексты словаря refDB v59 (прототип core/login.js `LG_T`): одно сообщение
// для любого логина, о блокировке — без названия организации.
describe('ошибка входа — тексты словаря refDB v59', () => {
  const texts = Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru]));
  const t = makeTranslate(texts);
  const text = (code: string, details?: unknown) =>
    loginErrorText(t, makeErrorText(texts), { code, message: 'текст сервера', details });

  it('неверный логин или пароль, вход закрыт — без предупреждения о попытках и без времени', () => {
    expect(text('invalid_credentials')).toBe('Неверный логин или пароль');
    expect(text('login_locked', { lockedUntil: '2026-10-27T10:00:00Z', minutes: 15 })).toBe(
      'Вход временно закрыт: слишком много неверных попыток. Попробуйте через 15 минут.',
    );
  });

  it('блокировка сотрудника и организации — после верного пароля, без названия организации', () => {
    expect(text('employee_blocked')).toBe(
      'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    );
    expect(text('user_blocked')).toBe(
      'Учётная запись заблокирована. Обратитесь к владельцу организации.',
    );
    expect(text('user_blocked', { variant: 'platform_admin' })).toBe(
      'Учётная запись заблокирована. Обратитесь к администратору платформы.',
    );
    expect(text('org_blocked')).toBe(
      'Организация заблокирована. Обратитесь к администратору платформы.',
    );
  });

  it('другие ответы — по коду, как везде', () => {
    expect(text('rate_limited_unknown')).toBe('текст сервера');
    expect(text('validation_failed')).toBe('Неверные данные запроса');
  });
});
