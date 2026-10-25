/** Логин: латиница в нижнем регистре, цифры, точка, подчёркивание, дефис; от 3 символов. */
const LOGIN_PATTERN = /^[a-z0-9._-]{3,}$/;

/** Логин сравнивается без учёта регистра и пробелов по краям (в базе — citext). */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Подходит ли логин после normalizeLogin (прототип admin/accounts-orgs.js, форма новой организации). */
export function isValidLogin(login: string): boolean {
  return LOGIN_PATTERN.test(login);
}
