import { describe, expect, it } from 'vitest';
import { textPlaceholders, UI_TEXT_MAX_LENGTH, uiLanguageShare, uiTextProblem } from './ui-texts';

// Админка → «Локализация»: что можно сохранить вместо текста словаря (docs/deviations.md, п. Д-1) и
// отметка «сколько строк переведено».

describe('подстановки текста', () => {
  it('по алфавиту, без повторов; фигурные скобки без имени — не подстановка', () => {
    expect(textPlaceholders('{n} из {total}, всего {n}')).toEqual(['n', 'total']);
    expect(textPlaceholders('Без подстановок {} и { n }')).toEqual([]);
    expect(textPlaceholders('К уплате {сумма}')).toEqual(['сумма']);
  });
});

describe('правка текста словаря', () => {
  it('новый текст с теми же подстановками сохраняется, пробелы по краям не мешают', () => {
    expect(uiTextProblem('Главная', '  Рабочий стол ')).toBeNull();
    expect(uiTextProblem('{n} сотрудников', 'Сотрудников: {n}')).toBeNull();
    expect(uiTextProblem('{a} и {b}', '{b}, затем {a}')).toBeNull();
  });

  it('пустой текст — «Введите текст», слишком длинный — отказ', () => {
    expect(uiTextProblem('Главная', '   ')).toEqual({ code: 'empty' });
    expect(uiTextProblem('Главная', 'я'.repeat(UI_TEXT_MAX_LENGTH + 1))).toEqual({
      code: 'too_long',
    });
    expect(uiTextProblem('Главная', 'я'.repeat(UI_TEXT_MAX_LENGTH))).toBeNull();
  });

  it('подстановку нельзя убрать, переименовать или добавить новую', () => {
    const names = { code: 'placeholders', names: ['n'] };
    expect(uiTextProblem('{n} сотрудников', 'Сотрудники')).toEqual(names);
    expect(uiTextProblem('{n} сотрудников', '{count} сотрудников')).toEqual(names);
    expect(uiTextProblem('{n} сотрудников', '{n} сотрудников из {total}')).toEqual(names);
    expect(uiTextProblem('Главная', 'Главная {name}')).toEqual({
      code: 'placeholders',
      names: [],
    });
    expect(uiTextProblem('Главная', 'Главная {раздел}')).toEqual({
      code: 'placeholders',
      names: [],
    });
  });
});

describe('сколько строк языка переведено', () => {
  it('в процентах, вниз; 100 % — только когда переведено всё', () => {
    expect(uiLanguageShare(10, 10)).toBe(100);
    expect(uiLanguageShare(999, 1000)).toBe(99);
    expect(uiLanguageShare(1, 3)).toBe(33);
    expect(uiLanguageShare(0, 0)).toBe(100);
    expect(uiLanguageShare(12, 10)).toBe(100);
  });
});
