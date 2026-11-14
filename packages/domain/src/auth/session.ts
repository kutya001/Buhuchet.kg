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
 * После стольких неверных паролей подряд у настоящей учётной записи вход в неё закрыт, пока не
 * выдадут новый пароль (решение заказчика 07.11.2026, ревью безопасности п. Р-4): сотруднику —
 * владелец организации, владельцу — администратор платформы. Счёт не забывается со временем, его
 * снимают верный пароль и новый пароль. У администраторов платформы такой блокировки нет — снять её
 * было бы некому (docs/deviations.md п. О-11).
 */
export const ACCOUNT_LOCK_FAILURES = 10;

/**
 * Попытки входа и восстановления пароля с одного адреса (ревью безопасности п. Р-4): не больше
 * стольких за окно, верных и неверных вместе, по любым логинам. Офис за одним адресом входит утром
 * раз в день — запас большой; подбор паролей по многим логинам с одного адреса упирается в предел.
 */
export const AUTH_IP_MAX_ATTEMPTS = 30;
export const AUTH_IP_WINDOW_MINUTES = 10;

/**
 * Сеанс живёт 1 день с последнего обращения (docs/deviations.md, п. 5, решение заказчика 30.10.2026);
 * срок продлевается не чаще раза в час.
 */
export const SESSION_TTL_DAYS = 1;
export const SESSION_TOUCH_MINUTES = 60;
/**
 * И не дольше 12 часов с входа, даже если им пользуются (OWASP ASVS 3.3.2, уровень 2; ревью
 * безопасности 06.11.2026, п. Р-12; docs/deviations.md п. О-10): украденная cookie не работает
 * бесконечно, а сотрудник входит заново раз в рабочий день.
 */
export const SESSION_MAX_HOURS = 12;

export const LOGIN_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 8;
/** Верхняя граница — чтобы очень длинная строка не нагружала argon2. */
export const PASSWORD_MAX_LENGTH = 128;

/** Чем закрыт вход, кроме неверных паролей подряд (столбец `users.login_lock_reason`). */
export const LOGIN_LOCK_REASONS = ['not_me'] as const;
export type LoginLockReason = (typeof LOGIN_LOCK_REASONS)[number];

/** Состояние учётной записи при входе. */
export interface AccountState {
  isPlatformAdmin: boolean;
  /** Заблокирована администратором платформы. */
  userBlocked: boolean;
  /** Сотрудник активен; null — записи сотрудника нет (у администратора платформы её и не бывает). */
  employeeActive: boolean | null;
  /** Состояние организации; null — у администратора платформы организации нет. */
  orgStatus: 'active' | 'blocked' | null;
  /**
   * Вход закрыт после ACCOUNT_LOCK_FAILURES неверных паролей подряд. Есть только при входе: открытый
   * сеанс блокировка не закрывает — она против подбора пароля, а не против того, кто уже вошёл.
   */
  loginLocked?: boolean;
  /**
   * Чем закрыт вход: `not_me` — кнопкой «Это не я» под сообщением бота (поток Т, задача Т4); пусто —
   * неверными паролями. От причины зависит только текст отказа.
   */
  loginLockReason?: LoginLockReason | null;
}

export type LoginDenial = 'org_blocked' | 'user_blocked' | 'employee_blocked' | 'account_locked';

/**
 * Почему войти нельзя, даже с верным паролем; null — можно. Порядок — как в прототипе
 * (core/login.js): сначала организация, потом учётная запись.
 */
export function loginDenial(s: AccountState): LoginDenial | null {
  if (s.isPlatformAdmin) return s.userBlocked ? 'user_blocked' : null;
  if (s.orgStatus !== 'active') return 'org_blocked';
  if (s.userBlocked) return 'user_blocked';
  if (s.employeeActive !== true) return 'employee_blocked';
  if (s.loginLocked) return 'account_locked';
  return null;
}
