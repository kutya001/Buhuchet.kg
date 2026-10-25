import { LOGIN_MAX_LENGTH } from './session';

/** Логин: латиница в нижнем регистре, цифры, точка, подчёркивание, дефис; от 3 до 64 символов. */
const LOGIN_PATTERN = new RegExp(`^[a-z0-9._-]{3,${LOGIN_MAX_LENGTH}}$`);

/** Логин сравнивается без учёта регистра и пробелов по краям (в базе — citext). */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

/** Подходит ли логин после normalizeLogin (прототип admin/accounts-orgs.js, форма новой организации). */
export function isValidLogin(login: string): boolean {
  return LOGIN_PATTERN.test(login);
}
