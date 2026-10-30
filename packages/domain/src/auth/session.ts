/**
 * Вход и сеансы (ТЗ «Авторизация и аутентификация через логин и пароль без почты», «Вход и сеансы —
 * свои»): после 5 неверных паролей вход закрыт на 15 минут (прототип core/login.js), пароль — не
 * короче 8 символов (прототип core/login.js, modules/profile.js).
 */

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;
/**
 * Неверные пароли считаются по набранному логину, есть он или нет (docs/deviations.md, п. 4, решение
 * Б); через час после последней попытки счёт забывается.
 */
export const LOGIN_FAILURE_MEMORY_MINUTES = 60;

/**
 * Сеанс живёт 1 день с последнего обращения (docs/deviations.md, п. 5, решение заказчика 30.10.2026);
 * срок продлевается не чаще раза в час.
 */
export const SESSION_TTL_DAYS = 1;
export const SESSION_TOUCH_MINUTES = 60;

export const LOGIN_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 8;
/** Верхняя граница — чтобы очень длинная строка не нагружала argon2. */
export const PASSWORD_MAX_LENGTH = 128;

/** Состояние учётной записи при входе. */
export interface AccountState {
  isPlatformAdmin: boolean;
  /** Заблокирована администратором платформы. */
  userBlocked: boolean;
  /** Сотрудник активен; null — записи сотрудника нет (у администратора платформы её и не бывает). */
  employeeActive: boolean | null;
  /** Состояние организации; null — у администратора платформы организации нет. */
  orgStatus: 'active' | 'blocked' | null;
}

export type LoginDenial = 'org_blocked' | 'user_blocked' | 'employee_blocked';

/**
 * Почему войти нельзя, даже с верным паролем; null — можно. Порядок — как в прототипе
 * (core/login.js): сначала организация, потом учётная запись.
 */
export function loginDenial(s: AccountState): LoginDenial | null {
  if (s.isPlatformAdmin) return s.userBlocked ? 'user_blocked' : null;
  if (s.orgStatus !== 'active') return 'org_blocked';
  if (s.userBlocked) return 'user_blocked';
  if (s.employeeActive !== true) return 'employee_blocked';
  return null;
}
