import type { UiTextDefault } from './texts';

const S = 'Витрина данных';

/**
 * Тексты «Витрины данных» → «Вывод», каталог «Шаблоны» организации и «Попросить шаблон» (доработки
 * 20.11.2026: Витрина данных, блоки 3–4; общий план 20.11, этап 2, П6–П7, поток И; прототип v155
 * `modules/vitrina.js`: `renderDmOut`, `dmOptHtml`, `dmParHtml`, `dmParRead`, `dmDraw`, `dmEx`,
 * `renderDmTpl`, `dmAskDlg`, `dmTabs`, `dmAdd`). Отказы «Показать» — `err.dm_*` (тред сборки).
 */
export const DATAMART_OUT_TEXTS = {
  'tab.dm.out': { ru: 'Вывод', section: 'Вкладки' },
  'tab.dm.tpl': { ru: 'Шаблоны', section: 'Вкладки' },
  'add.dm.ask': { ru: 'Попросить шаблон', section: 'Добавление' },
  // Над таблицей (прототип `renderDmOut`).
  'dm.out.tpl': { ru: 'Шаблон', section: S },
  'dm.out.org': { ru: 'Глазами организации', section: S },
  'dm.out.show': { ru: 'Показать', section: S },
  'dm.out.broken_opt': { ru: '{name} — не работает', section: S },
  'dm.out.group_org': { ru: 'Для организаций · {mod}', section: S },
  'dm.out.none_title': { ru: 'Шаблонов пока нет', section: S },
  'dm.out.none_admin': { ru: 'Опубликуйте шаблон во вкладке «Шаблоны».', section: S },
  'dm.out.none_org': {
    ru: 'Для ваших прав нет ни одного шаблона. Не хватает отчёта — попросите шаблон во вкладке «Шаблоны».',
    section: S,
  },
  // Результат (прототип `dmDraw`, `dmEx`).
  'dm.out.meta': { ru: 'Строк: {n} · выполнено за {ms} мс', section: S },
  'dm.out.meta_org': {
    ru: 'Строк: {n} · выполнено за {ms} мс · глазами организации «{org}»',
    section: S,
  },
  'dm.out.more': {
    ru: 'Показаны первые {max} строк. Уточните параметры, чтобы увидеть остальные',
    section: S,
  },
  'dm.out.hint': {
    ru: 'Выделите ячейки мышью или с Shift: внизу — количество, сумма и среднее. Ctrl+C копирует выделенное для вставки в Excel',
    section: S,
  },
  'dm.out.hint_phone': {
    ru: 'Нажмите на ячейку, чтобы выделить её: внизу — количество, сумма и среднее',
    section: S,
  },
  'dm.out.ro': { ru: 'Значения в выводе не правятся', section: S },
  'dm.out.empty_title': { ru: 'По этим параметрам данных нет', section: S },
  'dm.out.empty_text': { ru: 'Измените параметры и нажмите «Показать».', section: S },
  'dm.out.count.one': { ru: '{n} строка', section: S },
  'dm.out.count.few': { ru: '{n} строки', section: S },
  'dm.out.count.many': { ru: '{n} строк', section: S },
  'dm.out.yes': { ru: 'Да', section: S },
  'dm.out.no': { ru: 'Нет', section: S },
  // Параметры (прототип `dmParHtml`, `dmParRead`).
  'dm.par.all_status': { ru: 'Все статусы', section: S },
  'dm.par.any': { ru: 'Не важно', section: S },
  'dm.par.err.required': { ru: 'Укажите значение', section: S },
  'dm.par.err.type': { ru: 'Неверное значение', section: S },
  'dm.par.err.date_order': { ru: '«По дату» раньше «С даты»', section: S },
  'dm.par.err.month_order': { ru: 'Месяц раньше начального', section: S },
  // Каталог организации (прототип `renderDmTpl`).
  'dm.cat.note': {
    ru: 'Готовые отчёты платформы. «Показать» открывает отчёт во вкладке «Вывод». Не хватает отчёта — попросите шаблон: его добавит администратор платформы.',
    section: S,
  },
  'dm.cat.note_tok': {
    ru: 'Готовые отчёты платформы. «Показать» открывает отчёт во вкладке «Вывод»; «Выпустить токен» даёт внешней программе (Excel, Power BI, 1С) ключ к этому отчёту. Не хватает отчёта — попросите шаблон: его добавит администратор платформы.',
    section: S,
  },
  'dm.cat.ask': { ru: 'Попросить шаблон', section: S },
  'dm.cat.params': { ru: 'Параметры: {list}', section: S },
  'dm.cat.params_none': { ru: 'нет', section: S },
  'dm.cat.need_fee': { ru: 'нужно право «Видеть плату за обслуживание»', section: S },
  'dm.cat.cols': { ru: 'Столбцы · {n}', section: S },
  'dm.cat.total': { ru: 'итог', section: S },
  'dm.cat.show': { ru: 'Показать', section: S },
  'dm.cat.token': { ru: 'Выпустить токен', section: S },
  'dm.cat.broken': { ru: 'Сломан', section: S },
  'dm.cat.empty_title': { ru: 'Шаблонов для ваших прав нет', section: S },
  'dm.cat.empty_text': {
    ru: 'Шаблон виден, если у роли есть просмотр его модуля. Не хватает отчёта — попросите шаблон.',
    section: S,
  },
  // Типы столбцов (прототип `DM_CT`).
  'dm.ctype.text': { ru: 'Текст', section: S },
  'dm.ctype.num': { ru: 'Число', section: S },
  'dm.ctype.money': { ru: 'Деньги', section: S },
  'dm.ctype.date': { ru: 'Дата', section: S },
  'dm.ctype.datetime': { ru: 'Дата и время', section: S },
  'dm.ctype.month': { ru: 'Месяц', section: S },
  'dm.ctype.bool': { ru: 'Да или нет', section: S },
  'dm.ctype.cp': { ru: 'Контрагент (для области)', section: S },
  // «Попросить шаблон» (прототип `dmAskDlg`): запрос — как «Попросить добавить» «Справочников».
  'dm.ask.title': { ru: 'Попросить шаблон', section: S },
  'dm.ask.sub': { ru: 'Запрос уйдёт администратору платформы', section: S },
  'dm.ask.what': { ru: 'Какого отчёта не хватает', section: S },
  'dm.ask.what_ph': {
    ru: 'Например: Отчёты, сданные с опозданием, по месяцам',
    section: S,
  },
  'dm.ask.what_req': { ru: 'Опишите, какого отчёта не хватает', section: S },
  'dm.ask.cols': { ru: 'Какие столбцы и за какой период', section: S },
  'dm.ask.cols_ph': {
    ru: 'Контрагент, отчёт, срок, дата сдачи, на сколько дней опоздали',
    section: S,
  },
  'dm.ask.send': { ru: 'Отправить запрос', section: S },
  'dm.ask.sent': { ru: 'Запрос отправлен администратору платформы', section: S },
} as const satisfies Record<string, UiTextDefault>;
