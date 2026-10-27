import { LOGIN_LOCK_MINUTES, type LoginDenial } from '@buhuchet/domain';
import type { Context } from 'hono';
import { apiError } from './errors';

const EMPLOYEE_BLOCKED = 'Учётная запись заблокирована. Обратитесь к владельцу организации.';

/**
 * Почему войти нельзя, даже с верным паролем. При входе сообщается только после верного пароля
 * (docs/deviations.md, п. 4, решение Б), в открытом сеансе — при следующем запросе. Тексты — из
 * прототипа core/login.js (`LG_T`) и словаря refDB v59: организация — без названия; там и
 * администратор платформы, блокируя учётную запись сотрудника, выключает сотрудника, поэтому сотрудник
 * видит одно сообщение — «Обратитесь к владельцу организации». Экран берёт текст из словаря: в
 * `details` — вариант текста для администратора платформы (`variant`).
 */
export function denialError(denial: LoginDenial, account: { isPlatformAdmin: boolean }) {
  switch (denial) {
    case 'org_blocked':
      return apiError(denial, 'Организация заблокирована. Обратитесь к администратору платформы.');
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

/**
 * Вход закрыт после неверных паролей (текст — как в прототипе core/login.js и словаре refDB v59
 * `auth.locked`, одинаковый для любого логина): до какого момента — в `details.lockedUntil` и
 * Retry-After; для текста словаря (`err.login_locked`) — `details.minutes`.
 */
export function lockedError(c: Context, until: Date | null) {
  if (until) {
    const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
    c.header('retry-after', String(seconds));
  }
  return apiError(
    'login_locked',
    `Вход временно закрыт: слишком много неверных попыток. Попробуйте через ${LOGIN_LOCK_MINUTES} минут.`,
    { lockedUntil: until?.toISOString() ?? null, minutes: LOGIN_LOCK_MINUTES },
  );
}
