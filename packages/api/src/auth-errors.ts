import { LOGIN_LOCK_MINUTES, type LoginDenial } from '@buhuchet/domain';
import type { Context } from 'hono';
import { apiError } from './errors';

/** Почему вход закрыт при верном пароле. Тексты — как в прототипе (core/login.js). */
export function denialError(denial: LoginDenial, orgName: string | null) {
  switch (denial) {
    case 'org_blocked':
      return apiError(
        denial,
        `Организация ${orgName ? `${orgName} ` : ''}заблокирована. Обратитесь к администратору платформы.`,
      );
    case 'employee_blocked':
      return apiError(denial, 'Учётная запись заблокирована. Обратитесь к владельцу организации.');
    case 'user_blocked':
      return apiError(
        denial,
        'Учётная запись заблокирована. Обратитесь к администратору платформы.',
      );
  }
}

/** Вход закрыт после неверных паролей: до какого момента — в details.lockedUntil и в Retry-After. */
export function lockedError(c: Context, until: Date | null) {
  if (until) {
    const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    c.header('retry-after', String(seconds));
  }
  return apiError(
    'login_locked',
    `Слишком много неверных паролей. Вход закрыт на ${LOGIN_LOCK_MINUTES} минут.`,
    { lockedUntil: until?.toISOString() ?? null },
  );
}
