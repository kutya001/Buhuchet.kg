import { describe, expect, it } from 'vitest';
import { autoDisplayName } from './display-name-auto';

/** Поле «Отображаемое имя» и ввод в форму, как в прототипе v74 bindShort. */
function form(manual: boolean, value = '') {
  const field = { value };
  const auto = autoDisplayName(manual, (v) => {
    field.value = v;
  });
  return { field, auto };
}

describe('«Отображаемое имя» в форме (прототип v74 bindShort)', () => {
  it('«Новый сотрудник»: имя заполняется по ФИО, пока его не ввели руками', () => {
    const { field, auto } = form(false);
    auto.fullNameInput('Кадырова');
    auto.fullNameInput('Кадырова Мээрим');
    expect(field.value).toBe('Мээрим К.');
    field.value = 'Мээрим';
    auto.input(field.value);
    auto.fullNameInput('Кадырова Мээрим Асановна');
    expect(field.value).toBe('Мээрим');
  });

  it('поле очистили и ушли из него — снова имя по ФИО, и дальше оно следует за ФИО', () => {
    const { field, auto } = form(false);
    field.value = 'Мээрим';
    auto.input(field.value);
    field.value = ' ';
    auto.input(field.value);
    auto.blur(field.value, 'Кадырова Мээрим');
    expect(field.value).toBe('Мээрим К.');
    auto.fullNameInput('Асанова Мээрим');
    expect(field.value).toBe('Мээрим А.');
    // Непустое поле при уходе не меняется.
    field.value = 'Мээ';
    auto.input(field.value);
    auto.blur(field.value, 'Асанова Мээрим');
    expect(field.value).toBe('Мээ');
  });

  it('«Изменить»: имя, заданное вручную, при правке ФИО остаётся; автоматическое — следует за ФИО', () => {
    const manual = form(true, 'Мээрим');
    manual.auto.fullNameInput('Асанова Мээрим');
    expect(manual.field.value).toBe('Мээрим');
    const auto = form(false, 'Мээрим К.');
    auto.auto.fullNameInput('Асанова Мээрим');
    expect(auto.field.value).toBe('Мээрим А.');
    // Перечитали с сервера: имя уже задано вручную.
    auto.auto.reset(true);
    auto.auto.fullNameInput('Бекова Мээрим');
    expect(auto.field.value).toBe('Мээрим А.');
  });
});
