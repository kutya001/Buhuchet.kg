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

/** Ошибка ответа API (`ApiError.error`): код, текст сервера и подробности. */
export interface ApiErrorLike {
  code: string;
  message: string;
  details?: unknown;
}

/** Строки и числа из `details` ответа — подстановки текста словаря; `variant` — выбор текста. */
function errorParams(details: unknown): { variant?: string; params: UiTextParams } {
  if (typeof details !== 'object' || details === null) return { params: {} };
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(details)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  const { variant, ...rest } = params;
  return typeof variant === 'string' ? { variant, params: rest } : { params: rest };
}

/**
 * Сообщение об ошибке ответа API для экрана: текст словаря по коду (`err.<код>`, а при
 * `details.variant` — сначала `err.<код>.<вариант>`) с подстановками из `details`. Ключа нет или
 * для подстановки не хватает значения — текст из ответа сервера.
 */
export function makeErrorText(
  texts: Readonly<Record<string, string>>,
): (error: ApiErrorLike) => string {
  return (error) => {
    const { variant, params } = errorParams(error.details);
    const template =
      (variant ? texts[`err.${error.code}.${variant}`] : undefined) ?? texts[`err.${error.code}`];
    if (!template) return error.message;
    const text = formatText(template, params);
    return /\{\w+\}/.test(text) ? error.message : text;
  };
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
