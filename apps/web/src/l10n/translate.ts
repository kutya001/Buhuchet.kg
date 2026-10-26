import {
  formatText,
  PASSWORD_MIN_LENGTH,
  RESET_CODE_LENGTH,
  type UiTextKey,
  type UiTextParams,
} from '@buhuchet/domain';

/** Текст по ключу из словаря с подстановками `{имя}`. */
export type Translate = (key: UiTextKey, params?: UiTextParams) => string;

/** Функция `t` над текстами словаря; ключа нет в словаре (не должно быть) — показывается сам ключ. */
export function makeTranslate(texts: Readonly<Record<string, string>>): Translate {
  return (key, params) => formatText(texts[key] ?? key, params);
}

/** Ошибка ответа API (`ApiError.error`): код и текст сервера. */
export interface ApiErrorLike {
  code: string;
  message: string;
}

/**
 * Сообщение об ошибке ответа API для экрана: текст словаря по коду (`err.<код>`), а если такого
 * ключа нет — текст из ответа сервера.
 */
export function makeErrorText(
  texts: Readonly<Record<string, string>>,
): (error: ApiErrorLike) => string {
  return (error) => texts[`err.${error.code}`] ?? error.message;
}

/** Числа правил в текстах ошибок форм: `{min}` — длина пароля, `{code}` — цифр в коде из Telegram. */
const RULE_NUMBERS = { min: PASSWORD_MIN_LENGTH, code: RESET_CODE_LENGTH };

/**
 * Текст ошибки поля формы: сообщение схемы формы (`@buhuchet/shared`) — ключ словаря; нет ошибки —
 * undefined.
 */
export function fieldErrorText(t: Translate, message: string | undefined): string | undefined {
  return message ? t(message as UiTextKey, RULE_NUMBERS) : undefined;
}
