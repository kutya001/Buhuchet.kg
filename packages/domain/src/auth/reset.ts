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
/**
 * Неверных вводов кода за 24 часа, после которых «Забыли пароль?» для логина закрывается на 24 часа
 * после последнего кода (пароль может сбросить владелец). Иначе код подбирали бы по 15 вариантов в
 * час без конца (docs/decisions.md, п. 21; сверх ТЗ — docs/deviations.md, п. 9).
 */
export const RESET_CODE_MAX_DAILY_FAILURES = 10;

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

/**
 * Код из Telegram при входе администратора платформы (ревью безопасности 06.11.2026, п. Р-2): после
 * верного пароля — 6 цифр на 5 минут, 5 вводов; не больше 3 кодов за 15 минут и 10 кодов без входа за
 * сутки. Сеанс начинается только после кода. Перебор: не больше 50 вариантов из миллиона в сутки, и
 * каждый код приходит администратору в Telegram — он сразу видит, что пароль знает кто-то ещё. Новый
 * пароль снимает оба предела.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-13
export const ADMIN_CODE_TTL_MINUTES = 5;
export const ADMIN_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_CODE_MAX_CODES = 3;
export const ADMIN_CODE_WINDOW_MINUTES = 15;
export const ADMIN_CODE_MAX_DAILY = 10;
