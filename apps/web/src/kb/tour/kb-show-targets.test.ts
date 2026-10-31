import { UI_TEXTS } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { makeTranslate } from '../../l10n/translate';
import { fieldForm, fieldText, formTitle, productTarget, productUp } from './kb-show-targets';

const t = makeTranslate(Object.fromEntries(Object.entries(UI_TEXTS).map(([k, v]) => [k, v.ru])));

const FIELDS = {
  'ne-fio': { n: 'ФИО', x: 'Фамилия, имя, отчество сотрудника.' },
  'og-inn': { n: 'ИНН', x: '14 цифр.' },
  'nc-inn': { n: 'ИНН', x: 'Система проверит, что такого ИНН ещё нет.' },
  'Файл при поступлении': { n: 'Файл при поступлении', x: 'Своя запись по названию.' },
};

describe('«Показать как»: элементы прототипа на экране продукта', () => {
  it('обозначения прототипа переводятся; неизвестное — null (облачко пропускается)', () => {
    expect(productTarget('#tabs')).toBe('[data-tabrow]');
    expect(productTarget('#mbody .plate[data-plate="pend"]')).toBe('[data-plate="pend"]');
    expect(productTarget('#nothing-here')).toBeNull();
    // «Сделать сейчас» в показах сдачи и подтверждения — главная кнопка карточки отчёта.
    expect(productTarget('#rc-main')).toContain('[data-report-button="submit"]');
    expect(productTarget('#rc-main')).toContain('[data-report-button="confirm"]');
    // Карточка контрагента: «сменить» ответственного и блок «Страница контрагента».
    expect(productTarget('#cp-resp')).toBe('[data-cp-resp]');
    expect(productTarget('#cp-page')).toBe('[data-box]:has([data-cp-page])');
  });

  it('«подняться до» пункта меню и строки карточки — элементы продукта', () => {
    expect(productUp('.mi')).toBe('[role=menuitem]');
    expect(productUp('.kv > div')).toBe('dl > div');
    expect(productUp('.unknown')).toBeNull();
  });

  it('пояснение поля — по коду поля формы прототипа; своя запись по названию — первой', () => {
    expect(fieldText(FIELDS, 'ФИО', 'ne')).toBe('Фамилия, имя, отчество сотрудника.');
    expect(fieldText(FIELDS, 'ИНН', 'og')).toBe('14 цифр.');
    expect(fieldText(FIELDS, 'ИНН', 'nc')).toBe('Система проверит, что такого ИНН ещё нет.');
    expect(fieldText(FIELDS, 'Файл при поступлении', 'og')).toBe('Своя запись по названию.');
    // Форма без строки: поле с таким названием одно — его пояснение; несколько — общий текст.
    expect(fieldText(FIELDS, 'ФИО', undefined)).toBe('Фамилия, имя, отчество сотрудника.');
    expect(fieldText(FIELDS, 'ИНН', undefined)).toBeUndefined();
    expect(fieldText(FIELDS, 'ИНН', 'ne')).toBeUndefined();
  });

  it('форма прототипа — по экрану формы на странице или заголовку окна без названия записи', () => {
    expect(fieldForm({ screen: 'org.main' }, t)).toBe('og');
    expect(fieldForm({ screen: 'staff.list' }, t)).toBeUndefined();
    expect(fieldForm({ title: 'Новый сотрудник' }, t)).toBe('ne');
    expect(fieldForm({ title: 'Новый контрагент' }, t)).toBe('nc');
    expect(fieldForm({ title: 'Показатель «Выручка»' }, t)).toBe('ki');
    expect(fieldForm({ title: 'Что-то другое' }, t)).toBeUndefined();
    expect(formTitle('Удалить «Договор.pdf»?')).toBe('Удалить «…»?');
  });
});
