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

  // docs/deviations.md п. О-11 и О-12.
  it('вход закрыт после 10 неверных паролей; предел с адреса; сервер занят — тексты словаря', () => {
    expect(text('account_locked', { failures: 10 })).toBe(
      'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к владельцу организации — он выдаст новый пароль.',
    );
    expect(text('account_locked', { variant: 'owner', failures: 10 })).toBe(
      'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к администратору платформы — он выдаст новый пароль.',
    );
    expect(text('auth_ip_limited', { minutes: 10 })).toBe(
      'Слишком много попыток входа с этого адреса. Попробуйте через 10 минут.',
    );
    expect(text('server_busy')).toBe('Сервер занят, попробуйте ещё раз через несколько секунд');
  });

  it('другие ответы — по коду, как везде', () => {
    expect(text('rate_limited_unknown')).toBe('текст сервера');
    expect(text('validation_failed')).toBe('Неверные данные запроса');
  });
});
