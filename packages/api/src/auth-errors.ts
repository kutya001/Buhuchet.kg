import { LOGIN_LOCK_MINUTES, type LoginDenial } from '@buhuchet/domain';
import type { Context } from 'hono';
import { apiError } from './errors';

const EMPLOYEE_BLOCKED = 'Учётная запись заблокирована. Обратитесь к владельцу организации.';

/**
 * Почему войти нельзя, даже с верным паролем. При входе сообщается только после верного пароля
 * (docs/deviations.md, п. 4, решение Б), в открытом сеансе — при следующем запросе. Тексты — из
 * прототипа core/login.js: там и администратор платформы, блокируя учётную запись сотрудника,
 * выключает сотрудника, поэтому сотрудник видит одно сообщение — «Обратитесь к владельцу организации».
 * Экран берёт текст из словаря (`err.<код>`): в `details` — название организации (`org`) и вариант
 * текста для администратора платформы (`variant`).
 */
export function denialError(
  denial: LoginDenial,
  account: { orgName: string | null; isPlatformAdmin: boolean },
) {
  switch (denial) {
    case 'org_blocked':
      return apiError(
        denial,
        `Организация ${account.orgName ? `${account.orgName} ` : ''}заблокирована. Обратитесь к администратору платформы.`,
        account.orgName ? { org: account.orgName } : undefined,
      );
    case 'employee_blocked':
      return apiError(denial, EMPLOYEE_BLOCKED);
    case 'user_blocked':
      return account.isPlatformAdmin
        ? apiError(denial, 'Учётная запись заблокирована. Обратитесь к администратору платформы.', {
            variant: 'platform_admin',
          })
        : apiError(denial, EMPLOYEE_BLOCKED);
  }
}

/** «14:35» по Бишкеку: все сроки и время на платформе — по часовому поясу организации. */
export function bishkekTime(at: Date): string {
  return at.toLocaleTimeString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Вход закрыт после неверных паролей: до какого момента — в тексте, `details.lockedUntil` и Retry-After;
 * для текста словаря (`err.login_locked`) — `details.minutes` и `details.time` («14:35» по Бишкеку).
 */
export function lockedError(c: Context, until: Date | null) {
  if (until) {
    const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    c.header('retry-after', String(seconds));
  }
  return apiError(
    'login_locked',
    `Слишком много неверных паролей. Вход закрыт на ${LOGIN_LOCK_MINUTES} минут${
      until ? `, попробуйте снова после ${bishkekTime(until)}` : ''
    }.`,
    {
      lockedUntil: until?.toISOString() ?? null,
      minutes: LOGIN_LOCK_MINUTES,
      ...(until ? { time: bishkekTime(until) } : {}),
    },
  );
}
