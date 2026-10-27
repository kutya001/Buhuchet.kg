/**
 * Админка → «Локализация» (ТЗ «Модуль Локализация»; прототип admin/l10n.js): администратор платформы
 * правит русский текст словаря без изменения кода. Правила правки — здесь, запись — `adminSetUiText`
 * из @buhuchet/db.
 */

/** Самый длинный текст словаря: подписи, сообщения и подсказки, а не статьи. */
export const UI_TEXT_MAX_LENGTH = 2000;

/**
 * Подстановки текста `{имя}` (их заполняет `formatText`) — по алфавиту, без повторов. Имя из любых букв:
 * `formatText` знает только латинские, поэтому `{сумма}` тоже ловится — иначе она покажется на экране
 * как есть.
 */
export function textPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map((m) => m[1]!))].sort();
}

export type UiTextProblem =
  | { code: 'empty' }
  | { code: 'too_long' }
  /** Подстановки не те, что были: `names` — какие должны остаться в тексте. */
  | { code: 'placeholders'; names: string[] };

/**
 * Можно ли сохранить новый текст вместо прежнего (docs/deviations.md, п. Д-1): текст не пустой (пробелы
 * по краям не считаются), не длиннее `UI_TEXT_MAX_LENGTH`, а подстановки `{имя}` — те же, что в
 * прежнем тексте: без `{n}` подпись «{n} сотрудников» потеряет число, а незнакомая подстановка
 * покажется на экране как есть.
 */
export function uiTextProblem(before: string, next: string): UiTextProblem | null {
  const text = next.trim();
  if (!text) return { code: 'empty' };
  if (text.length > UI_TEXT_MAX_LENGTH) return { code: 'too_long' };
  const names = textPlaceholders(before);
  const now = textPlaceholders(text);
  if (names.length !== now.length || names.some((n, i) => n !== now[i])) {
    return { code: 'placeholders', names };
  }
  return null;
}

/**
 * Сколько текстов языка уже переведено, в процентах (ТЗ: «отметка, сколько строк уже переведено»;
 * у русского — 100 %). Округление вниз: 100 % — только когда переведено всё.
 */
export function uiLanguageShare(translated: number, total: number): number {
  if (total <= 0) return 100;
  return Math.floor((Math.min(translated, total) * 100) / total);
}
