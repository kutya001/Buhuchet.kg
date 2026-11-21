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
    // Блок свёрнут (v137): цель — сам блок, а кнопки у свёрнутого — строка, которая его раскрывает.
    expect(productTarget('#cp-page')).toBe('[data-cp-page-fold]');
    expect(productTarget('#cp-page .acts')).toBe(
      '[data-cp-page] > div:has([data-cp-page-action]) || [data-cp-page-fold] > summary',
    );
    // Карточка проекта: «Записать оплату» (показ шага «Принять транш оплаты по проекту»).
    // На вкладке «Главное» (v136) кнопка блока «Оплаты» не видна — цель и главная кнопка внизу.
    expect(productTarget('#pj-pay')).toBe(
      '[data-pj-pay] || [data-window-foot] [data-pj-main="pay"]',
    );
  });

  it('урок «Витрина данных»: элементы показов и «Обзора экрана» есть в продукте', () => {
    // Обозначения показов sh-dmshow, sh-dmxl, sh-dmcat, sh-dmtok и kbUi.els экранов dm (прототип v157).
    const proto = [
      '#dm-t',
      '#mbody .dm-pars',
      '#dm-go',
      '#mbody .dm-meta',
      '#dm-g .gscroll',
      '#dm-st',
      '#mbody .gt thead .th-f',
      '#mbody [data-a=xls]',
      '#dm-ask',
      '#mbody .dm-card',
      '#mbody [data-dm-show]',
      '#mbody [data-dm-tok]',
      '#mbody .note.red',
    ];
    for (const p of proto) expect(productTarget(p), p).not.toBeNull();
    expect(productTarget('#dm-go')).toBe('main [data-dm-out-show]');
    expect(productTarget('#mbody .note.red')).toBe('main [data-dm-api-off]');
    // Поля «Вывода» и окон витрины — по кодам полей прототипа.
    expect(fieldForm({ screen: 'dm.out' }, t)).toBe('dm|dmp');
    expect(fieldForm({ title: 'Новый API-токен' }, t)).toBe('dk');
    // Открытый шаблон в Админке: в заголовке — его название, форма — по метке редактора в окне.
    const editor = (sel: string) => sel === '[data-dm-editor]';
    expect(fieldForm({ title: 'Отчёты к сдаче', has: editor }, t)).toBe('de');
    expect(fieldForm({ title: 'Отчёты к сдаче', has: () => false }, t)).toBeUndefined();
    expect(fieldForm({ title: 'Новый шаблон', has: editor }, t)).toBe('de');
    const dm = {
      'dm-t': { n: 'Шаблон', x: 'Какой отчёт показать.' },
      'dk-t': { n: 'Шаблон', x: 'Шаблон токена.' },
      'dmp-month': { n: 'Месяц', x: 'Месяц отчёта.' },
    };
    expect(fieldText(dm, 'Шаблон', 'dm|dmp')).toBe('Какой отчёт показать.');
    expect(fieldText(dm, 'Шаблон', 'dk')).toBe('Шаблон токена.');
    expect(fieldText(dm, 'Месяц', 'dm|dmp')).toBe('Месяц отчёта.');
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
    // Несколько форм прототипа на экране («Настройки»: вкладка и блок «Telegram-уведомления»).
    expect(fieldText(FIELDS, 'ИНН', 'ne|og')).toBe('14 цифр.');
    expect(fieldText(FIELDS, 'ИНН', 'ne|xx')).toBeUndefined();
    expect(fieldForm({ screen: 'org.settings' }, t)).toBe('st|tgn');
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
