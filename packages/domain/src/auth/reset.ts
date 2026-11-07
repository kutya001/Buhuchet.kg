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

/*
 * Замена Telegram подтверждается кодом из прежнего чата (решение заказчика 07.11.2026, Р-13 Б;
 * docs/deviations.md п. О-20): прежний — привязанный сейчас или отвязанный последним. Код из 6 цифр
 * бот присылает туда, вводят его в новом чате бота. Пределы — как у кода «Забыли пароль?».
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-20
export const TELEGRAM_RELINK_CODE_TTL_MINUTES = 10;
export const TELEGRAM_RELINK_MAX_PER_HOUR = 3;
export const TELEGRAM_RELINK_MAX_ATTEMPTS = 5;
export const TELEGRAM_RELINK_MAX_DAILY_FAILURES = 10;
/**
 * После сброса пароля владельцем или администратором платформы (временный пароль) столько часов
 * Telegram привязывается без кода из прежнего чата: так меняют Telegram, если доступа к прежнему нет.
 */
export const TELEGRAM_RELINK_FREE_HOURS = 24;

/**
 * Нужно ли подтверждать привязку чата `chatId` кодом из прежнего: прежний чат есть, он другой и
 * замена без кода сейчас не разрешена.
 */
export function telegramRelinkNeedsCode(
  target: { confirmChatId: number | null; relinkFree: boolean },
  chatId: number,
): boolean {
  return target.confirmChatId !== null && target.confirmChatId !== chatId && !target.relinkFree;
}

/** Код подтверждения в сообщении боту: 6 цифр, пробелы и дефисы между ними не мешают; иначе null. */
export function relinkCodeOf(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '');
  return isResetCodeShape(digits) ? digits : null;
}

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
