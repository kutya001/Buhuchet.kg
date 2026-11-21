import type { UiTextDefault } from './texts';

const S = 'Витрина данных';
const E = 'Ошибки';
const SYS = 'Система';
const ADM = 'Админка';
const BELL = 'Колокольчик';

/**
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3; прототип v155 `modules/vitrina.js` `renderDmTplAdm`,
 * `dmEdit`, `dmSqlErr`, `dmStateDlg`, `dmCopy`): столбцы списка (и заголовки Excel), состояния, виды,
 * строки истории и отказы методов. Подписи полей и кнопок окна — у экрана (поток И).
 */
export const DATAMART_ADMIN_TEXTS = {
  'dm.tpl.title': { ru: 'Шаблоны', section: S },
  'dm.tpl.col.name': { ru: 'Название', section: S },
  'dm.tpl.col.code': { ru: 'Код', section: S },
  'dm.tpl.col.kind': { ru: 'Вид', section: S },
  'dm.tpl.col.state': { ru: 'Состояние', section: S },
  'dm.tpl.col.orgs': { ru: 'Организаций пользуется', section: S },
  'dm.tpl.col.toks': { ru: 'Токенов', section: S },
  'dm.tpl.col.checked': { ru: 'Проверен', section: S },
  'dm.tpl.col.mod': { ru: 'Модуль', section: S },
  'dm.tpl.mod.none': { ru: '—', section: S },
  'dm.tpl.state.draft': { ru: 'Черновик', section: S },
  'dm.tpl.state.published': { ru: 'Опубликован', section: S },
  'dm.tpl.state.off': { ru: 'Отключён', section: S },
  'dm.tpl.state.broken': { ru: 'Сломан', section: S },
  'dm.tpl.kind.org': { ru: 'Для организаций', section: S },
  'dm.tpl.kind.admin': { ru: 'Для администратора', section: S },
  'dm.tpl.copy_name': { ru: '{name} (копия)', section: S },
  // История шаблона (прототип `dmHist`): «Создан: Черновик», «Изменено: название, запрос»,
  // «Опубликован → Отключён: причина».
  'dm.tpl.hist.create': { ru: 'Создан: {state}', section: S },
  'dm.tpl.hist.copy': { ru: 'Создан копированием шаблона «{name}»: {state}', section: S },
  'dm.tpl.hist.update': { ru: 'Изменено: {fields}', section: S },
  'dm.tpl.hist.state': { ru: '{from} → {to}', section: S },
  'dm.tpl.hist.state_reason': { ru: '{from} → {to}: {reason}', section: S },
  'dm.tpl.field.name': { ru: 'название', section: S },
  'dm.tpl.field.code': { ru: 'код', section: S },
  'dm.tpl.field.description': { ru: 'описание', section: S },
  'dm.tpl.field.audience': { ru: 'вид', section: S },
  'dm.tpl.field.query': { ru: 'запрос', section: S },
  'dm.tpl.field.module': { ru: 'модуль', section: S },
  'dm.tpl.field.need_permission': { ru: 'право', section: S },
  'dm.tpl.field.access': { ru: 'доступ', section: S },
  'dm.tpl.field.params': { ru: 'параметры', section: S },
  'dm.tpl.field.columns': { ru: 'столбцы', section: S },
  // Запись в историю организации, на данных которой администратор проверил шаблон.
  'dm.tpl.history_check': {
    ru: 'Проверен шаблон витрины данных «{name}» на данных организации',
    section: S,
  },
  // То же у нового шаблона или шаблона не «Для организаций» (название не её).
  'dm.tpl.history_check_new': {
    ru: 'Проверен новый шаблон витрины данных на данных организации',
    section: S,
  },
  // Текст запроса (прототип `dmSqlErr`).
  'err.dm_sql_empty': { ru: 'Введите запрос', section: E },
  'err.dm_sql_not_select': {
    ru: 'Запрос начинается с SELECT или WITH: разрешено только чтение',
    section: E,
  },
  'err.dm_sql_two_statements': {
    ru: 'Разрешён один оператор: уберите всё после «;»',
    section: E,
  },
  'err.dm_sql_forbidden': {
    ru: '«{word}» нельзя: шаблон только читает таблицы организации',
    section: E,
  },
  'err.dm_sql_unclosed': { ru: 'Не закрыта кавычка или комментарий', section: E },
  'err.dm_sql_parens': {
    ru: 'Скобки не парные: у каждой «(» должна быть своя «)»',
    section: E,
  },
  'err.dm_sql_positional': {
    ru: 'Параметры пишутся именами, например :month или :date_from, а не $1',
    section: E,
  },
  'err.dm_sql_too_many_params': { ru: 'Параметров в запросе больше 20', section: E },
  'err.dm_param_missing': {
    ru: 'Параметр :{param} есть в запросе, но не описан: нажмите «Проверить»',
    section: E,
  },
  // Столбцы ответа базы и состав столбцов (блок 2, пункты 5 и 7).
  'err.dm_check_no_columns': {
    ru: 'Дайте столбцам имена через AS: по ним строятся столбцы вывода',
    section: E,
  },
  'err.dm_check_bad_name': {
    ru: 'Столбец «{column}»: имя через AS — латиницей в нижнем регистре, цифры и «_», например AS cp_name',
    section: E,
  },
  'err.dm_check_dup_name': {
    ru: 'Столбец «{column}» встречается дважды: дайте столбцам разные имена через AS',
    section: E,
  },
  'err.dm_check_removed': {
    ru: 'Столбец «{column}» убрать нельзя: сломаются подключения. Нужен другой состав — «Копировать»',
    section: E,
  },
  'err.dm_check_two_cp': {
    ru: 'Столбец «Контрагент (для области)» может быть только один',
    section: E,
  },
  'err.dm_check_too_many': { ru: 'Столбцов больше 100', section: E },
  'err.dm_check_failed': { ru: 'Запрос не выполнился: {error}', section: E },
  'err.dm_check_required': {
    ru: 'Сначала нажмите «Проверить»: публикуется только проверенный запрос',
    section: E,
  },
  // Окно шаблона и меню строки.
  'err.dm_code_taken': { ru: 'Такой код уже есть', section: E },
  'err.dm_code_locked': {
    ru: 'У опубликованного шаблона код не меняется: на нём держатся подключения',
    section: E,
  },
  'err.dm_kind_locked': { ru: 'У опубликованного шаблона вид не меняется', section: E },
  'err.dm_module_required': { ru: 'Выберите модуль', section: E },
  'err.dm_orgs_required': { ru: 'Выберите организации или «Все организации»', section: E },
  'err.dm_builtin': { ru: 'Готовый шаблон: изменить — копией', section: E },
  'err.dm_state_bad': { ru: 'Шаблон в этом состоянии так не изменить', section: E },
  'err.dm_reason_required': { ru: 'Укажите причину', section: E },
  // Проверка шаблонов системой после выпуска и каждую ночь (блок 8, пункт 7; общий план 20.11, этап 2,
  // П4): задача «Запусков», сообщение администраторам платформы в Telegram и строка колокольчика.
  'alert.job.dm_check_templates': { ru: 'Витрина: проверка шаблонов', section: SYS },
  'runs.what.dm_check_templates': {
    ru: 'После выпуска с изменениями базы и каждую ночь запускает каждый опубликованный и сломанный шаблон витрины данных: шаблоны организаций — на демо-организации (на рабочем сайте — без данных организаций), шаблоны Админки — на данных платформы. Не выполнился — «Сломан» и сообщение администраторам платформы; снова выполняется — «Опубликован»',
    section: ADM,
  },
  'runs.done.dm_check_templates': { ru: 'Проверено шаблонов: {n}', section: ADM },
  'alert.dm_broken': {
    ru: '⚠️ Шаблон витрины данных «{name}» сломан: не выполнился при проверке. Организации видят «Шаблон временно не работает», его токены не отвечают. Текст ошибки — Админка → «Витрина данных» → «Шаблоны»',
    section: SYS,
  },
  'bell.line.dm_broken': { ru: 'Шаблон витрины данных «{name}» сломан', section: BELL },
} as const satisfies Record<string, UiTextDefault>;
