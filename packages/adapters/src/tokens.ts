import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  formatTemporaryPassword,
  RESET_CODE_LENGTH,
  TEMP_PASSWORD_ALPHABET,
} from '@buhuchet/domain';

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

/**
 * Одноразовый токен ссылки привязки Telegram (t.me/бот?start=токен): такой же, как токен сеанса,
 * 43 знака base64url — в параметре start Telegram допускает до 64 знаков A–Z, a–z, 0–9, _ и -.
 */
export const newLinkToken = newSessionToken;

/** Код восстановления пароля: 6 случайных цифр (может начинаться с нуля). */
export function newResetCode(): string {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, '0');
}

/** Временный пароль при сбросе владельцем или администратором: Bh-XXXX-XXXX из случайных знаков. */
export function newTemporaryPassword(): string {
  let chars = '';
  for (let i = 0; i < 8; i++)
    chars += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  return formatTemporaryPassword(chars);
}
