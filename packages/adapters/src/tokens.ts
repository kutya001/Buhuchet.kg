import { createHash, randomBytes } from 'node:crypto';

/**
 * Токен сеанса (ТЗ «Вход и сеансы — свои»): 32 случайных байта в cookie, в базе — только SHA-256.
 * Утечка таблицы сеансов не даёт войти: по хешу токен не восстановить.
 */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Хеш токена для поиска сеанса в базе. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Похоже ли значение cookie на наш токен: чужое и мусор отбрасываются без запроса к базе. */
export function isSessionTokenShape(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
