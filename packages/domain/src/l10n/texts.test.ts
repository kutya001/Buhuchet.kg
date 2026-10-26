import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_LANGUAGE, defaultUiTexts, formatText, UI_LANGUAGES, UI_TEXTS } from './texts';

describe('словарь текстов интерфейса', () => {
  it('язык один — русский, он же язык по умолчанию', () => {
    expect(UI_LANGUAGES).toEqual(['ru']);
    expect(DEFAULT_UI_LANGUAGE).toBe('ru');
  });

  it('тексты по умолчанию: ключ → русский текст, у каждого есть раздел', () => {
    const texts = defaultUiTexts();
    expect(Object.keys(texts)).toEqual(Object.keys(UI_TEXTS));
    expect(texts['health.title']).toBe('Проверка работы системы');
    for (const [key, value] of Object.entries(UI_TEXTS)) {
      expect(value.ru.trim(), key).not.toBe('');
      expect(value.section.trim(), key).not.toBe('');
      expect(key).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });

  it('подставляет значения в {имя}, неизвестные подстановки оставляет', () => {
    expect(formatText('Показано {from} – {to} из {total}', { from: 1, to: 20, total: 135 })).toBe(
      'Показано 1 – 20 из 135',
    );
    expect(formatText('{name}: доступна', { name: 'База данных' })).toBe('База данных: доступна');
    expect(formatText('{name}: {state}', { name: 'Хранилище' })).toBe('Хранилище: {state}');
    expect(formatText('Без подстановок')).toBe('Без подстановок');
    // Только собственные значения: имя из прототипа объекта не подставляется.
    expect(formatText('{toString}', {})).toBe('{toString}');
  });
});
