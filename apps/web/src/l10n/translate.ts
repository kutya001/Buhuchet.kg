import { formatText, type UiTextKey, type UiTextParams } from '@buhuchet/domain';

/** Текст по ключу из словаря с подстановками `{имя}`. */
export type Translate = (key: UiTextKey, params?: UiTextParams) => string;

/** Функция `t` над текстами словаря; ключа нет в словаре (не должно быть) — показывается сам ключ. */
export function makeTranslate(texts: Readonly<Record<string, string>>): Translate {
  return (key, params) => formatText(texts[key] ?? key, params);
}
