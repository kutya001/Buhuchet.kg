import { uiTextProblem, type UiLanguage } from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';

/** Подпись языка на плашке «Локализации»: «Русский». */
export function languageLabel(t: Translate, lang: UiLanguage): string {
  return t(`locale.lang.${lang}`);
}

/**
 * Ошибка подстановок под полем окна «Текст интерфейса» (docs/deviations.md, п. Д-1): какие `{имя}`
 * оставить, а у текста без подстановок — убрать фигурные скобки.
 */
export function placeholdersError(t: Translate, names: readonly string[]): string {
  return names.length
    ? t('err.ui_text_placeholders', { names: names.map((n) => `{${n}}`).join(', ') })
    : t('err.ui_text_placeholders.none');
}

/**
 * Проверка подстановок до отправки — то же правило, что на сервере (`uiTextProblem`): ошибка сразу под
 * полем. Пустой и слишком длинный текст ловит схема формы.
 */
export function uiTextFieldError(t: Translate, before: string, text: string): string | undefined {
  const problem = uiTextProblem(before, text);
  return problem?.code === 'placeholders' ? placeholdersError(t, problem.names) : undefined;
}
