/**
 * «Забыли пароль?» (ТЗ «Восстановление пароля через Telegram», прототип core/login.js): бот присылает
 * в привязанный Telegram код из 6 цифр, он действует 10 минут; не больше 3 кодов в час на один логин.
 * Если Telegram не привязан, пароль сбрасывает владелец организации (для владельца — администратор
 * платформы) временным паролем, который при входе нужно сменить.
 */

export const RESET_CODE_LENGTH = 6;
export const RESET_CODE_TTL_MINUTES = 10;
export const RESET_CODE_MAX_PER_HOUR = 3;
/**
 * Неверных вводов одного кода, после которых он больше не действует. ТЗ число не называет, но без
 * ограничения 6 цифр перебираются за 10 минут (docs/decisions.md, п. 21).
 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** Ссылка привязки Telegram одноразовая и действует 15 минут (прототип modules/profile.js). */
export const TELEGRAM_LINK_TTL_MINUTES = 15;

/** Похоже ли значение на код из Telegram: ровно 6 цифр. */
export function isResetCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`).test(code);
}

/**
 * Временный пароль при сбросе владельцем или администратором: «Bh-» и 8 знаков без похожих друг на
 * друга (нет 0/O, 1/I/L), например Bh-7K4M-Q9TX. В прототипе — Bh-1234-56; так короче и подбирается
 * легче (docs/deviations.md, п. 7).
 */
export const TEMP_PASSWORD_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TEMP_PASSWORD_PATTERN = /^Bh-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** Временный пароль из 8 знаков алфавита (случайные знаки даёт переходник). */
export function formatTemporaryPassword(chars: string): string {
  if (chars.length !== 8 || [...chars].some((ch) => !TEMP_PASSWORD_ALPHABET.includes(ch))) {
    throw new Error('временный пароль: нужно 8 знаков алфавита');
  }
  return `Bh-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
