import { defaultUiTexts } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../l10n/translate';
import { languageLabel, placeholdersError, uiTextFieldError } from './l10n-text';

// Окно «Текст интерфейса» в Админке → «Локализация»: ошибка подстановок под полем — сразу, тем же
// правилом, что на сервере (docs/deviations.md, п. Д-1).

const t = makeTranslate(defaultUiTexts());

describe('«Локализация»: подписи и ошибки окна правки', () => {
  it('язык на плашке — словами', () => {
    expect(languageLabel(t, 'ru')).toBe('Русский');
  });

  it('подстановки: какие оставить; у текста без подстановок — убрать скобки', () => {
    expect(placeholdersError(t, ['n'])).toBe('Подстановки в тексте должны остаться прежними: {n}');
    expect(placeholdersError(t, ['n', 'name'])).toBe(
      'Подстановки в тексте должны остаться прежними: {n}, {name}',
    );
    expect(placeholdersError(t, [])).toBe(
      'Уберите подстановки в фигурных скобках: у этого текста их нет',
    );
  });

  it('проверка до отправки: потерянная или лишняя подстановка — ошибка, порядок и пробелы — нет', () => {
    expect(uiTextFieldError(t, '{n} строк', 'Строк: {n}')).toBeUndefined();
    expect(uiTextFieldError(t, '{a} и {b}', ' {b} или {a} ')).toBeUndefined();
    expect(uiTextFieldError(t, '{n} строк', 'Строки')).toBe(
      'Подстановки в тексте должны остаться прежними: {n}',
    );
    expect(uiTextFieldError(t, 'Сохранить', 'Сохранить {x}')).toBe(
      'Уберите подстановки в фигурных скобках: у этого текста их нет',
    );
    // Пустой текст — ошибка схемы формы, не подстановок.
    expect(uiTextFieldError(t, 'Сохранить', '  ')).toBeUndefined();
  });
});
